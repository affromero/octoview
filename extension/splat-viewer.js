// Spark splat renderer for the extension viewer page. External module (script-src
// 'self') so no inline-module CSP question. Spark's worker + WASM run here because
// the extension page's CSP allows them. Any failure is posted to the parent so the
// content script can log it and fall back to the main-thread renderer.
import { THREE, OrbitControls, SparkRenderer, SplatMesh } from './vendor/spark.esm.js';

const post = (msg) => parent.postMessage(msg, '*');

// Source coordinate systems (matches render3d.js). three.js is OpenGL (Y-up), so
// each entry rotates data authored in that convention up into this view.
const X = new THREE.Vector3(1, 0, 0);
const CONVENTIONS = {
  'OpenGL (Y-up)': new THREE.Quaternion(),
  'Z-up (Blender, ROS, CAD)': new THREE.Quaternion().setFromAxisAngle(X, -Math.PI / 2),
  'OpenCV (Y-down, Z-fwd)': new THREE.Quaternion().setFromAxisAngle(X, Math.PI),
};

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x0d1117);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.01, 2000);
camera.position.set(0, 0, 3);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
const spark = new SparkRenderer({ renderer });
scene.add(spark);

let splatMesh = null;

function frame() {
  if (!splatMesh) return;
  const box = new THREE.Box3().setFromObject(splatMesh);
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3());
  const d = Math.max(s.x, s.y, s.z) || 1;
  camera.position.copy(c).add(new THREE.Vector3(0, 0, d * 2.2));
  camera.near = d / 100;
  camera.far = d * 100;
  camera.updateProjectionMatrix();
  controls.target.copy(c);
  controls.update();
}

// Compact display controls for inspecting the same splat under different rendering
// conditions. Spark reads these values each frame, so each change is immediate.
function buildPanel() {
  const panel = document.createElement('div');
  panel.className = 'panel';
  const title = document.createElement('div');
  title.className = 'panel-title';
  title.textContent = 'Display';
  panel.appendChild(title);

  const settings = [
    {
      label: 'Opacity',
      min: 0,
      max: 1,
      step: 0.01,
      value: 1,
      format: (value) => Math.round(value * 100) + '%',
      apply: (value) => (splatMesh.opacity = value),
    },
    {
      label: 'Size',
      min: 0.25,
      max: 2.5,
      step: 0.05,
      value: 1,
      format: (value) => value.toFixed(2) + '×',
      apply: (value) => splatMesh.scale.setScalar(value),
    },
    {
      label: 'Radius',
      min: 2,
      max: 3,
      step: 0.05,
      value: Math.sqrt(8),
      format: (value) => value.toFixed(2),
      apply: (value) => (spark.maxStdDev = value),
    },
    {
      label: 'Falloff',
      min: 0,
      max: 1,
      step: 0.05,
      value: 1,
      format: (value) => Math.round(value * 100) + '%',
      apply: (value) => (spark.falloff = value),
    },
  ];
  const resetters = settings.map((setting) => addSlider(panel, setting));

  const background = addSelect(panel, 'Background', [
    ['Midnight', 0x0d1117],
    ['Slate', 0x21262d],
    ['White', 0xf6f8fa],
  ]);
  background.select.onchange = () => renderer.setClearColor(background.value());

  const label = document.createElement('label');
  label.className = 'panel-select';
  label.textContent = 'Coords';
  const select = document.createElement('select');
  for (const name of Object.keys(CONVENTIONS)) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  }
  select.onchange = () => {
    splatMesh.quaternion.copy(CONVENTIONS[select.value]);
    frame();
  };
  label.appendChild(select);
  panel.appendChild(label);

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = 'Reset display';
  reset.onclick = () => {
    resetters.forEach((resetter) => resetter());
    background.reset();
  };
  panel.appendChild(reset);
  document.body.appendChild(panel);
}

function addSlider(panel, { label, min, max, step, value, format, apply }) {
  const field = document.createElement('label');
  field.className = 'panel-slider';
  const heading = document.createElement('span');
  heading.textContent = label;
  const output = document.createElement('output');
  heading.appendChild(output);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = min;
  input.max = max;
  input.step = step;
  const update = (next) => {
    input.value = next;
    output.textContent = format(next);
    apply(next);
  };
  input.oninput = () => update(parseFloat(input.value));
  field.append(heading, input);
  panel.appendChild(field);
  update(value);
  return () => update(value);
}

function addSelect(panel, label, entries) {
  const field = document.createElement('label');
  field.className = 'panel-select';
  field.append(label);
  const select = document.createElement('select');
  for (const [name] of entries) select.add(new Option(name, name));
  field.appendChild(select);
  panel.appendChild(field);
  return {
    select,
    value: () => entries.find(([name]) => name === select.value)[1],
    reset: () => {
      select.selectedIndex = 0;
      renderer.setClearColor(entries[0][1]);
    },
  };
}

addEventListener('message', async (e) => {
  if (e.origin !== 'https://github.com' || !e.data || e.data.type !== 'ov-splat') return;
  try {
    splatMesh = new SplatMesh({
      fileBytes: new Uint8Array(e.data.bytes),
      fileName: e.data.fileName,
    });
    await splatMesh.initialized;
    scene.add(splatMesh);
    frame();
    buildPanel();
    post({ type: 'ov-splat-ok' });
  } catch (err) {
    post({ type: 'ov-splat-error', error: 'SplatMesh: ' + ((err && err.message) || err) });
  }
});

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// Module loaded and ran: signal readiness so the content script sends the bytes.
post({ type: 'ov-splat-ready' });
