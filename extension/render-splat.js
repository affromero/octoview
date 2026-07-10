// octoview Gaussian-splat renderer, lazy-imported inline for .splat, 3DGS .ply and
// .splattie. Spark and other splat viewers load in a Worker and fetch a blob URL,
// which WebKit refuses, so this parses the splat on the MAIN thread (see
// splat-decode.js) and draws depth-sorted gaussian point sprites via three.js.
// Isotropic (no covariance ellipse), which is enough for a preview. Sorting
// reorders only the index buffer (cheap) so alpha blending is back-to-front correct.
import { THREE, OrbitControls, ViewHelper } from './vendor/three3d.esm.js';
import {
  parseSplatBin,
  parsePlySplat,
  parseSplattie,
  parseSpz,
  parseKsplat,
  parseSog,
  isPlySplat,
} from './splat-decode.js';

export { isPlySplat };

// Decode a webp data texture to raw RGBA without alpha premultiplication — a 2D
// canvas premultiplies and corrupts the color channels of low-alpha pixels
// (sog's sh0 alpha IS the opacity), so read back through a WebGL2 texture.
async function decodeImage(bytes) {
  const bmp = await createImageBitmap(new Blob([bytes]), { premultiplyAlpha: 'none' });
  const { width, height } = bmp;
  // A small .webp can decode to a gigapixel bitmap; cap the readback so a
  // crafted .sog texture can't allocate a multi-GB canvas and OOM the tab.
  if (width * height > 64 * 1024 * 1024) {
    bmp.close();
    throw new Error('.sog texture is too large (' + width + '×' + height + ')');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('WebGL2 unavailable for texture decode');
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const data = new Uint8ClampedArray(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(data.buffer));
  bmp.close();
  return { data, width, height };
}

export async function renderSplat(buf, mount, ext) {
  ensureStyle();
  mount.style.position = 'relative';
  try {
    const splat =
      ext === '.splat'
        ? parseSplatBin(buf)
        : ext === '.splattie'
          ? await parseSplattie(buf)
          : ext === '.spz'
            ? parseSpz(buf)
            : ext === '.ksplat'
              ? parseKsplat(buf)
              : ext === '.sog'
                ? await parseSog(buf, decodeImage)
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

  // uSizeFactor maps a world-space gaussian radius to screen pixels
  // (2 * viewportHeightPx * projection[1][1], covering ~2 std devs so the round
  // sprites overlap into a surface instead of reading as separate points). It is
  // refreshed each frame below because it depends on the viewport and projection.
  const uniforms = {
    uScale: { value: 1 },
    uOpacity: { value: 1 },
    uFalloff: { value: 1 },
    uSizeFactor: { value: 1200 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    vertexShader: `
      attribute vec4 color; attribute float size;
      uniform float uScale; uniform float uSizeFactor;
      varying vec4 vColor;
      void main(){
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position,1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(size * uScale * uSizeFactor / -mv.z, 1.5, 512.0);
      }`,
    fragmentShader: `
      varying vec4 vColor; uniform float uOpacity; uniform float uFalloff;
      void main(){
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = exp(-4.0 * d * d * uFalloff);
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
  buildPanel(mount, uniforms, splat.count, renderer, (on) => (gizmoOn = on));
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
    uniforms.uSizeFactor.value =
      2 * renderer.domElement.height * camera.projectionMatrix.elements[5];
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

function buildPanel(mount, uniforms, count, renderer, onGizmo) {
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
  panel.appendChild(slider('Falloff', 0, 1, 0.05, 1, (v) => (uniforms.uFalloff.value = v)));
  const background = document.createElement('label');
  background.className = 'ov3d-slider';
  background.append('Background');
  const select = document.createElement('select');
  for (const [label] of [
    ['Midnight', 0x0d1117],
    ['Slate', 0x21262d],
    ['White', 0xf6f8fa],
  ])
    select.add(new Option(label, label));
  select.onchange = () => {
    const [, color] = [
      ['Midnight', 0x0d1117],
      ['Slate', 0x21262d],
      ['White', 0xf6f8fa],
    ].find(([label]) => label === select.value);
    renderer.setClearColor(color);
  };
  background.appendChild(select);
  panel.appendChild(background);
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
    .ov3d-slider input{width:132px;accent-color:#2ea043}
    .ov3d-slider select{width:132px;background:#21262d;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:3px 6px;font:inherit}`;
  document.head.appendChild(s);
}
