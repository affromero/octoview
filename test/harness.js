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
    mount.appendChild(sandboxFrame(O.decode(buf), 'ov-frame'));
  } else if (ext === '.ipynb') {
    O.renderNotebook(JSON.parse(O.decode(buf)), mount, (html) => sandboxFrame(html, 'ov-nb-out'));
  } else {
    const { render3D } = await import('/extension/render3d.js');
    render3D(buf, mount, ext);
  }
  window.__ovReady = true;
} catch (e) {
  window.__ovError = String((e && e.message) || e);
}
