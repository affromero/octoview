// octoview Gaussian-splat renderer, lazy-imported inline for .splat and 3DGS .ply.
// Spark and other splat viewers load in a Worker and fetch a blob URL, which
// WebKit refuses, so this is a self-contained WebKit-safe renderer: it PARSES the
// splat centers/colors/opacity/scale on the main thread and draws them as
// depth-sorted gaussian point sprites via three.js. Isotropic (no covariance
// ellipse), which is enough for a preview. Sorting reorders only the index buffer
// (cheap) so alpha blending is back-to-front correct.
import { THREE, OrbitControls, ViewHelper } from './vendor/three3d.esm.js';

const C0 = 0.28209479177387814; // SH band-0 factor, f_dc -> base color
const MAX_SPLATS = 800000; // ponytail: subsample beyond this to keep sort snappy

export function renderSplat(buf, mount, ext) {
  ensureStyle();
  mount.style.position = 'relative';
  try {
    const splat = ext === '.splat' ? parseSplatBin(buf) : parsePlySplat(buf);
    if (!splat.count) throw new Error('no splats found');
    view(splat, mount);
  } catch (e) {
    fail(mount, e);
  }
}

// Detect a 3DGS PLY (as opposed to a mesh/point-cloud PLY) from its header text.
export function isPlySplat(buf) {
  const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(2048, buf.byteLength)));
  return /f_dc_0/.test(head) && /scale_0/.test(head) && /rot_0/.test(head);
}

// antimatter15 .splat: 32 bytes/splat — pos(3 f32), scale(3 f32), rgba(4 u8), quat(4 u8).
function parseSplatBin(buf) {
  const count = Math.floor(buf.byteLength / 32);
  const dv = new DataView(buf);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 4);
  const size = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * 32;
    pos[i * 3] = dv.getFloat32(o, true);
    pos[i * 3 + 1] = dv.getFloat32(o + 4, true);
    pos[i * 3 + 2] = dv.getFloat32(o + 8, true);
    size[i] =
      (dv.getFloat32(o + 12, true) + dv.getFloat32(o + 16, true) + dv.getFloat32(o + 20, true)) / 3;
    col[i * 4] = dv.getUint8(o + 24) / 255;
    col[i * 4 + 1] = dv.getUint8(o + 25) / 255;
    col[i * 4 + 2] = dv.getUint8(o + 26) / 255;
    col[i * 4 + 3] = dv.getUint8(o + 27) / 255;
  }
  return subsample({ count, pos, col, size });
}

// 3DGS PLY (binary_little_endian): x y z … f_dc_0..2 … opacity scale_0..2 rot_0..3.
function parsePlySplat(buf) {
  const bytes = new Uint8Array(buf);
  const headTxt = new TextDecoder().decode(bytes.subarray(0, 4096));
  const end = headTxt.indexOf('end_header');
  const dataStart = headTxt.indexOf('\n', end) + 1;
  const count = +/element vertex (\d+)/.exec(headTxt)[1];
  const little = /binary_little_endian/.test(headTxt);
  if (!/binary/.test(headTxt)) throw new Error('ASCII PLY splats not supported');

  const props = [];
  for (const line of headTxt.slice(0, end).split('\n')) {
    const m = /^property\s+(\S+)\s+(\S+)/.exec(line.trim());
    if (m) props.push({ type: m[1], name: m[2] });
  }
  const TSIZE = {
    float: 4,
    float32: 4,
    double: 8,
    uchar: 1,
    uint8: 1,
    int: 4,
    uint: 4,
    short: 2,
    ushort: 2,
  };
  const stride = props.reduce((a, p) => a + (TSIZE[p.type] || 4), 0);
  const idx = {};
  let off = 0;
  for (const p of props) {
    idx[p.name] = { off, type: p.type };
    off += TSIZE[p.type] || 4;
  }
  const dv = new DataView(buf, dataStart);
  const get = (row, name) => {
    const f = idx[name];
    if (!f) return 0;
    const o = row * stride + f.off;
    return f.type === 'double' ? dv.getFloat64(o, little) : dv.getFloat32(o, little);
  };
  const sigmoid = (x) => 1 / (1 + Math.exp(-x));

  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 4);
  const size = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = get(i, 'x');
    pos[i * 3 + 1] = get(i, 'y');
    pos[i * 3 + 2] = get(i, 'z');
    col[i * 4] = clamp01(0.5 + C0 * get(i, 'f_dc_0'));
    col[i * 4 + 1] = clamp01(0.5 + C0 * get(i, 'f_dc_1'));
    col[i * 4 + 2] = clamp01(0.5 + C0 * get(i, 'f_dc_2'));
    col[i * 4 + 3] = sigmoid(get(i, 'opacity'));
    size[i] = Math.exp((get(i, 'scale_0') + get(i, 'scale_1') + get(i, 'scale_2')) / 3);
  }
  return subsample({ count, pos, col, size });
}

function subsample(s) {
  if (s.count <= MAX_SPLATS) return s;
  const stride = Math.ceil(s.count / MAX_SPLATS);
  const n = Math.floor(s.count / stride);
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 4);
  const size = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = i * stride;
    pos.set(s.pos.subarray(j * 3, j * 3 + 3), i * 3);
    col.set(s.col.subarray(j * 4, j * 4 + 4), i * 4);
    size[i] = s.size[j];
  }
  return { count: n, pos, col, size };
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

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
  const points = new THREE.Points(geo, material);
  scene.add(points);

  // Frame the cloud.
  const box = new THREE.Box3().setFromBufferAttribute(geo.getAttribute('position'));
  const center = box.getCenter(new THREE.Vector3());
  const sizeV = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(sizeV.x, sizeV.y, sizeV.z) || 1;
  camera.position.copy(center).add(new THREE.Vector3(0, 0, maxDim * 1.8));
  controls.target.copy(center);
  controls.update();

  // Back-to-front index sort for correct alpha, throttled and only when moved.
  const idxAttr = geo.getIndex();
  const dir = new THREE.Vector3();
  const depth = new Float32Array(splat.count);
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
  };
  sort();

  const gizmo = new ViewHelper(camera, renderer.domElement);
  let gizmoOn = true;
  buildPanel(mount, uniforms, splat.count, (on) => (gizmoOn = on));
  renderer.domElement.addEventListener('pointerup', (e) => gizmoOn && gizmo.handleClick(e));

  renderer.autoClear = false;
  const clock = new THREE.Clock();
  (function loop(t) {
    requestAnimationFrame(loop);
    const dt = clock.getDelta();
    controls.update();
    if (t - lastSort > 80) {
      sort();
      lastSort = t;
    }
    if (gizmo.animating) gizmo.update(dt);
    renderer.clear();
    renderer.render(scene, camera);
    if (gizmoOn) gizmo.render(renderer);
  })(0);

  window.addEventListener('resize', () => {
    const W = mount.clientWidth || w;
    const H = mount.clientHeight || h;
    renderer.setSize(W, H);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
  });
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
