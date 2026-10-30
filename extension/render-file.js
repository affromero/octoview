// Shared dispatch for browser previews, VS Code, and the render test harness.
// Hosts supply HTML frames, notebook charts, and access to LCC companions.
export async function renderFile(buf, mount, ext, { htmlFrame, chart, lcc } = {}) {
  const O = globalThis.octoview;
  if (ext === '.html' || ext === '.htm') {
    mount.classList.add('ov-fill');
    mount.style.height = '78vh';
    mount.appendChild(htmlFrame(O.decode(buf)));
    return;
  }
  if (
    ['.glb', '.gltf', '.obj', '.ply', '.pcd', '.splat', '.spz', '.ksplat', '.sog', '.lcc'].includes(
      ext
    )
  ) {
    mount.classList.add('ov-fill');
    mount.style.height = '78vh';
    if (ext === '.lcc') {
      if (!lcc) throw new Error('LCC requires index.bin and data.bin companions.');
      await lcc(buf, mount);
    } else if (['.splat', '.spz', '.ksplat', '.sog', '.ply'].includes(ext)) {
      const { isPlySplat, renderSplat } = await import('./render-splat.js');
      if (ext !== '.ply' || isPlySplat(buf)) await renderSplat(buf, mount, ext);
      else {
        const { render3D } = await import('./render3d.js');
        render3D(buf, mount, ext);
      }
    } else {
      const { render3D } = await import('./render3d.js');
      render3D(buf, mount, ext);
    }
    return;
  }
  mount.classList.add('ov-scroll');
  mount.style.maxHeight = '82vh';
  mount.style.overflow = 'auto';
  if (ext === '.ipynb') {
    O.renderNotebook(JSON.parse(O.decode(buf)), mount, htmlFrame, chart);
  } else if (ext === '.npy' || ext === '.npz') {
    const { renderArray } = await import('./render-array.js');
    await renderArray(buf, mount, ext);
  } else if (['.parquet', '.arrow', '.feather', '.ipc'].includes(ext)) {
    const { renderTable } = await import('./render-table.js');
    await renderTable(buf, mount, ext);
  } else if (ext === '.onnx') {
    const { renderOnnx } = await import('./render-onnx.js');
    renderOnnx(buf, mount);
  } else if (ext === '.safetensors' || ext === '.gguf') {
    const { renderModel } = await import('./render-model.js');
    renderModel(buf, mount, ext);
  } else if (['.exr', '.hdr', '.tif', '.tiff'].includes(ext)) {
    const { renderImage } = await import('./render-image.js');
    renderImage(buf, mount, ext);
  } else {
    throw new Error('No preview for ' + ext + ' yet.');
  }
}
