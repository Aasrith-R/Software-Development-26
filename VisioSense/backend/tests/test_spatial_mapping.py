import math
import sys

sys.dont_write_bytecode = True


def test_local_alert_text_chair_right_at_one_meter():
    # Import module under test
    from backend import camera_tts

    frame_w = 640
    # Center-x ratio > 0.65 => right
    x1, x2 = 450, 600
    zone = camera_tts.bbox_to_zone(x1=x1, x2=x2, frame_w=frame_w)
    assert zone == "right"

    # Chair at ~1.0m using pinhole model: dist = (H * F) / px_h
    # px_h = (0.9m * 500px) / 1.0m = 450px
    dist = camera_tts.estimate_distance_m(cls_name="chair", bbox_height_px=450)
    assert math.isclose(dist, 1.0, rel_tol=0.05)

    phrase = camera_tts.local_alert_text(
        [
            {
                "class": "chair",
                "zone": zone,
                "distance_m": dist,
                "risk": "caution",
            }
        ]
    )
    assert phrase == "Caution. chair right, 1.0 meters."
