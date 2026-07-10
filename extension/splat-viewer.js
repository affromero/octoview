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
scene.add(new SparkRenderer({ renderer }));

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

// A Coords dropdown to reinterpret the source axes, same idea as the 3D renderer.
function buildPanel() {
  const panel = document.createElement('div');
  panel.className = 'panel';
  const label = document.createElement('label');
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
  document.body.appendChild(panel);
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
