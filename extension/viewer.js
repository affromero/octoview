// octoview viewer — runs in the extension's own tab (opened by the background),
// so it can execute scripts that no in-page frame on github.com can. The tokenized
// raw URL arrives in the location hash; we fetch it (host permission + token in the
// URL, no cookies needed) and render by type. Report HTML (and notebook text/html
// outputs) run their inline scripts inside a manifest sandbox page.
const O = octoview;
const mount = document.getElementById('mount');
const params = new URLSearchParams(location.hash.slice(1));
const src = params.get('src');
const fileName = params.get('name') || 'file';
document.title = 'octoview · ' + fileName;

function msg(text) {
  mount.innerHTML = '';
  const p = document.createElement('p');
  p.className = 'ov-msg';
  p.textContent = text;
  mount.appendChild(p);
}

// A sandbox iframe (manifest-declared, own relaxed CSP with 'unsafe-inline') is the
// only extension context allowed to run arbitrary inline report scripts. Same-tab
// parent↔child postMessage is reliable (unlike the cross-tab/process case).
function sandboxFrame(html) {
  // Tag the frame with a nonce (via the hash) and match the ready ping on it,
  // rather than on e.source === f.contentWindow, which can fail for a sandbox
  // page's opaque-origin window in Safari (and disambiguates multiple frames).
  const id = 'ov' + Math.random().toString(36).slice(2);
  const f = document.createElement('iframe');
  f.className = 'ov-nb-out';
  f.src = 'sandbox/report.html#' + id;
  const onReady = (e) => {
    if (e.data && e.data.octoviewReady === id) {
      f.contentWindow.postMessage({ octoviewHtml: html }, '*');
      window.removeEventListener('message', onReady);
    }
  };
  window.addEventListener('message', onReady);
  return f;
}

// Lazy-load a script once (three.js is ~800KB — only pulled for 3D files).
const scripts = {};
function loadScript(url) {
  if (!scripts[url]) {
    scripts[url] = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = res;
      s.onerror = () => rej(new Error('failed to load ' + url));
      document.head.appendChild(s);
    });
  }
  return scripts[url];
}

const THREE_EXTS = ['.glb', '.gltf', '.obj', '.ply', '.pcd'];

(async () => {
  if (!src) return msg('No source in the URL.');
  msg('Loading ' + fileName + ' …');
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error('HTTP ' + res.status + ' fetching file');
    const buf = await res.arrayBuffer();
    const ext = O.extname(fileName);
    mount.innerHTML = '';

    if (ext === '.html' || ext === '.htm') {
      const f = sandboxFrame(O.decode(buf));
      f.className = 'ov-full';
      mount.appendChild(f);
    } else if (ext === '.md') {
      O.renderMarkdown(O.decode(buf), mount);
    } else if (ext === '.ipynb') {
      O.renderNotebook(JSON.parse(O.decode(buf)), mount, sandboxFrame);
    } else if (THREE_EXTS.includes(ext)) {
      await loadScript('vendor/three3d.js');
      await loadScript('viewer3d.js');
      window.octoview3d(buf, mount, ext);
    } else {
      msg('No preview for ' + ext + ' yet.');
    }
  } catch (e) {
    msg("Couldn't load: " + e.message);
    console.error('[octoview]', e);
  }
})();
