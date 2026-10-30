// Exercise the production dispatch under the harness page's github-like CSP.
import { renderFile } from '../extension/render-file.js';

const mount = document.getElementById('mount');
const params = new URLSearchParams(location.hash.slice(1));
const ext = octoview.extname(params.get('name') || '');

function htmlFrame(html) {
  const frame = document.createElement('iframe');
  frame.className = ext === '.ipynb' ? 'ov-nb-out' : 'ov-frame';
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.srcdoc = html;
  return frame;
}

function chart(spec) {
  const div = document.createElement('div');
  div.className = 'ov-nb-plotly';
  div.style.height = ((spec.layout && spec.layout.height) || 450) + 'px';
  import('../extension/vendor/plotly.esm.js')
    .then(({ default: Plotly }) =>
      Plotly.newPlot(div, spec.data || [], spec.layout || {}, {
        responsive: true,
        displaylogo: false,
      })
    )
    .catch((e) => (window.__ovError = 'plotly: ' + e.message));
  return div;
}

try {
  const response = await fetch(params.get('sample'));
  if (!response.ok) throw new Error('Sample download failed: ' + response.status);
  await renderFile(await response.arrayBuffer(), mount, ext, { htmlFrame, chart });
  window.__ovReady = true;
} catch (e) {
  window.__ovError = String((e && e.message) || e);
}
