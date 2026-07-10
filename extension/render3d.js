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

// Source coordinate systems. three.js is OpenGL (Y-up, right-handed), so each
// entry is the rotation that brings data authored in that convention up into
// this view. Data is assumed OpenGL unless the viewer says otherwise.
const X = new THREE.Vector3(1, 0, 0);
const CONVENTIONS = {
  'OpenGL (Y-up)': new THREE.Quaternion(),
  'Z-up (Blender, ROS, CAD)': new THREE.Quaternion().setFromAxisAngle(X, -Math.PI / 2),
  'OpenCV (Y-down, Z-fwd)': new THREE.Quaternion().setFromAxisAngle(X, Math.PI),
};

export function render3D(buf, mount, ext) {
  ensureStyle();
  mount.style.position = 'relative';

  const fail = (e) => {
    // Release the WebGL context we allocated before parsing (a bad file must not
    // leak a context; the render loop that normally disposes never starts here).
    try {
      renderer.dispose();
      renderer.forceContextLoss();
    } catch {
      /* renderer not created yet */
    }
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
  let grid = null;
  const pivot = new THREE.Group();
  scene.add(pivot);

  // Recompute bounds (with the pivot's current orientation) and frame the camera.
  const reframe = () => {
    pivot.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(pivot);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    maxDim = Math.max(size.x, size.y, size.z) || 1;
    camera.near = maxDim / 1000;
    camera.far = maxDim * 1000;
    camera.position.set(0, size.y * 0.15, maxDim * 2.2);
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
    controls.update();
    if (grid) grid.position.y = box.min.y;
  };

  // Center the object at the pivot origin so orientation changes rotate about its
  // center, not the world origin.
  const frame = (obj) => {
    const c = new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3());
    obj.position.sub(c);
    // Don't frustum-cull the single previewed object (point clouds' sprites
    // extend past their bounding sphere, so parts disappear at orbit angles).
    obj.traverse((o) => (o.frustumCulled = false));
    pivot.add(obj);
    reframe();
  };

  // Re-interpret the source axes and re-frame (the gizmo keeps showing world XYZ).
  const setConvention = (name) => {
    pivot.quaternion.copy(CONVENTIONS[name] || CONVENTIONS['OpenGL (Y-up)']);
    reframe();
  };

  let gizmoOn = true;

  const afterLoad = () => {
    grid = new THREE.GridHelper(maxDim * 4, 16, 0x30363d, 0x1c2128);
    scene.add(grid);
    reframe(); // place the grid at the object's base under the current orientation

    if (pointsMat) {
      pointsMat.size = maxDim * 0.02;
      pointsMat.sizeAttenuation = true;
    }

    const viewHelper = new ViewHelper(camera, renderer.domElement);
    renderer.domElement.addEventListener('pointerup', (e) => {
      if (gizmoOn) viewHelper.handleClick(e);
    });
    buildPanel(mount, pointsMat, maxDim, (on) => (gizmoOn = on), setConvention);

    const resize = () => {
      const W = mount.clientWidth || w;
      const H = mount.clientHeight || h;
      renderer.setSize(W, H);
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', resize);

    renderer.autoClear = false;
    const clock = new THREE.Clock();
    (function loop() {
      // Toggling Preview off removes the pane/canvas from the DOM; tear down the
      // loop and GPU context so repeated opens do not exhaust WebGL contexts.
      if (!renderer.domElement.isConnected) {
        window.removeEventListener('resize', resize);
        renderer.dispose();
        renderer.forceContextLoss();
        return;
      }
      requestAnimationFrame(loop);
      const dt = clock.getDelta();
      if (viewHelper.animating) viewHelper.update(dt);
      controls.update();
      renderer.clear();
      renderer.render(scene, camera);
      if (gizmoOn) viewHelper.render(renderer);
    })();
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

function buildPanel(mount, pointsMat, maxDim, onGizmo, onConvention) {
  const panel = document.createElement('div');
  panel.className = 'ov3d-panel';

  // Source coordinate system: reinterpret the input axes so it stands up right.
  const coords = document.createElement('label');
  coords.className = 'ov3d-slider';
  coords.append('Coords');
  const select = document.createElement('select');
  select.className = 'ov3d-select';
  for (const name of Object.keys(CONVENTIONS)) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  }
  select.onchange = () => onConvention(select.value);
  coords.appendChild(select);
  panel.appendChild(coords);

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
    .ov3d-slider input{width:132px;accent-color:#2ea043}
    .ov3d-select{width:150px;background:#21262d;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:3px 6px;font:inherit}`;
  document.head.appendChild(s);
}
