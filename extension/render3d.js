// octoview 3D renderer, lazy-imported inline by the content script only for 3D
// files. three.js loaders PARSE the ArrayBuffer on the main thread (no workers,
// no blob URLs), so they are WebKit safe, and they run in the content script's
// isolated world, which is not bound by github.com's CSP. Adds a MeshLab-style
// orientation gizmo (toggleable) plus size and color sliders for point clouds.
import {
  THREE,
  GLTFLoader,
  OBJLoader,
  PLYLoader,
  PCDLoader,
  OrbitControls,
  ViewHelper,
} from './vendor/three3d.esm.js';

export function render3D(buf, mount, ext) {
  ensureStyle();
  mount.style.position = 'relative';

  const fail = (e) => {
    mount.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'ov-msg';
    p.textContent = '3D load failed: ' + ((e && e.message) || e);
    mount.appendChild(p);
  };

  const w = mount.clientWidth || 800;
  const h = mount.clientHeight || 600;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h);
  renderer.setClearColor(0x0d1117);
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, w / h, 0.001, 5000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
  keyLight.position.set(1, 1, 1);
  scene.add(keyLight);

  let pointsMat = null;
  let maxDim = 1;
  let boxMinY = 0;

  const frame = (obj) => {
    scene.add(obj);
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    boxMinY = box.min.y;
    maxDim = Math.max(size.x, size.y, size.z) || 1;
    camera.near = maxDim / 1000;
    camera.far = maxDim * 1000;
    camera.position.copy(center).add(new THREE.Vector3(0, size.y * 0.15, maxDim * 2.2));
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
  };

  let gizmoOn = true;

  const afterLoad = () => {
    const grid = new THREE.GridHelper(maxDim * 4, 16, 0x30363d, 0x1c2128);
    grid.position.y = boxMinY;
    scene.add(grid);

    if (pointsMat) {
      pointsMat.size = maxDim * 0.02;
      pointsMat.sizeAttenuation = true;
    }

    const viewHelper = new ViewHelper(camera, renderer.domElement);
    renderer.domElement.addEventListener('pointerup', (e) => {
      if (gizmoOn) viewHelper.handleClick(e);
    });
    buildPanel(mount, pointsMat, maxDim, (on) => (gizmoOn = on));

    renderer.autoClear = false;
    const clock = new THREE.Clock();
    (function loop() {
      requestAnimationFrame(loop);
      const dt = clock.getDelta();
      if (viewHelper.animating) viewHelper.update(dt);
      controls.update();
      renderer.clear();
      renderer.render(scene, camera);
      if (gizmoOn) viewHelper.render(renderer);
    })();

    const resize = () => {
      const W = mount.clientWidth || w;
      const H = mount.clientHeight || h;
      renderer.setSize(W, H);
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', resize);
  };

  try {
    if (ext === '.glb' || ext === '.gltf') {
      new GLTFLoader().parse(
        buf,
        '',
        (gltf) => {
          frame(gltf.scene);
          afterLoad();
        },
        fail
      );
    } else if (ext === '.obj') {
      frame(new OBJLoader().parse(new TextDecoder().decode(buf)));
      afterLoad();
    } else if (ext === '.ply') {
      const geo = new PLYLoader().parse(buf);
      const hasColor = !!geo.getAttribute('color');
      let obj;
      if (geo.index) {
        geo.computeVertexNormals();
        obj = new THREE.Mesh(
          geo,
          new THREE.MeshStandardMaterial({
            color: hasColor ? 0xffffff : 0x9aa4b2,
            vertexColors: hasColor,
            side: THREE.DoubleSide,
            flatShading: true,
          })
        );
      } else {
        pointsMat = new THREE.PointsMaterial({
          vertexColors: hasColor,
          color: hasColor ? 0xffffff : 0x7ea6ff,
        });
        obj = new THREE.Points(geo, pointsMat);
      }
      frame(obj);
      afterLoad();
    } else if (ext === '.pcd') {
      const pts = new PCDLoader().parse(buf);
      pointsMat = pts.material;
      frame(pts);
      afterLoad();
    } else {
      fail(new Error('unsupported 3D type ' + ext));
    }
  } catch (e) {
    fail(e);
  }
}

function buildPanel(mount, pointsMat, maxDim, onGizmo) {
  const panel = document.createElement('div');
  panel.className = 'ov3d-panel';

  const gizmo = document.createElement('button');
  gizmo.className = 'ov3d-btn on';
  gizmo.textContent = 'Axes';
  gizmo.onclick = () => {
    const on = !gizmo.classList.contains('on');
    gizmo.classList.toggle('on', on);
    onGizmo(on);
  };
  panel.appendChild(gizmo);

  if (pointsMat) {
    panel.appendChild(
      slider('Size', maxDim * 0.002, maxDim * 0.08, maxDim * 0.001, pointsMat.size, (v) => {
        pointsMat.size = v;
      })
    );
    panel.appendChild(
      slider('Color', 0, 2, 0.05, 1, (v) => {
        pointsMat.color.setScalar(v);
        pointsMat.needsUpdate = true;
      })
    );
  }
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

function ensureStyle() {
  if (document.getElementById('ov3d-style')) return;
  const s = document.createElement('style');
  s.id = 'ov3d-style';
  s.textContent = `
    .ov3d-panel{position:absolute;top:12px;right:12px;z-index:5;display:flex;flex-direction:column;gap:8px;
      padding:10px 12px;background:rgba(13,17,23,.82);border:1px solid #30363d;border-radius:8px;
      font:12px -apple-system,BlinkMacSystemFont,sans-serif;color:#e6edf3}
    .ov3d-btn{background:#21262d;border:1px solid #30363d;color:#c9d1d9;border-radius:6px;padding:4px 10px;cursor:pointer;font:inherit}
    .ov3d-btn.on{background:#238636;border-color:#2ea043;color:#fff}
    .ov3d-slider{display:flex;flex-direction:column;gap:3px}
    .ov3d-slider input{width:132px;accent-color:#2ea043}`;
  document.head.appendChild(s);
}
