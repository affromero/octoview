// octoview Gaussian-splat renderer. Draws TRUE anisotropic gaussians (oriented
// covariance ellipses, EWA splatting) in pure WebGL2 on the MAIN thread — no
// worker, no WASM, no eval, no blob — so it runs under the strict extension CSP
// in every browser (Safari, Chrome, Firefox) with zero relaxation. splat-decode.js
// parses the file into per-splat center + color + scale + rotation; this projects
// each 3D covariance to a 2D screen-space conic, sorts back-to-front every frame
// (counting sort), and composites. See the README "Why not Spark" note.
import { THREE, OrbitControls, ViewHelper } from './vendor/three3d.esm.js';
import {
  parseSplatBin,
  parsePlySplat,
  parseSpz,
  parseKsplat,
  parseSog,
  parseLcc,
  isPlySplat,
} from './splat-decode.js';

export { isPlySplat };

const X = new THREE.Vector3(1, 0, 0);
const CONVENTIONS = {
  'OpenGL (Y-up)': new THREE.Quaternion(),
  'Z-up (Blender, ROS, CAD)': new THREE.Quaternion().setFromAxisAngle(X, -Math.PI / 2),
  'OpenCV (Y-down, Z-fwd)': new THREE.Quaternion().setFromAxisAngle(X, Math.PI),
};

const SPLATS_PER_ROW = 1024; // data-texture packing (4 texels/splat per row)

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

export function renderLcc(metaBytes, indexBytes, dataBytes, mount) {
  ensureStyle();
  mount.style.position = 'relative';
  try {
    const splat = parseLcc(metaBytes, indexBytes, dataBytes);
    if (!splat.count) throw new Error('no splats found');
    view(splat, mount);
  } catch (e) {
    fail(mount, e);
  }
}

// Build the per-splat data texture: 4 RGBA32F texels/splat holding center, the
// 3D covariance (Sigma = R S^2 R^T from the decoded quat + 3 scales), and color.
// Computing covariance once here (not per frame) keeps the vertex shader cheap.
function buildDataTexture(splat) {
  const { count, pos, col, scale, quat } = splat;
  const rows = Math.ceil(count / SPLATS_PER_ROW);
  const W = SPLATS_PER_ROW * 4;
  const data = new Float32Array(W * rows * 4);
  for (let i = 0; i < count; i++) {
    const sx = scale[i * 3],
      sy = scale[i * 3 + 1],
      sz = scale[i * 3 + 2];
    let qx = quat[i * 4],
      qy = quat[i * 4 + 1],
      qz = quat[i * 4 + 2],
      qw = quat[i * 4 + 3];
    const ql = Math.hypot(qx, qy, qz, qw) || 1;
    qx /= ql;
    qy /= ql;
    qz /= ql;
    qw /= ql;
    // R (columns) from the quaternion, then M = R * diag(scale), Sigma = M M^T.
    const r00 = 1 - 2 * (qy * qy + qz * qz),
      r01 = 2 * (qx * qy - qw * qz),
      r02 = 2 * (qx * qz + qw * qy);
    const r10 = 2 * (qx * qy + qw * qz),
      r11 = 1 - 2 * (qx * qx + qz * qz),
      r12 = 2 * (qy * qz - qw * qx);
    const r20 = 2 * (qx * qz - qw * qy),
      r21 = 2 * (qy * qz + qw * qx),
      r22 = 1 - 2 * (qx * qx + qy * qy);
    const m00 = r00 * sx,
      m01 = r01 * sy,
      m02 = r02 * sz;
    const m10 = r10 * sx,
      m11 = r11 * sy,
      m12 = r12 * sz;
    const m20 = r20 * sx,
      m21 = r21 * sy,
      m22 = r22 * sz;
    const b = ((i >> 10) * W + (i & 1023) * 4) * 4;
    data[b] = pos[i * 3];
    data[b + 1] = pos[i * 3 + 1];
    data[b + 2] = pos[i * 3 + 2];
    data[b + 3] = m00 * m00 + m01 * m01 + m02 * m02; // cov00
    data[b + 4] = m00 * m10 + m01 * m11 + m02 * m12; // cov01
    data[b + 5] = m00 * m20 + m01 * m21 + m02 * m22; // cov02
    data[b + 6] = m10 * m10 + m11 * m11 + m12 * m12; // cov11
    data[b + 7] = m10 * m20 + m11 * m21 + m12 * m22; // cov12
    data[b + 8] = m20 * m20 + m21 * m21 + m22 * m22; // cov22
    data[b + 9] = col[i * 4];
    data[b + 10] = col[i * 4 + 1];
    data[b + 11] = col[i * 4 + 2];
    data[b + 12] = col[i * 4 + 3];
  }
  const tex = new THREE.DataTexture(data, W, rows, THREE.RGBAFormat, THREE.FloatType);
  tex.needsUpdate = true;
  return tex;
}

const VERTEX = `
in vec3 position;     // base quad corner in [-2,2] (z unused; named 'position' so
                      // three.js's instanced draw path recognizes the geometry)
in float splatIndex;  // splat drawn by this instance (sorted order)
#define quad position.xy
uniform highp sampler2D uData;
uniform mat4 modelViewMatrix, projectionMatrix;
uniform vec2 uViewport;
uniform float uScale, uFalloff, uVariance;
out vec4 vColor;
out vec2 vPos;
void main(){
  int id = int(splatIndex);
  int bx = (id & 1023) * 4, by = id >> 10;
  vec4 t0 = texelFetch(uData, ivec2(bx,   by), 0); // center.xyz, cov00
  vec4 t1 = texelFetch(uData, ivec2(bx+1, by), 0); // cov01,02,11,12
  vec4 t2 = texelFetch(uData, ivec2(bx+2, by), 0); // cov22, color.rgb
  vec4 t3 = texelFetch(uData, ivec2(bx+3, by), 0); // color.a
  vec4 cam = modelViewMatrix * vec4(t0.xyz, 1.0);
  vec4 clip = projectionMatrix * cam;
  if (clip.w <= 0.0 || abs(clip.x) > 1.3*clip.w || abs(clip.y) > 1.3*clip.w){
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return;
  }
  // Size slider scales the gaussian footprint (covariance ~ scale^2).
  mat3 Vrk = mat3(t0.w, t1.x, t1.y,  t1.x, t1.z, t1.w,  t1.y, t1.w, t2.x) * (uScale * uScale);
  vec2 focal = vec2(projectionMatrix[0][0], projectionMatrix[1][1]) * 0.5 * uViewport;
  mat3 J = mat3(
    focal.x/cam.z, 0.0, -(focal.x*cam.x)/(cam.z*cam.z),
    0.0, focal.y/cam.z, -(focal.y*cam.y)/(cam.z*cam.z),
    0.0, 0.0, 0.0);
  mat3 W = mat3(modelViewMatrix);
  mat3 T = W * J;
  // uVariance shrinks each gaussian's spread toward its mean: at 1 the full
  // oriented ellipse, at 0 it collapses (only the constant low-pass survives) to
  // a ~1px dot — the splat centers as a point cloud (see the fragment shader,
  // which drives those collapsed means to full intensity).
  mat3 cov2d = transpose(T) * Vrk * T * uVariance;
  // Low-pass floor (min screen footprint) also shrinks with variance, so the
  // collapsed means read as crisp distinct points, not a slightly grainier
  // surface. Floored at 0.12 so a mean never fully vanishes into a sub-pixel gap.
  float lp = mix(0.12, 0.3, uVariance);
  cov2d[0][0] += lp; cov2d[1][1] += lp;
  float mid = 0.5*(cov2d[0][0]+cov2d[1][1]);
  float rad = length(vec2((cov2d[0][0]-cov2d[1][1])*0.5, cov2d[0][1]));
  float l1 = mid+rad, l2 = max(mid-rad, 0.1);
  // Guard the eigenvector against a near-circular conic: normalize(0,0) is NaN,
  // which would collapse the whole quad and drop the splat. Fall back to the x
  // axis (orientation is irrelevant when the gaussian is circular).
  vec2 ev = vec2(cov2d[0][1], l1 - cov2d[0][0]);
  vec2 dir = length(ev) > 1e-9 ? normalize(ev) : vec2(1.0, 0.0);
  vec2 major = min(sqrt(2.0*l1), 1024.0) * dir;
  vec2 minor = min(sqrt(2.0*l2), 1024.0) * vec2(dir.y, -dir.x);
  vColor = vec4(t2.yzw, t3.x);
  vPos = quad / uFalloff;
  vec2 off = (quad.x*major + quad.y*minor) / uViewport * 2.0;
  gl_Position = vec4(clip.xy/clip.w + off, clip.z/clip.w, 1.0);
}`;

const FRAGMENT = `
precision highp float;
in vec4 vColor; in vec2 vPos;
uniform float uOpacity, uVariance;
out vec4 outColor;
void main(){
  float A = -dot(vPos, vPos);
  if (A < -4.0) discard;
  // As variance collapses to means (uVariance -> 0), drive alpha to full so the
  // means read as full-intensity points, not the splat's own (often low) opacity.
  float a = exp(A) * mix(1.0, vColor.a, uVariance) * uOpacity;
  if (a < 0.004) discard;
  outColor = vec4(vColor.rgb, a);
}`;

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

  const dataTex = buildDataTexture(splat);
  const uniforms = {
    uData: { value: dataTex },
    uViewport: { value: new THREE.Vector2(w, h) },
    uScale: { value: 1 },
    uOpacity: { value: 1 },
    uFalloff: { value: 1 },
    uVariance: { value: 1 },
  };
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    // The projected covariance flips the quad's winding for roughly half the
    // splats, so cull nothing — a FrontSide material would drop them.
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });

  // One instanced quad per splat; a per-instance splatIndex picks its data texel
  // and is rewritten each frame to draw back-to-front.
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([-2, -2, 0, 2, -2, 0, 2, 2, 0, -2, 2, 0]), 3)
  );
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const order = new Float32Array(splat.count);
  for (let i = 0; i < splat.count; i++) order[i] = i;
  const orderAttr = new THREE.InstancedBufferAttribute(order, 1);
  orderAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('splatIndex', orderAttr);
  geo.instanceCount = splat.count;
  const splatMesh = new THREE.Mesh(geo, material);
  splatMesh.frustumCulled = false;
  scene.add(splatMesh);

  // Frame the cloud from its point bounds.
  const box = new THREE.Box3();
  const pt = new THREE.Vector3();
  for (let i = 0; i < splat.count; i++)
    box.expandByPoint(pt.set(splat.pos[i * 3], splat.pos[i * 3 + 1], splat.pos[i * 3 + 2]));
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(...box.getSize(new THREE.Vector3()).toArray()) || 1;
  const frame = () => {
    camera.position.copy(center).add(new THREE.Vector3(0, 0, maxDim * 1.8));
    camera.near = maxDim / 100;
    camera.far = maxDim * 100;
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
  };
  frame();

  // Back-to-front counting sort (16-bit, O(n)) into the splatIndex attribute,
  // re-run every frame the camera moves (idle stays static so it does not peg
  // the CPU). Correct order is what makes alpha blending read as a solid surface.
  const dir = new THREE.Vector3();
  const localCamera = new THREE.Vector3();
  const inverseRotation = new THREE.Quaternion();
  const depth = new Float32Array(splat.count);
  const BUCKETS = 65536;
  const counts = new Uint32Array(BUCKETS);
  const starts = new Uint32Array(BUCKETS);
  const keys = new Uint32Array(splat.count);
  const lastPos = new THREE.Vector3(Infinity, 0, 0);
  const lastQuat = new THREE.Quaternion(2, 0, 0, 0);
  const sort = () => {
    splatMesh.updateMatrixWorld();
    camera.getWorldDirection(dir);
    splatMesh.getWorldQuaternion(inverseRotation).invert();
    dir.applyQuaternion(inverseRotation);
    localCamera.copy(camera.position);
    splatMesh.worldToLocal(localCamera);
    const cx = localCamera.x,
      cy = localCamera.y,
      cz = localCamera.z;
    const n = splat.count;
    const pos = splat.pos;
    let dmin = Infinity,
      dmax = -Infinity;
    for (let i = 0; i < n; i++) {
      const d =
        (pos[i * 3] - cx) * dir.x + (pos[i * 3 + 1] - cy) * dir.y + (pos[i * 3 + 2] - cz) * dir.z;
      depth[i] = d;
      if (d < dmin) dmin = d;
      if (d > dmax) dmax = d;
    }
    const scale = (BUCKETS - 1) / (dmax - dmin || 1);
    counts.fill(0);
    for (let i = 0; i < n; i++) {
      const k = ((depth[i] - dmin) * scale) | 0;
      keys[i] = k;
      counts[k]++;
    }
    // Farthest (largest depth) first → alpha blends back-to-front.
    let acc = 0;
    for (let k = BUCKETS - 1; k >= 0; k--) {
      starts[k] = acc;
      acc += counts[k];
    }
    for (let i = 0; i < n; i++) order[starts[keys[i]]++] = i;
    orderAttr.needsUpdate = true;
    lastPos.copy(camera.position);
    lastQuat.copy(camera.quaternion);
  };
  sort();

  const gizmo = new ViewHelper(camera, renderer.domElement);
  gizmo.setLabels('X', 'Y', 'Z');
  let gizmoOn = true;
  buildPanel(
    mount,
    uniforms,
    splat.count,
    renderer,
    (on) => (gizmoOn = on),
    (convention) => {
      splatMesh.quaternion.copy(CONVENTIONS[convention]);
      frame();
      sort();
    }
  );
  const onClick = (e) => gizmoOn && gizmo.handleClick(e);
  renderer.domElement.addEventListener('pointerup', onClick);

  const onResize = () => {
    const W = mount.clientWidth || w;
    const H = mount.clientHeight || h;
    renderer.setSize(W, H);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    uniforms.uViewport.value.set(W * renderer.getPixelRatio(), H * renderer.getPixelRatio());
  };
  window.addEventListener('resize', onResize);
  uniforms.uViewport.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());

  // Manual clear: the ViewHelper gizmo renders its own scene after ours, and with
  // autoClear on that inner render would wipe the whole color buffer (clearing the
  // splats). Clear once per frame ourselves, then draw scene + gizmo over it.
  renderer.autoClear = false;
  const clock = new THREE.Clock();
  (function loop() {
    // When Preview is toggled off the pane (and canvas) leaves the DOM; tear the
    // loop and GPU resources down so repeated opens do not exhaust WebGL contexts.
    if (!renderer.domElement.isConnected) {
      window.removeEventListener('resize', onResize);
      geo.dispose();
      material.dispose();
      dataTex.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      return;
    }
    requestAnimationFrame(loop);
    const dt = clock.getDelta();
    controls.update();
    if (!camera.position.equals(lastPos) || !camera.quaternion.equals(lastQuat)) sort();
    renderer.clear();
    renderer.render(scene, camera);
    if (gizmo.animating) gizmo.update(dt);
    if (gizmoOn) gizmo.render(renderer);
  })();
}

function buildPanel(mount, uniforms, count, renderer, onGizmo, onConvention) {
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
  const coords = document.createElement('label');
  coords.className = 'ov3d-slider';
  coords.append('Coords');
  const coordSelect = document.createElement('select');
  for (const name of Object.keys(CONVENTIONS)) coordSelect.add(new Option(name, name));
  coordSelect.onchange = () => onConvention(coordSelect.value);
  coords.appendChild(coordSelect);
  panel.appendChild(coords);
  panel.appendChild(slider('Size', 0.1, 4, 0.05, 1, (v) => (uniforms.uScale.value = v)));
  // Variance: 1 = full oriented gaussians; drag toward 0 to shrink each splat to
  // its full-intensity mean, revealing the underlying point cloud.
  panel.appendChild(slider('Variance', 0, 1, 0.01, 1, (v) => (uniforms.uVariance.value = v)));
  panel.appendChild(slider('Opacity', 0.05, 1, 0.01, 1, (v) => (uniforms.uOpacity.value = v)));
  // Falloff sharpens/softens the gaussian edge (divides the sample radius): 1 is
  // the true gaussian, lower makes crisper cores, higher a softer cloud.
  panel.appendChild(slider('Falloff', 0.5, 2, 0.05, 1, (v) => (uniforms.uFalloff.value = v)));
  const background = document.createElement('label');
  background.className = 'ov3d-slider';
  background.append('Background');
  const select = document.createElement('select');
  const BG = [
    ['Midnight', 0x0d1117],
    ['Slate', 0x21262d],
    ['White', 0xf6f8fa],
  ];
  for (const [label] of BG) select.add(new Option(label, label));
  select.onchange = () => renderer.setClearColor(BG.find(([label]) => label === select.value)[1]);
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
