from fastapi import FastAPI, File, UploadFile
import os
from pathlib import Path

# Ensure Ultralytics uses a writable config directory (important in sandboxed envs).
os.environ.setdefault("YOLO_CONFIG_DIR", str(Path(__file__).resolve().parent / ".ultralytics"))

from ultralytics import YOLO
import numpy as np
import cv2
import io
import asyncio
import time
import httpx
import logging
from dotenv import load_dotenv
from fastapi.middleware.cors import CORSMiddleware

logger = logging.getLogger("visiosense")
logging.basicConfig(level=logging.INFO)

load_dotenv()  # loads .env file into environment variables

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_WEIGHTS_PATH = Path(__file__).resolve().parent / "yolov8n.pt"
yolo_model = YOLO(str(_WEIGHTS_PATH))

# ---------------------------------------------------------------------------
# Depth model (MiDaS small) — used to detect plain walls / open space where
# YOLO has nothing to report. Loaded lazily-but-eagerly at startup; if torch
# isn't installed we silently fall back to YOLO-only clearance.
# ---------------------------------------------------------------------------
_midas_model = None
_midas_transform = None
_midas_device = "cpu"
DEPTH_AVAILABLE = False

try:
    import torch  # type: ignore
    _midas_device = "cuda" if torch.cuda.is_available() else "cpu"
    logger.info("Loading MiDaS_small on %s ...", _midas_device)
    _midas_model = torch.hub.load("intel-isl/MiDaS", "MiDaS_small", trust_repo=True)
    _midas_model.to(_midas_device)
    _midas_model.eval()
    _midas_transforms = torch.hub.load("intel-isl/MiDaS", "transforms", trust_repo=True)
    _midas_transform = _midas_transforms.small_transform
    DEPTH_AVAILABLE = True
    logger.info("MiDaS_small loaded.")
except Exception as exc:  # noqa: BLE001
    logger.warning(
        "MiDaS unavailable, clearance will be YOLO-only: %s", exc,
    )
    _midas_model = None
    _midas_transform = None

"""
Tunable configuration (keep all knobs in one place)
--------------------------------------------------
These constants are intended to be adjusted during field testing (indoor vs
outdoor, different devices) without hunting through the file.
"""

# Minimum YOLO confidence to keep a detection.
# Env override: set CONF_OVERRIDE=0.55 etc to tune without redeploying.
CONF_THRESHOLD = 0.45
_conf_override = os.getenv("CONF_OVERRIDE")
if _conf_override:
    try:
        CONF_THRESHOLD = float(_conf_override)
    except ValueError:
        pass

# Zone mapping thresholds from bbox center-x (normalized 0..1).
ZONE_LEFT_MAX = 0.35
ZONE_RIGHT_MIN = 0.65

# Pinhole camera distance approximation constant in pixels.
# Assumes frontend resizes frames to ~640px wide before upload.
# Needs field calibration per device.
FOCAL_PX = 500

# Real-world object heights (meters) used for pinhole distance.
REAL_HEIGHT_M: dict[str, float] = {
    "person": 1.7,
    "chair": 0.9,
    "door": 2.0,
    "car": 1.5,
    "dog": 0.6,
    "sofa": 0.85,
    "couch": 0.85,  # COCO name
    "bicycle": 1.1,
    "table": 0.75,
    "dining table": 0.75,  # COCO name
}

# Distance bands (meters) used for risk + speech suppression.
DIST_MIN_M = 0.3
DIST_MAX_M = 15.0
DIST_DANGER_MAX_M = 0.7
DIST_CAUTION_MAX_M = 1.5
DIST_INFO_MAX_M = 3.0  # beyond this, suppress local per-object speech

# Only report classes relevant to pedestrian navigation.
# COCO class names that map to each category:
ALLOWED_CLASSES = {
    "person",
    "chair", "bench", "couch",          # seating obstacles
    "door",                              # not a COCO class but kept for clarity
    "car", "truck", "bus", "motorcycle", "bicycle",  # vehicle hazards
    "fire hydrant", "stop sign", "parking meter",    # street fixtures
    "suitcase", "backpack",              # floor-level clutter
    "dining table", "desk",              # large flat obstacles
    "potted plant", "vase",              # standing objects
    "trash can", "bottle",
}


# ---------------------------------------------------------------------------
# Gemini response cache — keyed by request type ("detect" | "navigate")
# The last Gemini response is returned immediately while a new one is fetched
# in the background, so the caller never waits on the LLM.
# ---------------------------------------------------------------------------
_gemini_cache: dict[str, str] = {}
_gemini_lock = asyncio.Lock()

# Door-vision cache: keyed by frame dHash. When the path is blocked we ask
# Gemini "is there a door here, and where?"; the answer travels with future
# frames that hash similarly.
_gemini_door_cache: dict[int, dict] = {}
_gemini_door_inflight: set[int] = set()


def local_alert_text(objects: list[dict], nav_direction: str | None = None) -> str | None:
    """Rule-based fallback: generate a spoken alert from raw YOLO detections.

    Used when Gemini is unavailable or as the immediate response before the
    LLM result arrives.
    """
    # Suppress distant detections from local speech.
    speakable = [
        o for o in objects
        if float(o.get("distance_m") or o.get("distance") or 999) < DIST_INFO_MAX_M
    ]
    if not speakable:
        return None

    # Closest speakable object drives the local phrase.
    top = sorted(speakable, key=lambda o: float(o.get("distance_m") or o.get("distance") or 999))[0]
    cls = str(top.get("class") or top.get("label") or "object")
    zone = str(top.get("zone") or "center")
    dist = float(top.get("distance_m") or top.get("distance") or 999)
    dist_1dp = round(dist, 1)

    if dist < DIST_DANGER_MAX_M:
        return f"Stop. {cls} directly ahead."
    if dist < DIST_CAUTION_MAX_M:
        return f"Caution. {cls} {zone}, {dist_1dp} meters."
    return f"{cls} ahead, {dist_1dp} meters {zone}."


def get_direction(bbox, width):
    x1, _, x2, _ = bbox
    mid = (x1 + x2) / 2
    ratio = mid / width
    if ratio < 0.2:
        return "far left"
    elif ratio < 0.4:
        return "slightly left"
    elif ratio > 0.8:
        return "far right"
    elif ratio > 0.6:
        return "slightly right"
    return "directly ahead"

def bbox_to_zone(*, x1: int, x2: int, frame_w: int) -> str:
    cx = ((x1 + x2) / 2.0) / float(frame_w)
    if cx < ZONE_LEFT_MAX:
        return "left"
    if cx > ZONE_RIGHT_MIN:
        return "right"
    return "center"


def estimate_distance_m(*, cls_name: str, bbox_height_px: int) -> float:
    """Approximate distance using a pinhole camera model.

    distance_m = (REAL_HEIGHT_M[class] * FOCAL_PX) / bbox_height_px
    """
    if bbox_height_px <= 1:
        return DIST_MAX_M
    real_h = REAL_HEIGHT_M.get(cls_name, 1.0)
    dist = (real_h * float(FOCAL_PX)) / float(bbox_height_px)
    if dist < DIST_MIN_M:
        return DIST_MIN_M
    if dist > DIST_MAX_M:
        return DIST_MAX_M
    return dist

def distance_to_steps(meters):
    """Convert meters to approximate walking steps (avg step ~0.75m)."""
    return max(1, round(meters / 0.75))

def distance_to_feet(meters):
    """Convert meters to feet."""
    return round(meters * 3.28, 1)

def run_detection(frame) -> tuple[list[dict], float]:
    """Run YOLOv8 on a decoded frame, apply class + confidence filters.

    Returns (objects, yolo_ms) where objects is ready for Gemini.
    """
    h, w, _ = frame.shape
    t0 = time.perf_counter()
    results = yolo_model(frame, verbose=False)[0]
    yolo_ms = (time.perf_counter() - t0) * 1000

    objects = []
    for box in results.boxes:
        conf = float(box.conf[0])
        if conf < CONF_THRESHOLD:
            continue

        cls = int(box.cls[0])
        label = yolo_model.names[cls]
        if label not in ALLOWED_CLASSES:
            continue

        x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
        x1, y1, x2, y2 = int(x1), int(y1), int(x2), int(y2)

        bbox_h = max(1, y2 - y1)
        zone = bbox_to_zone(x1=x1, x2=x2, frame_w=w)
        distance_m = estimate_distance_m(cls_name=label, bbox_height_px=bbox_h)
        direction = get_direction((x1, y1, x2, y2), w)  # legacy/debug

        if distance_m < DIST_DANGER_MAX_M:
            risk = "danger"
        elif distance_m < DIST_CAUTION_MAX_M:
            risk = "caution"
        else:
            risk = "clear"

        objects.append({
            "class": label,
            "label": label,  # backward compatibility for existing frontend
            "confidence": round(conf, 3),
            "distance_m": round(distance_m, 3),
            "zone": zone,
            "distance": round(distance_m, 3),  # backward compatibility
            "direction": direction,  # backward compatibility
            "risk": risk,
            "bbox": (x1, y1, x2, y2),
        })

    return objects, yolo_ms


# ---------------------------------------------------------------------------
# Open-space clearance — combines YOLO blockers with a MiDaS depth pass so
# blank walls (which YOLO ignores) still register as "blocked".
# ---------------------------------------------------------------------------

# Depth-score below this = treated as a wall/very-close surface.
DEPTH_BLOCKED_SCORE_MAX = 0.25
# YOLO obstacle distance below this = treated as blocking that zone.
DEPTH_BLOCKED_OBSTACLE_MAX_M = 1.5
# MiDaS inference latency budget; if exceeded we skip depth this frame.
DEPTH_TIMEOUT_S = 0.4

# Frame-hash short-circuit: how similar is "similar enough" to reuse the
# previous response without re-running YOLO/MiDaS. dHash gives 64 bits.
# 64-bit dHash. 19/64 ≈ 30 %: frames more similar than this are treated as
# "no change" and the previous response is reused — no YOLO, no MiDaS, no
# Gemini, no TTS update.
FRAME_SIMILAR_HAMMING_MAX = 19

# Depth-opening detection thresholds.
OPENING_MIN_WIDTH_FRAC = 0.04   # min opening width as fraction of frame width
OPENING_MAX_WIDTH_FRAC = 0.25   # max opening width
OPENING_CONTRAST_MIN = 0.18     # neighbor-wall must be this much closer (inv-depth)


def _run_midas(frame_bgr) -> np.ndarray | None:
    """Run MiDaS on a BGR frame, return normalized inverse-depth map (0..1).

    Higher value = closer surface. Returns None if depth model unavailable or
    inference exceeds the latency budget.
    """
    if _midas_model is None or _midas_transform is None:
        return None
    try:
        import torch  # type: ignore
        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        t0 = time.perf_counter()
        input_tensor = _midas_transform(rgb).to(_midas_device)
        with torch.no_grad():
            pred = _midas_model(input_tensor)
            pred = torch.nn.functional.interpolate(
                pred.unsqueeze(1),
                size=rgb.shape[:2],
                mode="bicubic",
                align_corners=False,
            ).squeeze()
        elapsed = time.perf_counter() - t0
        if elapsed > DEPTH_TIMEOUT_S:
            logger.info("MiDaS slow (%.0f ms), keeping result", elapsed * 1000)
        depth = pred.cpu().numpy().astype("float32")
        d_min = float(depth.min())
        d_max = float(depth.max())
        if d_max - d_min < 1e-6:
            return None
        return (depth - d_min) / (d_max - d_min)
    except Exception as exc:  # noqa: BLE001
        logger.warning("MiDaS inference failed: %s", exc)
        return None


def compute_clearance(
    frame, objects: list[dict], inv_depth: np.ndarray | None
) -> dict:
    """Per-zone walkability.

    Each zone gets:
      - blocked: bool
      - score: 0..1 (1 = far/open)
      - nearest_obstacle_m: closest YOLO object distance in that zone, or None
    """
    h, w = frame.shape[:2]
    zone_bounds = {
        "left": (0, int(w * ZONE_LEFT_MAX)),
        "center": (int(w * ZONE_LEFT_MAX), int(w * ZONE_RIGHT_MIN)),
        "right": (int(w * ZONE_RIGHT_MIN), w),
    }

    # Nearest YOLO obstacle per zone (ignore "clear"-risk objects so distant
    # ones don't gate the zone).
    nearest_by_zone: dict[str, float | None] = {"left": None, "center": None, "right": None}
    for o in objects:
        zone = str(o.get("zone") or "center")
        dist = float(o.get("distance_m") or o.get("distance") or 999)
        if dist >= DIST_MAX_M:
            continue
        cur = nearest_by_zone.get(zone)
        if cur is None or dist < cur:
            nearest_by_zone[zone] = dist

    # Depth-derived clearance score per zone (lower 2/3 of frame, skip ceiling).
    depth_scores: dict[str, float | None] = {"left": None, "center": None, "right": None}
    if inv_depth is not None:
        y0 = int(h * 0.33)
        lower = inv_depth[y0:, :]
        for zone, (x0, x1) in zone_bounds.items():
            strip = lower[:, x0:x1]
            if strip.size == 0:
                continue
            median_inv = float(np.median(strip))
            # 1 = far/open, 0 = wall
            depth_scores[zone] = max(0.0, min(1.0, 1.0 - median_inv))

    out: dict[str, dict] = {}
    for zone in ("left", "center", "right"):
        nearest = nearest_by_zone[zone]
        depth_score = depth_scores[zone]
        # If depth missing, fall back to YOLO-only judgement.
        score = depth_score if depth_score is not None else (
            1.0 if nearest is None else max(0.0, min(1.0, (nearest - 0.3) / 5.0))
        )
        blocked = False
        if nearest is not None and nearest < DEPTH_BLOCKED_OBSTACLE_MAX_M:
            blocked = True
        if depth_score is not None and depth_score < DEPTH_BLOCKED_SCORE_MAX:
            blocked = True
        out[zone] = {
            "blocked": bool(blocked),
            "score": round(float(score), 3),
            "nearest_obstacle_m": round(float(nearest), 2) if nearest is not None else None,
        }
    return out


def find_yolo_doors(objects: list[dict]) -> list[dict]:
    """Return YOLO-detected doors sorted by distance.

    NOTE: YOLOv8 COCO has no `door` class, so in practice this returns []
    until the model is swapped. Kept so that response shape doesn't change
    when we upgrade to a model that ships doors.
    """
    doors = []
    for o in objects:
        label = str(o.get("class") or o.get("label") or "")
        if label != "door":
            continue
        doors.append({
            "zone": str(o.get("zone") or "center"),
            "distance_m": round(float(o.get("distance_m") or o.get("distance") or 0.0), 2),
            "confidence": float(o.get("confidence") or 0.0),
            "source": "yolo",
        })
    doors.sort(key=lambda d: d["distance_m"])
    return doors


def find_openings(inv_depth: np.ndarray | None, frame_w: int) -> list[dict]:
    """Detect doorway-like openings purely from the depth map.

    An opening is a vertical strip of "far" depth flanked by "near" walls.
    We collapse the lower 2/3 of the inverse-depth map to a column profile,
    smooth it, then scan for valleys (low inverse-depth = far) of plausible
    door width with sufficient contrast to their neighbors.
    """
    if inv_depth is None:
        return []
    h, w = inv_depth.shape
    if w <= 0:
        return []
    y0 = int(h * 0.33)
    lower = inv_depth[y0:, :]
    # Column profile: mean inverse-depth per x.
    col = lower.mean(axis=0).astype("float32")
    # Smooth with a centered moving average. `mode='same'` guarantees the
    # output has the same length as the input — guards against the off-by-one
    # we previously hit with the cumsum trick.
    k = max(5, w // 64)
    if k % 2 == 0:
        k += 1
    kernel = np.ones(k, dtype="float32") / float(k)
    smooth = np.convolve(col, kernel, mode="same")
    if smooth.shape[0] != w:
        # Final safety net — pad/truncate to exactly w.
        if smooth.shape[0] < w:
            smooth = np.pad(smooth, (0, w - smooth.shape[0]), mode="edge")
        else:
            smooth = smooth[:w]

    min_width = max(1, int(w * OPENING_MIN_WIDTH_FRAC))
    max_width = max(min_width + 1, int(w * OPENING_MAX_WIDTH_FRAC))

    openings: list[dict] = []
    i = 0
    while i < w:
        if smooth[i] > 0.45:  # near surface — skip
            i += 1
            continue
        # Find valley extent.
        j = i
        while j < w and smooth[j] < 0.45:
            j += 1
        width = j - i
        if min_width <= width <= max_width:
            valley = smooth[i:j]
            cx = int((i + j) / 2)
            # Compare with neighbors (walls on each side).
            left_lo = max(0, i - max_width)
            right_hi = min(w, j + max_width)
            left_neighbor = smooth[left_lo:i]
            right_neighbor = smooth[j:right_hi]
            wall_inv = 0.0
            n = 0
            if left_neighbor.size:
                wall_inv += float(left_neighbor.max()); n += 1
            if right_neighbor.size:
                wall_inv += float(right_neighbor.max()); n += 1
            if n == 0:
                i = j + 1
                continue
            wall_inv /= n
            contrast = wall_inv - float(valley.mean())
            if contrast >= OPENING_CONTRAST_MIN:
                zone = (
                    "left" if cx < w * ZONE_LEFT_MAX else
                    "right" if cx > w * ZONE_RIGHT_MIN else
                    "center"
                )
                # Rough "distance" from inverse-depth: smaller inv = farther.
                # Map [0, 0.45] inv-depth onto [10, 1.5] m heuristically.
                inv_avg = max(0.05, float(valley.mean()))
                approx_m = max(1.0, min(10.0, (1.0 / inv_avg) * 0.8))
                openings.append({
                    "zone": zone,
                    "distance_m": round(approx_m, 2),
                    "confidence": round(min(1.0, contrast * 2.0), 2),
                    "source": "depth",
                })
        i = j + 1

    openings.sort(key=lambda d: (-d["confidence"], d["distance_m"]))
    return openings[:3]


def pick_recommended_zone(
    clearance: dict, preferred_targets: list[dict]
) -> tuple[str | None, bool]:
    """Pick the best zone to steer toward.

    Preferred targets (doors or depth-detected openings) bias the
    recommendation: if one is in an unblocked zone we prefer it even if
    another zone scores slightly higher. Returns
    (recommended_zone | None, open_path_available).
    """
    unblocked = [(z, clearance[z]["score"]) for z in ("left", "center", "right") if not clearance[z]["blocked"]]
    if not unblocked:
        return None, False

    for d in preferred_targets:
        z = d["zone"]
        if any(z == zz for zz, _ in unblocked):
            return z, True

    unblocked.sort(key=lambda zs: zs[1], reverse=True)
    return unblocked[0][0], True


# ---------------------------------------------------------------------------
# Frame-similarity short-circuit: when the camera view hasn't changed enough
# to be worth re-running YOLO + MiDaS, reuse the last response. dHash is
# computed on an 8×8 grayscale gradient and compared by hamming distance.
# ---------------------------------------------------------------------------
_last_frame_hash: int | None = None
_last_nav_response: dict | None = None


def dhash_int(frame_bgr) -> int:
    """8-bit difference hash returning a 64-bit int."""
    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    small = cv2.resize(gray, (9, 8), interpolation=cv2.INTER_AREA)
    diff = small[:, 1:] > small[:, :-1]
    bits = 0
    for b in diff.flatten():
        bits = (bits << 1) | (1 if b else 0)
    return int(bits)


def hamming64(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


async def query_gemini(detected_objects):
    prompt = (
        "You are a real-time navigation assistant for a blind person. "
        "Your job is to give short, actionable MOVEMENT INSTRUCTIONS — not just object labels.\n\n"
        "RULES:\n"
        "- Lead with the safest action: where to move, which direction to turn, or whether to stop.\n"
        "- Use intuitive units: steps (1 step ≈ 2.5 feet) and clock directions when helpful.\n"
        "- Mention obstacles only in terms of how to AVOID them.\n"
        "- If the path ahead is clear, say so with the clear distance.\n"
        "- For approaching people, indicate their direction of movement.\n"
        "- Be concise: 1–2 sentences max. Speak as if guiding someone in real time.\n\n"
        "GOOD examples:\n"
        '- "Move slightly right, path clear for 6 feet."\n'
        '- "Stop. Chair directly ahead, 2 steps away. Step left to go around."\n'
        '- "Door on your left, reachable in 3 steps."\n'
        '- "Person approaching from your right."\n'
        '- "Path is clear ahead for about 10 feet."\n\n'
        "BAD examples (do NOT say these):\n"
        '- "Chair ahead" (just a label, no action)\n'
        '- "I see a person and a table" (description, not navigation)\n\n'
        "Detected objects:\n"
    )
    for obj in detected_objects:
        steps = distance_to_steps(obj['distance'])
        feet = distance_to_feet(obj['distance'])
        prompt += (
            f"- {obj['label']}: {obj['direction']}, ~{feet} ft away (~{steps} steps), "
            f"risk: {obj['risk']}\n"
        )

    if not detected_objects:
        prompt += "- No objects detected.\n"
    prompt += "\nGive a navigation instruction now:"
    
    if not GEMINI_API_KEY:
        return "API key not configured. Please set GEMINI_API_KEY in your .env file."
    
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
    )
    json_data = {
        "contents": [
            {"parts": [{"text": prompt}]}
        ]
    }
    async with httpx.AsyncClient() as client:
        response = await client.post(url, json=json_data)
        if response.status_code != 200:
            error_detail = response.text
            print(f"Gemini API error: {response.status_code} - {error_detail}")
            # Return a fallback message instead of crashing
            return f"Warning: {len(detected_objects)} object(s) detected nearby. Please proceed with caution."
        data = response.json()
        return data["candidates"][0]["content"]["parts"][0]["text"]

async def query_gemini_navigate(detected_objects, nav_direction, nav_distance_ft):
    """Navigation-aware Gemini prompt: knows where the user is headed and prioritizes obstacle avoidance."""
    has_obstacles = any(o['risk'] in ('danger', 'caution') for o in detected_objects)

    prompt = (
        "You are a real-time navigation assistant guiding a blind person along a saved walking route.\n"
        f"They are currently heading: {nav_direction}, with {nav_distance_ft} feet remaining to the next waypoint.\n\n"
    )

    if has_obstacles:
        prompt += (
            "OBSTACLES DETECTED in their path. Your #1 priority is to help them AVOID these obstacles "
            "while staying as close to their intended route as possible.\n\n"
            "RULES:\n"
            "- If an obstacle is directly ahead or in the path, tell them to STOP first, then give avoidance direction.\n"
            "- After the avoidance move, tell them how to get BACK on their route.\n"
            "- Use steps and feet. Be concise: 2 sentences max.\n\n"
            "GOOD examples:\n"
            '- "Stop. Large obstacle ahead, 2 steps away. Step 3 steps to your left, then continue forward."\n'
            '- "Caution, object on your right. Stay left and keep going straight for 15 feet."\n'
            '- "Person ahead blocking your path. Pause, then move right to pass them."\n\n'
        )
    else:
        prompt += (
            "The path ahead appears CLEAR of obstacles.\n\n"
            "RULES:\n"
            "- Confirm the path is clear and reinforce the GPS direction.\n"
            "- Be concise: 1 sentence.\n\n"
            "GOOD examples:\n"
            '- "Path clear. Continue straight ahead for 30 feet."\n'
            '- "No obstacles. Keep heading slightly right, 20 feet to go."\n\n'
        )

    prompt += "Detected objects:\n"
    for obj in detected_objects:
        steps = distance_to_steps(obj['distance'])
        feet = distance_to_feet(obj['distance'])
        prompt += (
            f"- {obj['label']}: {obj['direction']}, ~{feet} ft away (~{steps} steps), "
            f"risk: {obj['risk']}\n"
        )
    if not detected_objects:
        prompt += "- No objects detected.\n"
    prompt += "\nGive a navigation instruction now:"

    if not GEMINI_API_KEY:
        return "API key not configured. Please set GEMINI_API_KEY in your .env file."

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
    )
    json_data = {
        "contents": [
            {"parts": [{"text": prompt}]}
        ]
    }
    async with httpx.AsyncClient() as client:
        response = await client.post(url, json=json_data)
        if response.status_code != 200:
            error_detail = response.text
            print(f"Gemini API error: {response.status_code} - {error_detail}")
            if has_obstacles:
                return f"Warning: obstacle detected nearby. Stop and proceed with caution."
            return f"Path appears clear. Continue {nav_direction}."
        data = response.json()
        return data["candidates"][0]["content"]["parts"][0]["text"]


async def query_gemini_door_vision(jpeg_bytes: bytes) -> dict:
    """Ask Gemini Vision whether the frame contains a door blocking the user.

    Returns: {present: bool, zone: 'left'|'center'|'right'|None,
              action: 'open' | 'push' | 'pull' | None,
              raw: str}.

    Falls back to {present: False} on any failure so the nav loop is safe.
    """
    if not GEMINI_API_KEY:
        return {"present": False, "zone": None, "action": None, "raw": ""}

    import base64
    b64 = base64.b64encode(jpeg_bytes).decode("ascii")

    prompt = (
        "You are helping a blind person navigate. This camera frame shows the path "
        "in front of them and something is blocking the way forward. Look carefully: "
        "is the obstacle a CLOSED DOOR that they could open?\n\n"
        "Respond with a single JSON object on one line, no markdown, no prose:\n"
        '{"present": <bool>, "zone": "<left|center|right|null>", "action": "<open|push|pull|null>"}\n\n'
        "Rules:\n"
        "- present=true ONLY if you see a clear door (knob, handle, frame, push plate).\n"
        "- present=false for walls, furniture, people, pets, generic clutter.\n"
        "- zone: which third of the image the door occupies.\n"
        "- action: open / push / pull (best guess from handle type); null if unsure.\n"
        "Output nothing but the single JSON line."
    )

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
    )
    payload = {
        "contents": [{
            "parts": [
                {"text": prompt},
                {"inline_data": {"mime_type": "image/jpeg", "data": b64}},
            ]
        }],
        "generationConfig": {"temperature": 0.0, "maxOutputTokens": 64},
    }

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(url, json=payload)
        if resp.status_code != 200:
            logger.warning("Gemini door check failed: %s %s", resp.status_code, resp.text[:200])
            return {"present": False, "zone": None, "action": None, "raw": ""}
        data = resp.json()
        raw = data["candidates"][0]["content"]["parts"][0]["text"].strip()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Gemini door check exception: %s", exc)
        return {"present": False, "zone": None, "action": None, "raw": ""}

    # Parse the JSON line. Be defensive — Gemini sometimes adds backticks.
    import json
    raw_clean = raw.strip().strip("`").strip()
    if raw_clean.lower().startswith("json"):
        raw_clean = raw_clean[4:].strip()
    try:
        parsed = json.loads(raw_clean)
        return {
            "present": bool(parsed.get("present", False)),
            "zone": parsed.get("zone") if parsed.get("zone") in ("left", "center", "right") else None,
            "action": parsed.get("action") if parsed.get("action") in ("open", "push", "pull") else None,
            "raw": raw,
        }
    except Exception:
        # Cheap fallback: keyword scan.
        low = raw.lower()
        present = "true" in low and "door" not in low.split('"present"')[0][-20:] is False  # noqa
        return {"present": "true" in low, "zone": None, "action": None, "raw": raw}


@app.post("/detect/")
async def detect(file: UploadFile = File(...)):
    t_start = time.perf_counter()

    contents = await file.read()
    np_arr = np.frombuffer(contents, np.uint8)
    frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

    objects, yolo_ms = run_detection(frame)

    # Return immediately with local phrasing; update cache with Gemini in background.
    immediate_text = _gemini_cache.get("detect") or local_alert_text(objects) or ""
    total_ms = (time.perf_counter() - t_start) * 1000

    async def _refresh_gemini():
        result = await query_gemini(objects)
        _gemini_cache["detect"] = result

    asyncio.create_task(_refresh_gemini())

    return {
        "objects": objects,
        "alert_text": immediate_text,
        "perf": {
            "yolo_ms": round(yolo_ms),
            "gemini_ms": -1,  # async — not measured on this request
            "total_ms": round(total_ms),
        },
    }

@app.post("/detect-navigate/")
async def detect_navigate(
    file: UploadFile = File(...),
    nav_direction: str = "straight ahead",
    nav_distance_ft: float = 0,
):
    """Detection endpoint for active navigation — obstacle-aware with GPS context."""
    t_start = time.perf_counter()

    contents = await file.read()
    np_arr = np.frombuffer(contents, np.uint8)
    frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

    global _last_frame_hash, _last_nav_response

    # Frame-similarity short-circuit: if this frame is nearly identical to
    # the previous one, return the cached response (just update the GPS
    # context fields). Saves 300–500 ms when the user is standing still.
    hash_t0 = time.perf_counter()
    frame_hash = dhash_int(frame)
    hash_ms = (time.perf_counter() - hash_t0) * 1000

    if (
        _last_frame_hash is not None
        and _last_nav_response is not None
        and hamming64(frame_hash, _last_frame_hash) <= FRAME_SIMILAR_HAMMING_MAX
    ):
        cached = dict(_last_nav_response)
        # Pull the freshest door-vision result if Gemini answered in between.
        door_update = (
            _gemini_door_cache.get(frame_hash)
            or _gemini_door_cache.get(_last_frame_hash)
            or cached.get("door_at_block")
        )
        if door_update is not None:
            cached["door_at_block"] = door_update
        cached["perf"] = {
            **cached.get("perf", {}),
            "cached": True,
            "hash_ms": round(hash_ms, 1),
            "total_ms": round((time.perf_counter() - t_start) * 1000),
        }
        return cached

    objects, yolo_ms = run_detection(frame)
    has_obstacle = any(o['risk'] in ('danger', 'caution') for o in objects)

    # Depth-aware clearance.
    depth_t0 = time.perf_counter()
    inv_depth = _run_midas(frame)
    depth_ms = (time.perf_counter() - depth_t0) * 1000
    clearance = compute_clearance(frame, objects, inv_depth)
    yolo_doors = find_yolo_doors(objects)
    depth_openings = find_openings(inv_depth, frame.shape[1])
    preferred_targets = depth_openings + yolo_doors
    recommended_zone, open_path_available = pick_recommended_zone(clearance, preferred_targets)

    # Door-vision check: only when the user can't simply walk forward.
    # Trigger if center zone is blocked OR all paths are blocked.
    path_truly_blocked = (
        clearance["center"]["blocked"] or not open_path_available
    )
    door_at_block: dict = _gemini_door_cache.get(frame_hash) or {
        "present": False, "zone": None, "action": None
    }
    if path_truly_blocked and frame_hash not in _gemini_door_inflight:
        _gemini_door_inflight.add(frame_hash)
        _frame_hash_for_door = frame_hash
        _jpeg_bytes_for_door = contents

        async def _check_door():
            try:
                result = await query_gemini_door_vision(_jpeg_bytes_for_door)
                _gemini_door_cache[_frame_hash_for_door] = result
                # Bound cache size — keep last 32 frames.
                if len(_gemini_door_cache) > 32:
                    oldest = next(iter(_gemini_door_cache))
                    _gemini_door_cache.pop(oldest, None)
            finally:
                _gemini_door_inflight.discard(_frame_hash_for_door)

        asyncio.create_task(_check_door())

    # Return immediately; update Gemini cache in background.
    immediate_text = _gemini_cache.get("navigate") or local_alert_text(objects, nav_direction) or ""
    total_ms = (time.perf_counter() - t_start) * 1000

    async def _refresh_gemini_nav():
        result = await query_gemini_navigate(objects, nav_direction, nav_distance_ft)
        _gemini_cache["navigate"] = result

    asyncio.create_task(_refresh_gemini_nav())

    response = {
        "objects": objects,
        "alert_text": immediate_text,
        "has_obstacle": has_obstacle,
        "obstacle_detected": has_obstacle,
        "clearance": clearance,
        "doors": yolo_doors,             # backward-compat
        "openings": depth_openings,      # Phase 2
        "door_at_block": door_at_block,  # Phase 3: Gemini-vision door check
        "recommended_zone": recommended_zone,
        "open_path_available": open_path_available,
        "depth_available": inv_depth is not None,
        "perf": {
            "yolo_ms": round(yolo_ms),
            "depth_ms": round(depth_ms),
            "hash_ms": round(hash_ms, 1),
            "cached": False,
            "gemini_ms": -1,  # async
            "total_ms": round(total_ms),
        },
    }

    _last_frame_hash = frame_hash
    _last_nav_response = response
    return response


@app.get("/health")
async def health():
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
