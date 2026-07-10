// octoview Gaussian-splat renderer, lazy-imported inline for .splat, 3DGS .ply and
// .splattie. Spark and other splat viewers load in a Worker and fetch a blob URL,
// which WebKit refuses, so this parses the splat on the MAIN thread (see
// splat-decode.js) and draws depth-sorted gaussian point sprites via three.js.
// Isotropic (no covariance ellipse), which is enough for a preview. Sorting
// reorders only the index buffer (cheap) so alpha blending is back-to-front correct.
import { THREE, OrbitControls, ViewHelper } from './vendor/three3d.esm.js';
import { parseSplatBin, parsePlySplat, parseSplattie, isPlySplat } from './splat-decode.js';

export { isPlySplat };

export async function renderSplat(buf, mount, ext) {
  ensureStyle();
  mount.style.position = 'relative';
  try {
    const splat =
      ext === '.splat'
        ? parseSplatBin(buf)
        : ext === '.splattie'
          ? await parseSplattie(buf)
          : parsePlySplat(buf);
    if (!splat.count) throw new Error('no splats found');
    view(splat, mount);
  } catch (e) {
    fail(mount, e);
  }
}

function view(splat, mount) {
  const w = mount.clientWidth || 800;
  const h = mount.clientHeight || 600;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h);
  renderer.setClearColor(0x0d1117);
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, w / h, 0.01, 5000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(splat.pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(splat.col, 4));
  geo.setAttribute('size', new THREE.BufferAttribute(splat.size, 1));
  const order = new Uint32Array(splat.count);
  for (let i = 0; i < splat.count; i++) order[i] = i;
  geo.setIndex(new THREE.Uint32BufferAttribute(order, 1));

  const uniforms = { uScale: { value: 1 }, uOpacity: { value: 1 } };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    vertexShader: `
      attribute vec4 color; attribute float size; uniform float uScale;
      varying vec4 vColor;
      void main(){
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position,1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(size * 900.0 * uScale / -mv.z, 1.0, 96.0);
      }`,
    fragmentShader: `
      varying vec4 vColor; uniform float uOpacity;
      void main(){
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = exp(-4.0 * d * d);
        if (a < 0.02) discard;
        gl_FragColor = vec4(vColor.rgb, vColor.a * a * uOpacity);
      }`,
  });
  scene.add(new THREE.Points(geo, material));

  // Frame the cloud.
  const box = new THREE.Box3().setFromBufferAttribute(geo.getAttribute('position'));
  const center = box.getCenter(new THREE.Vector3());
  const sizeV = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(sizeV.x, sizeV.y, sizeV.z) || 1;
  camera.position.copy(center).add(new THREE.Vector3(0, 0, maxDim * 1.8));
  controls.target.copy(center);
  controls.update();

  // Back-to-front index sort for correct alpha. Throttled AND skipped when the
  // camera has not moved, so a static preview does not peg the main thread.
  const idxAttr = geo.getIndex();
  const dir = new THREE.Vector3();
  const depth = new Float32Array(splat.count);
  const lastPos = new THREE.Vector3(Infinity, 0, 0);
  const lastQuat = new THREE.Quaternion(2, 0, 0, 0);
  let lastSort = 0;
  const sort = () => {
    camera.getWorldDirection(dir);
    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;
    for (let i = 0; i < splat.count; i++) {
      depth[i] =
        (splat.pos[i * 3] - cx) * dir.x +
        (splat.pos[i * 3 + 1] - cy) * dir.y +
        (splat.pos[i * 3 + 2] - cz) * dir.z;
    }
    order.sort((a, b) => depth[b] - depth[a]);
    idxAttr.needsUpdate = true;
    lastPos.copy(camera.position);
    lastQuat.copy(camera.quaternion);
  };
  sort();

  const gizmo = new ViewHelper(camera, renderer.domElement);
  let gizmoOn = true;
  buildPanel(mount, uniforms, splat.count, (on) => (gizmoOn = on));
  const onClick = (e) => gizmoOn && gizmo.handleClick(e);
  renderer.domElement.addEventListener('pointerup', onClick);

  const onResize = () => {
    const W = mount.clientWidth || w;
    const H = mount.clientHeight || h;
    renderer.setSize(W, H);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize);

  renderer.autoClear = false;
  const clock = new THREE.Clock();
  (function loop(t) {
    // When Preview is toggled off the pane (and canvas) leaves the DOM; tear the
    // loop and GPU resources down so repeated opens do not exhaust WebGL contexts.
    if (!renderer.domElement.isConnected) {
      window.removeEventListener('resize', onResize);
      geo.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      return;
    }
    requestAnimationFrame(loop);
    const dt = clock.getDelta();
    controls.update();
    if (
      t - lastSort > 80 &&
      (!camera.position.equals(lastPos) || !camera.quaternion.equals(lastQuat))
    ) {
      sort();
      lastSort = t;
    }
    if (gizmo.animating) gizmo.update(dt);
    renderer.clear();
    renderer.render(scene, camera);
    if (gizmoOn) gizmo.render(renderer);
  })(0);
}

function buildPanel(mount, uniforms, count, onGizmo) {
  const panel = document.createElement('div');
  panel.className = 'ov3d-panel';
  const info = document.createElement('div');
  info.className = 'ovsp-count';
  info.textContent = count.toLocaleString() + ' splats';
  panel.appendChild(info);

  const gizmo = document.createElement('button');
  gizmo.className = 'ov3d-btn on';
  gizmo.textContent = 'Axes';
  gizmo.onclick = () => {
    const on = !gizmo.classList.contains('on');
    gizmo.classList.toggle('on', on);
    onGizmo(on);
  };
  panel.appendChild(gizmo);
  panel.appendChild(slider('Size', 0.1, 4, 0.05, 1, (v) => (uniforms.uScale.value = v)));
  panel.appendChild(slider('Opacity', 0.1, 1, 0.02, 1, (v) => (uniforms.uOpacity.value = v)));
  mount.appendChild(panel);
}

function slider(label, min, max, step, value, onInput) {
  const wrap = document.createElement('label');
  wrap.className = 'ov3d-slider';
  wrap.append(label);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = min;
  input.max = max;
  input.step = step;
  input.value = value;
  input.oninput = () => onInput(parseFloat(input.value));
  wrap.appendChild(input);
  return wrap;
}

function fail(mount, e) {
  const p = document.createElement('p');
  p.className = 'ov-msg';
  p.textContent = 'Splat load failed: ' + ((e && e.message) || e);
  mount.appendChild(p);
}

function ensureStyle() {
  if (document.getElementById('ov3d-style')) return;
  const s = document.createElement('style');
  s.id = 'ov3d-style';
  s.textContent = `
    .ov3d-panel{position:absolute;top:12px;right:12px;z-index:5;display:flex;flex-direction:column;gap:8px;
      padding:10px 12px;background:rgba(13,17,23,.82);border:1px solid #30363d;border-radius:8px;
      font:12px -apple-system,BlinkMacSystemFont,sans-serif;color:#e6edf3}
    .ovsp-count{color:#7d8590;font:11px ui-monospace,monospace}
    .ov3d-btn{background:#21262d;border:1px solid #30363d;color:#c9d1d9;border-radius:6px;padding:4px 10px;cursor:pointer;font:inherit}
    .ov3d-btn.on{background:#238636;border-color:#2ea043;color:#fff}
    .ov3d-slider{display:flex;flex-direction:column;gap:3px}
    .ov3d-slider input{width:132px;accent-color:#2ea043}`;
  document.head.appendChild(s);
}
