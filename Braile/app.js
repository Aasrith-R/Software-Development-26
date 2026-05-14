import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";

const app = {
  defaults: {
    dotDiameterMm: 1.5,
    dotHeightMm: 0.6,
    dotSpacingMm: 2.5,
    cellSpacingMm: 6.0,
    lineSpacingMm: 10.0,
    plateThicknessMm: 2.0,
    plateMarginMm: 5.0,
    includePlate: true,
    dotShape: "hemisphere",
    text: "hello world",
  },
  ui: {},
  three: {
    scene: null,
    renderer: null,
    camera: null,
    controls: null,
    exporter: null,
    modelGroup: null,
    material: null,
  },
  lastBuild: {
    cells: null,
    params: null,
    sourceText: "",
  },
};

/**
 * Convert a list of dot numbers (1–6) into a bool[6] pattern.
 * Dot numbering:
 *  1 4
 *  2 5
 *  3 6
 */
function dotsToPattern(dotNumbers) {
  const pattern = [false, false, false, false, false, false];
  for (const n of dotNumbers) {
    if (n >= 1 && n <= 6) pattern[n - 1] = true;
  }
  return pattern;
}

/**
 * Grade 1 (uncontracted) English Braille: map of lowercase ASCII to bool[6].
 * This app treats only a minimal punctuation set as required.
 */
function getBrailleMap() {
  const letters = {
    a: [1],
    b: [1, 2],
    c: [1, 4],
    d: [1, 4, 5],
    e: [1, 5],
    f: [1, 2, 4],
    g: [1, 2, 4, 5],
    h: [1, 2, 5],
    i: [2, 4],
    j: [2, 4, 5],
    k: [1, 3],
    l: [1, 2, 3],
    m: [1, 3, 4],
    n: [1, 3, 4, 5],
    o: [1, 3, 5],
    p: [1, 2, 3, 4],
    q: [1, 2, 3, 4, 5],
    r: [1, 2, 3, 5],
    s: [2, 3, 4],
    t: [2, 3, 4, 5],
    u: [1, 3, 6],
    v: [1, 2, 3, 6],
    w: [2, 4, 5, 6],
    x: [1, 3, 4, 6],
    y: [1, 3, 4, 5, 6],
    z: [1, 3, 5, 6],
  };

  const punctuation = {
    ".": [2, 5, 6],
    ",": [2],
    ";": [2, 3],
    ":": [2, 5],
    "!": [2, 3, 5],
    "?": [2, 3, 6],
    "'": [3],
    '"': [3, 5, 6],
    "-": [3, 6],
    "(": [2, 3, 5, 6],
    ")": [2, 3, 5, 6],
  };

  const map = new Map();
  for (const [ch, dots] of Object.entries(letters)) map.set(ch, dotsToPattern(dots));
  for (const [ch, dots] of Object.entries(punctuation)) map.set(ch, dotsToPattern(dots));
  map.set(" ", dotsToPattern([]));
  return map;
}

const BRAILLE_MAP = getBrailleMap();
const NUMBER_INDICATOR = dotsToPattern([3, 4, 5, 6]);
const CAPITAL_INDICATOR = dotsToPattern([6]);

/**
 * Convert input text to an array of braille cell objects.
 * Returns: Array<{ dots: boolean[6], isLineBreak: boolean }>
 */
export function textToBrailleCells(text) {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const cells = [];

  const numberToLetter = {
    "1": "a",
    "2": "b",
    "3": "c",
    "4": "d",
    "5": "e",
    "6": "f",
    "7": "g",
    "8": "h",
    "9": "i",
    "0": "j",
  };

  let inNumberMode = false;

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];

    if (ch === "\n") {
      cells.push({ dots: dotsToPattern([]), isLineBreak: true });
      inNumberMode = false;
      continue;
    }

    if (ch >= "0" && ch <= "9") {
      if (!inNumberMode) {
        cells.push({ dots: NUMBER_INDICATOR.slice(), isLineBreak: false });
        inNumberMode = true;
      }
      const letter = numberToLetter[ch];
      const patt = BRAILLE_MAP.get(letter);
      if (patt) cells.push({ dots: patt.slice(), isLineBreak: false });
      continue;
    }

    inNumberMode = false;

    if (ch >= "A" && ch <= "Z") {
      cells.push({ dots: CAPITAL_INDICATOR.slice(), isLineBreak: false });
      const lower = ch.toLowerCase();
      const patt = BRAILLE_MAP.get(lower);
      if (patt) {
        cells.push({ dots: patt.slice(), isLineBreak: false });
      } else {
        console.warn(`[braille] Unknown capital mapping: "${ch}"`);
      }
      continue;
    }

    const patt = BRAILLE_MAP.get(ch);
    if (patt) {
      cells.push({ dots: patt.slice(), isLineBreak: false });
    } else if (ch !== "\t") {
      console.warn(`[braille] Skipping unknown char: "${ch}"`);
    }
  }

  return cells;
}

/**
 * Build a THREE.Group containing the braille dots and optional base plate.
 * params units are millimeters; model uses 1 unit == 1mm.
 */
export function buildBrailleMesh(cells, params) {
  const group = new THREE.Group();
  group.name = "brailleModel";

  const {
    dotDiameterMm,
    dotHeightMm,
    dotSpacingMm,
    cellSpacingMm,
    lineSpacingMm,
    plateThicknessMm,
    plateMarginMm,
    includePlate,
    dotShape,
  } = params;

  const radius = dotDiameterMm / 2;
  const baseZ = includePlate ? plateThicknessMm : 0;
  const layoutMargin = includePlate ? plateMarginMm : 0;

  const positions = [];
  let col = 0;
  let line = 0;
  let maxCols = 0;

  for (const cell of cells) {
    if (cell.isLineBreak) {
      maxCols = Math.max(maxCols, col);
      col = 0;
      line += 1;
      continue;
    }
    positions.push({ dots: cell.dots, col, line });
    col += 1;
  }
  maxCols = Math.max(maxCols, col);
  const lineCount = line + 1;

  const usedWidth = Math.max(1, maxCols) * cellSpacingMm;
  const usedHeight = Math.max(1, lineCount) * lineSpacingMm;

  const plateWidth = usedWidth + 2 * plateMarginMm;
  const plateHeight = usedHeight + 2 * plateMarginMm;

  const material = new THREE.MeshStandardMaterial({
    color: 0xe8e8e8,
    roughness: 0.35,
    metalness: 0.02,
  });

  if (includePlate) {
    const plateGeom = new THREE.BoxGeometry(plateWidth, plateHeight, plateThicknessMm);
    const plate = new THREE.Mesh(plateGeom, material);
    plate.name = "basePlate";
    plate.position.set(plateWidth / 2 - plateMarginMm, -(plateHeight / 2 - plateMarginMm), plateThicknessMm / 2);
    group.add(plate);
  }

  const dotGeom = createDotGeometry(dotShape, radius, dotHeightMm);

  const cellOriginX = layoutMargin;
  const cellOriginY = -layoutMargin;

  const dotOffsets = [
    { idx: 0, x: 0, y: 0 }, // dot 1
    { idx: 1, x: 0, y: -dotSpacingMm }, // dot 2
    { idx: 2, x: 0, y: -2 * dotSpacingMm }, // dot 3
    { idx: 3, x: dotSpacingMm, y: 0 }, // dot 4
    { idx: 4, x: dotSpacingMm, y: -dotSpacingMm }, // dot 5
    { idx: 5, x: dotSpacingMm, y: -2 * dotSpacingMm }, // dot 6
  ];

  for (const p of positions) {
    const x0 = cellOriginX + p.col * cellSpacingMm;
    const y0 = cellOriginY - p.line * lineSpacingMm;
    for (const off of dotOffsets) {
      if (!p.dots[off.idx]) continue;
      const dot = new THREE.Mesh(dotGeom, material);
      dot.name = "dot";
      dot.position.set(x0 + off.x, y0 + off.y, baseZ);
      group.add(dot);
    }
  }

  // Center model at origin for nicer preview/export.
  const box = new THREE.Box3().setFromObject(group);
  const center = new THREE.Vector3();
  box.getCenter(center);
  group.position.sub(center);

  return group;
}

/**
 * Create a dot geometry whose flat base lies on the XY plane and extrudes in +Z.
 */
function createDotGeometry(shape, radius, height) {
  if (shape === "cone") {
    const geom = new THREE.ConeGeometry(radius, height, 24, 1, false);
    geom.rotateX(Math.PI / 2);
    geom.translate(0, 0, height / 2);
    return geom;
  }

  if (shape === "cylinder") {
    const geom = new THREE.CylinderGeometry(radius, radius, height, 24, 1, false);
    geom.rotateX(Math.PI / 2);
    geom.translate(0, 0, height / 2);
    return geom;
  }

  // Hemisphere (default): closed solid = half-sphere + flat disk cap at z=0.
  const hemi = new THREE.SphereGeometry(radius, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  // SphereGeometry is oriented along +Y; rotate so it extrudes +Z and put base at z=0.
  hemi.rotateX(Math.PI / 2);

  const cap = new THREE.CircleGeometry(radius, 24);
  // Face normal points +Z by default; flip to match outward normals for a closed solid.
  cap.rotateX(Math.PI);

  const merged = mergeGeometries([hemi, cap]);
  merged.computeVertexNormals();
  merged.translate(0, 0, radius);
  return merged;
}

/**
 * Merge multiple BufferGeometries (positions + normals + uvs if present) into one.
 * Keeps it lightweight to avoid extra addon imports for this no-build setup.
 */
function mergeGeometries(geometries) {
  const positions = [];
  const normals = [];

  let vertexOffset = 0;
  const indices = [];

  for (const g of geometries) {
    const geom = g.index ? g.toNonIndexed() : g;
    const pos = geom.getAttribute("position");
    const nor = geom.getAttribute("normal");

    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (nor) normals.push(nor.getX(i), nor.getY(i), nor.getZ(i));
    }

    for (let i = 0; i < pos.count; i++) indices.push(vertexOffset + i);
    vertexOffset += pos.count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  if (normals.length === positions.length) merged.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  merged.setIndex(indices);
  return merged;
}

/**
 * Initialize Three.js scene, camera, renderer, and controls.
 */
function initThree() {
  const viewport = document.getElementById("viewport");

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf0f0f0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  viewport.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
  camera.position.set(120, 90, 120);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;

  const ambient = new THREE.AmbientLight(0xffffff, 0.8);
  scene.add(ambient);
  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
  dir.position.set(160, 200, 260);
  scene.add(dir);

  const grid = new THREE.GridHelper(400, 40, 0xbfc5d1, 0xd6d9e0);
  grid.position.z = 0;
  scene.add(grid);

  const exporter = new STLExporter();

  app.three.scene = scene;
  app.three.renderer = renderer;
  app.three.camera = camera;
  app.three.controls = controls;
  app.three.exporter = exporter;

  function resize() {
    const rect = viewport.getBoundingClientRect();
    const w = Math.max(10, Math.floor(rect.width));
    const h = Math.max(10, Math.floor(rect.height));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  window.addEventListener("resize", resize);
  resize();

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();
}

/**
 * Fit camera/controls to the current model bounds.
 */
function fitCameraToObject(object3d) {
  const camera = app.three.camera;
  const controls = app.three.controls;

  const box = new THREE.Box3().setFromObject(object3d);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const maxDim = Math.max(size.x, size.y, size.z, 1);
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const dist = (maxDim / (2 * Math.tan(fov / 2))) * 1.35;

  const direction = new THREE.Vector3(1, 0.85, 1).normalize();
  camera.position.copy(center).addScaledVector(direction, dist);
  camera.near = Math.max(0.05, dist / 200);
  camera.far = dist * 20;
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.update();
}

/**
 * Read params from UI (values are in mm).
 */
function readParamsFromUI() {
  const ui = app.ui;
  return {
    dotDiameterMm: Number(ui.dotDiameterMm.value),
    dotHeightMm: Number(ui.dotHeightMm.value),
    dotSpacingMm: Number(ui.dotSpacingMm.value),
    cellSpacingMm: Number(ui.cellSpacingMm.value),
    lineSpacingMm: Number(ui.lineSpacingMm.value),
    plateThicknessMm: Number(ui.plateThicknessMm.value),
    plateMarginMm: Number(ui.plateMarginMm.value),
    includePlate: Boolean(ui.includePlate.checked),
    dotShape: String(ui.dotShape.value),
  };
}

/**
 * Replace the preview model group in the scene.
 */
function setPreviewModel(group) {
  const scene = app.three.scene;
  if (app.three.modelGroup) scene.remove(app.three.modelGroup);
  app.three.modelGroup = group;
  scene.add(group);
  fitCameraToObject(group);
}

/**
 * Generate the model from current UI + textarea.
 */
async function generateModel() {
  const ui = app.ui;
  ui.generateBtn.disabled = true;
  ui.generateBtn.textContent = "Generating…";
  setStatus("Generating model...", "ok");

  try {
    const params = readParamsFromUI();
    const text = ui.textInput.value.slice(0, 200);
    const cells = textToBrailleCells(text);
    const group = buildBrailleMesh(cells, params);

    setPreviewModel(group);

    app.lastBuild.cells = cells;
    app.lastBuild.params = params;
    app.lastBuild.sourceText = text;

    ui.downloadBtn.disabled = false;
    const raisedDots = cells.reduce((sum, cell) => sum + (cell.isLineBreak ? 0 : cell.dots.filter(Boolean).length), 0);
    setStatus(`Generated ${cells.filter((cell) => !cell.isLineBreak).length} Braille cells with ${raisedDots} raised dots.`, "ok");
  } catch (err) {
    console.error(err);
    ui.downloadBtn.disabled = true;
    setStatus(`Generation failed: ${err.message || err}`, "error");
  } finally {
    ui.generateBtn.disabled = false;
    ui.generateBtn.textContent = "Generate";
  }
}

/**
 * Export current model to a binary STL and trigger download.
 */
function downloadSTL() {
  if (!app.three.modelGroup) return;

  const exporter = app.three.exporter;
  const binary = exporter.parse(app.three.modelGroup, { binary: true });
  const blob = new Blob([binary], { type: "application/octet-stream" });

  const text = String(app.lastBuild.sourceText || "").trim();
  const sanitized = text
    .slice(0, 10)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "braille";

  const ts = new Date();
  const stamp =
    ts.getFullYear().toString() +
    String(ts.getMonth() + 1).padStart(2, "0") +
    String(ts.getDate()).padStart(2, "0") +
    "_" +
    String(ts.getHours()).padStart(2, "0") +
    String(ts.getMinutes()).padStart(2, "0") +
    String(ts.getSeconds()).padStart(2, "0");

  const filename = `braille_${sanitized}_${stamp}.stl`;

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  setStatus(`Downloaded ${filename}.`, "ok");
}

/**
 * Show a visible status message for generation/export actions.
 */
function setStatus(message, type = "") {
  const status = app.ui.status;
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("status--ok", type === "ok");
  status.classList.toggle("status--error", type === "error");
}

/**
 * Bind a range input and a number input so they stay in sync.
 */
function bindRangeNumberPair(key, rangeEl, numberEl) {
  const clamp = (v) => {
    const min = Number(rangeEl.min);
    const max = Number(rangeEl.max);
    return Math.min(max, Math.max(min, v));
  };

  const setBoth = (v) => {
    const val = clamp(Number(v));
    rangeEl.value = String(val);
    numberEl.value = String(val);
  };

  rangeEl.addEventListener("input", () => setBoth(rangeEl.value));
  numberEl.addEventListener("input", () => setBoth(numberEl.value));

  app.ui[key] = rangeEl;
  app.ui[`${key}Number`] = numberEl;

  return setBoth;
}

/**
 * Initialize UI controls, defaults, and event handlers.
 */
function initUI() {
  const ui = (app.ui = {
    textInput: document.getElementById("textInput"),
    charCount: document.getElementById("charCount"),
    includePlate: document.getElementById("includePlate"),
    dotShape: document.getElementById("dotShape"),
    status: document.getElementById("status"),
    generateBtn: document.getElementById("generateBtn"),
    downloadBtn: document.getElementById("downloadBtn"),
    resetBtn: document.getElementById("resetBtn"),
    dotDiameterMm: document.getElementById("dotDiameterMm"),
    dotHeightMm: document.getElementById("dotHeightMm"),
    dotSpacingMm: document.getElementById("dotSpacingMm"),
    cellSpacingMm: document.getElementById("cellSpacingMm"),
    lineSpacingMm: document.getElementById("lineSpacingMm"),
    plateThicknessMm: document.getElementById("plateThicknessMm"),
    plateMarginMm: document.getElementById("plateMarginMm"),
  });

  const setters = [];
  setters.push(bindRangeNumberPair("dotDiameterMm", ui.dotDiameterMm, document.getElementById("dotDiameterMmNumber")));
  setters.push(bindRangeNumberPair("dotHeightMm", ui.dotHeightMm, document.getElementById("dotHeightMmNumber")));
  setters.push(bindRangeNumberPair("dotSpacingMm", ui.dotSpacingMm, document.getElementById("dotSpacingMmNumber")));
  setters.push(bindRangeNumberPair("cellSpacingMm", ui.cellSpacingMm, document.getElementById("cellSpacingMmNumber")));
  setters.push(bindRangeNumberPair("lineSpacingMm", ui.lineSpacingMm, document.getElementById("lineSpacingMmNumber")));
  setters.push(bindRangeNumberPair("plateThicknessMm", ui.plateThicknessMm, document.getElementById("plateThicknessMmNumber")));
  setters.push(bindRangeNumberPair("plateMarginMm", ui.plateMarginMm, document.getElementById("plateMarginMmNumber")));

  function updateCounter() {
    ui.charCount.textContent = String(ui.textInput.value.length);
  }

  ui.textInput.addEventListener("input", updateCounter);

  ui.generateBtn.addEventListener("click", () => generateModel());
  ui.downloadBtn.addEventListener("click", downloadSTL);
  ui.resetBtn.addEventListener("click", () => {
    applyDefaults();
    generateModel();
  });

  function applyDefaults() {
    ui.textInput.value = app.defaults.text;
    updateCounter();

    ui.includePlate.checked = app.defaults.includePlate;
    ui.dotShape.value = app.defaults.dotShape;

    document.getElementById("dotDiameterMmNumber").value = app.defaults.dotDiameterMm;
    document.getElementById("dotHeightMmNumber").value = app.defaults.dotHeightMm;
    document.getElementById("dotSpacingMmNumber").value = app.defaults.dotSpacingMm;
    document.getElementById("cellSpacingMmNumber").value = app.defaults.cellSpacingMm;
    document.getElementById("lineSpacingMmNumber").value = app.defaults.lineSpacingMm;
    document.getElementById("plateThicknessMmNumber").value = app.defaults.plateThicknessMm;
    document.getElementById("plateMarginMmNumber").value = app.defaults.plateMarginMm;

    ui.dotDiameterMm.value = app.defaults.dotDiameterMm;
    ui.dotHeightMm.value = app.defaults.dotHeightMm;
    ui.dotSpacingMm.value = app.defaults.dotSpacingMm;
    ui.cellSpacingMm.value = app.defaults.cellSpacingMm;
    ui.lineSpacingMm.value = app.defaults.lineSpacingMm;
    ui.plateThicknessMm.value = app.defaults.plateThicknessMm;
    ui.plateMarginMm.value = app.defaults.plateMarginMm;
  }

  applyDefaults();
}

function main() {
  try {
    initUI();
    initThree();
    generateModel();
  } catch (err) {
    console.error(err);
    alert(
      "App failed to start. Open DevTools Console for details.\n\nCommon fix: run via a local web server (some browsers block module imports on file://).\nExample: `python -m http.server` then open http://localhost:8000/"
    );
  }
}

main();
