// Spark splat renderer for the extension viewer page. External module (script-src
// 'self') so no inline-module CSP question. Spark's worker + WASM run here because
// the extension page's CSP allows them. Any failure is posted to the parent so the
// content script can log it and fall back to the main-thread renderer.
import { THREE, OrbitControls, SparkRenderer, SplatMesh } from './vendor/spark.esm.js';

const post = (msg) => parent.postMessage(msg, '*');

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

function frame(mesh) {
  const box = new THREE.Box3().setFromObject(mesh);
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

addEventListener('message', async (e) => {
  if (e.origin !== 'https://github.com' || !e.data || e.data.type !== 'ov-splat') return;
  try {
    const mesh = new SplatMesh({
      fileBytes: new Uint8Array(e.data.bytes),
      fileName: e.data.fileName,
    });
    await mesh.initialized;
    // Splats are typically stored Y-down; flip 180° about X into three's Y-up.
    mesh.quaternion.set(1, 0, 0, 0);
    scene.add(mesh);
    frame(mesh);
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
