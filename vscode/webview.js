import { renderFile } from './render-file.js';

// Keep the bridge private. Report frames never receive the VS Code API.
const vscode = acquireVsCodeApi();
const mount = document.getElementById('mount');
const status = document.getElementById('status');
const refresh = document.getElementById('refresh');
let rendering = false;

function decodeBytes(base64) {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)).buffer;
}

function showError(error) {
  status.textContent = 'Could not preview: ' + error.message;
  status.hidden = false;
  refresh.disabled = false;
}

function htmlFrame(html) {
  const frame = document.createElement('iframe');
  frame.className = 'ov-frame';
  frame.title = 'Sandboxed HTML preview';
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.srcdoc = html;
  return frame;
}

function chart(spec) {
  const div = document.createElement('div');
  div.className = 'ov-nb-plotly';
  div.style.height = ((spec.layout && spec.layout.height) || 420) + 'px';
  import('./vendor/plotly.esm.js')
    .then(({ default: Plotly }) =>
      Plotly.newPlot(div, spec.data || [], spec.layout || {}, {
        responsive: true,
        displaylogo: false,
      })
    )
    .catch(showError);
  return div;
}

window.addEventListener('message', async (event) => {
  // Electron can omit event.source on host messages. The exact webview origin
  // authenticates the host; sandboxed report frames have the opaque "null" origin.
  if (event.origin !== window.location.origin) return;
  const message = event.data;
  if (message?.type === 'error') {
    showError(new Error(message.message));
    return;
  }
  if (message?.type !== 'preview' || rendering) return;
  rendering = true;
  try {
    mount.replaceChildren();
    mount.className = '';
    mount.removeAttribute('style');
    document.getElementById('filename').textContent = message.name;
    const bytes = decodeBytes(message.bytes);
    if (bytes.byteLength < 1024 && globalThis.octoview.lfsPointer(bytes)) {
      throw new Error('This is a Git LFS pointer. Run git lfs pull to download the file.');
    }
    await renderFile(bytes, mount, message.ext, {
      htmlFrame,
      chart,
      lcc: async (metadata, target) => {
        const { renderLcc } = await import('./render-splat.js');
        renderLcc(
          metadata,
          decodeBytes(message.companions['index.bin']),
          decodeBytes(message.companions['data.bin']),
          target
        );
      },
    });
    status.hidden = true;
  } catch (error) {
    showError(error);
  } finally {
    rendering = false;
    refresh.disabled = false;
  }
});

refresh.addEventListener('click', () => {
  refresh.disabled = true;
  status.textContent = 'Loading preview...';
  status.hidden = false;
  vscode.postMessage({ type: 'refresh' });
});
vscode.postMessage({ type: 'ready' });
