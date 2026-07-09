// octoview 3D renderer — meshes and point clouds via three.js loaders, which
// PARSE the ArrayBuffer on the main thread (no workers, no blob URLs), so they're
// WebKit-safe. Lazy-loaded with vendor/three3d.js (exposes window.OV3D). Exposed
// as window.octoview3d(buf, mount, ext).
window.octoview3d = function render3D(buf, mount, ext) {
  const { THREE, GLTFLoader, OBJLoader, PLYLoader, PCDLoader, OrbitControls } = window.OV3D;

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
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(1, 1, 1);
  scene.add(key);

  const frame = (obj) => {
    scene.add(obj);
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    camera.near = maxDim / 1000;
    camera.far = maxDim * 1000;
    camera.position.copy(center).add(new THREE.Vector3(0, size.y * 0.15, maxDim * 2.2));
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
  };

  try {
    if (ext === '.glb' || ext === '.gltf') {
      new GLTFLoader().parse(buf, '', (gltf) => frame(gltf.scene), fail);
    } else if (ext === '.obj') {
      frame(new OBJLoader().parse(new TextDecoder().decode(buf)));
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
        obj = new THREE.Points(
          geo,
          new THREE.PointsMaterial({
            size: 0.02,
            vertexColors: hasColor,
            color: hasColor ? 0xffffff : 0x7ea6ff,
          })
        );
      }
      frame(obj);
    } else if (ext === '.pcd') {
      frame(new PCDLoader().parse(buf));
    } else {
      fail(new Error('unsupported 3D type ' + ext));
      return;
    }
  } catch (e) {
    fail(e);
    return;
  }

  (function loop() {
    requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  })();

  window.addEventListener('resize', () => {
    const W = mount.clientWidth || w;
    const H = mount.clientHeight || h;
    renderer.setSize(W, H);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
  });
};
