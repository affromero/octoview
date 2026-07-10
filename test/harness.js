// Test-only mirror of content.js render(): dispatch a fetched sample the same way
// the inline content script does, but with a relative render3d import (no
// browser.*). Runs under the harness page's github-like CSP so WebKit exercises
// the real rendering path. Keep in sync with content.js render().
const O = octoview;
const mount = document.getElementById('mount');
const params = new URLSearchParams(location.hash.slice(1));
const sample = params.get('sample');
const ext = O.extname(params.get('name') || '');

function sandboxFrame(html, cls) {
  const f = document.createElement('iframe');
  f.className = cls;
  f.setAttribute('sandbox', 'allow-scripts');
  f.srcdoc = html;
  return f;
}

try {
  const buf = await (await fetch(sample)).arrayBuffer();
  if (ext === '.html' || ext === '.htm') {
    // DELIBERATE divergence from content.js: reportFrame needs the extension
    // origin (browser.runtime.getURL), which no harness can fake — so this
    // exercises its static fallback, which is exactly this sandboxFrame call.
    // The live viewer path is verified manually in Safari.
    mount.appendChild(sandboxFrame(O.decode(buf), 'ov-frame'));
  } else if (ext === '.ipynb') {
    // Mirror of content.js plotlyChart, with a relative import (no browser.*).
    // A chart failure surfaces as __ovError so the e2e fails loudly.
    const plotlyChart = (spec) => {
      const div = document.createElement('div');
      div.className = 'ov-nb-plotly';
      div.style.height = ((spec.layout && spec.layout.height) || 450) + 'px';
      import('/extension/vendor/plotly.esm.js')
        .then(({ default: Plotly }) =>
          Plotly.newPlot(div, spec.data || [], spec.layout || {}, {
            responsive: true,
            displaylogo: false,
          })
        )
        .catch((e) => (window.__ovError = 'plotly: ' + ((e && e.message) || e)));
      return div;
    };
    O.renderNotebook(
      JSON.parse(O.decode(buf)),
      mount,
      (html) => sandboxFrame(html, 'ov-nb-out'),
      plotlyChart
    );
  } else if (ext === '.npy' || ext === '.npz') {
    const { renderArray } = await import('/extension/render-array.js');
    await renderArray(buf, mount, ext);
  } else if (ext === '.parquet') {
    const { renderTable } = await import('/extension/render-table.js');
    await renderTable(buf, mount, ext);
  } else if (ext === '.safetensors' || ext === '.gguf') {
    const { renderModel } = await import('/extension/render-model.js');
    renderModel(buf, mount, ext);
  } else if (ext === '.exr' || ext === '.hdr' || ext === '.tif' || ext === '.tiff') {
    const { renderImage } = await import('/extension/render-image.js');
    renderImage(buf, mount, ext);
  } else if (ext === '.splat' || ext === '.splattie') {
    const { renderSplat } = await import('/extension/render-splat.js');
    await renderSplat(buf, mount, ext);
  } else if (ext === '.ply') {
    const { isPlySplat, renderSplat } = await import('/extension/render-splat.js');
    if (isPlySplat(buf)) {
      renderSplat(buf, mount, ext);
    } else {
      const { render3D } = await import('/extension/render3d.js');
      render3D(buf, mount, ext);
    }
  } else {
    const { render3D } = await import('/extension/render3d.js');
    render3D(buf, mount, ext);
  }
  window.__ovReady = true;
} catch (e) {
  window.__ovError = String((e && e.message) || e);
}
