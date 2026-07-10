// octoview — inline preview on GitHub blob pages. Everything renders IN the blob
// view (no new tab): the content script fetches the file with the page's cookies
// and renders it in a pane that replaces the code, with Preview toggling back to
// the code. Rendering runs in the content script's isolated world, which is not
// bound by github.com's CSP for our own code (three.js, DOM building). HTML
// reports render in a sandboxed frame, which inherits github's CSP, so their own
// inline scripts do not run in Safari (a platform limit) but self-contained
// static HTML shows. core.js (loaded before) exposes `octoview`; marked is loaded
// alongside for notebook markdown.
const O = octoview;
const BTN_ID = 'octoview-btn';
const PANE_ID = 'octoview-pane';
const THREE_EXTS = ['.glb', '.gltf', '.obj', '.ply', '.pcd'];
const ARRAY_EXTS = ['.npy', '.npz'];
const TABLE_EXTS = ['.parquet'];
const MODEL_EXTS = ['.safetensors', '.gguf'];
const IMAGE_EXTS = ['.exr', '.hdr', '.tif', '.tiff'];
const SPLAT_EXTS = ['.splat', '.splattie'];

// Cheap header sniff: a 3DGS .ply carries gaussian props; a plain .ply does not.
// Lets us route .ply to the splat vs the mesh/point-cloud renderer without
// loading either module first.
function isPlySplatHead(buf) {
  const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(8192, buf.byteLength)));
  return /f_dc_0/.test(head) && /scale_0/.test(head) && /rot_0/.test(head);
}

// Heavy renderers are ES modules, imported only when their file type is opened,
// so normal github browsing stays light.
function loadModule(file) {
  return import(browser.runtime.getURL(file));
}

function fileName() {
  return decodeURIComponent(location.pathname.split('/').pop() || 'file');
}
function extOf() {
  return O.extname(fileName());
}

// GitHub's blob content region, which we hide while previewing.
function findContent() {
  return (
    document.querySelector('[data-testid="blob-viewer-file-content"]') ||
    document.getElementById('read-only-cursor-text-area')?.closest('section, div[class]') ||
    document.querySelector('.react-code-view-bottom-padding')?.closest('div[class]') ||
    document.querySelector('.Box-body') ||
    null
  );
}

let hidden = null;
function closePane(btn) {
  document.getElementById(PANE_ID)?.remove();
  if (hidden) {
    hidden.style.display = '';
    hidden = null;
  }
  if (btn) btn.classList.remove('active');
}

async function onPreview(btn) {
  if (document.getElementById(PANE_ID)) return closePane(btn);
  const label = btn.textContent;
  btn.textContent = 'Loading…';
  try {
    // Model files keep their structure at the front, so range-fetch the first 32MB
    // instead of pulling a multi-GB weights file down whole.
    const headers = MODEL_EXTS.includes(extOf()) ? { Range: 'bytes=0-33554431' } : undefined;
    const res = await fetch(O.pickRawUrl(document, location.href), {
      credentials: 'same-origin',
      headers,
    });
    if (!res.ok) throw new Error('GitHub returned HTTP ' + res.status);
    openPane(btn, await res.arrayBuffer());
  } catch (e) {
    console.error('[octoview]', e);
    btn.textContent = 'failed';
    setTimeout(() => (btn.textContent = label), 2500);
    return;
  }
  btn.textContent = label;
}

function openPane(btn, buf) {
  ensureStyle();
  const pane = document.createElement('div');
  pane.id = PANE_ID;
  const content = findContent();
  if (content && content.parentElement) {
    content.style.display = 'none';
    hidden = content;
    content.parentElement.insertBefore(pane, content);
  } else {
    pane.classList.add('ov-float');
    document.body.appendChild(pane);
  }
  btn.classList.add('active');
  render(pane, buf, extOf()).catch((e) => msg(pane, "Couldn't render: " + e.message));
}

async function render(pane, buf, ext) {
  // Critical dimensions are set inline (CSSOM), not only via the stylesheet, in
  // case github's CSP blocks our injected <style>; the canvas/frame still fills.
  if (ext === '.html' || ext === '.htm') {
    pane.classList.add('ov-fill');
    pane.style.height = '78vh';
    pane.appendChild(sandboxFrame(O.decode(buf), 'ov-frame'));
  } else if (ext === '.ipynb') {
    pane.classList.add('ov-scroll');
    pane.style.maxHeight = '82vh';
    pane.style.overflow = 'auto';
    O.renderNotebook(JSON.parse(O.decode(buf)), pane, (html) => sandboxFrame(html, 'ov-nb-out'));
  } else if (THREE_EXTS.includes(ext) || SPLAT_EXTS.includes(ext)) {
    pane.classList.add('ov-fill');
    pane.style.height = '78vh';
    if (SPLAT_EXTS.includes(ext) || (ext === '.ply' && isPlySplatHead(buf))) {
      const { renderSplat } = await loadModule('render-splat.js');
      renderSplat(buf, pane, ext);
    } else {
      const { render3D } = await loadModule('render3d.js');
      render3D(buf, pane, ext);
    }
  } else if (ARRAY_EXTS.includes(ext)) {
    pane.classList.add('ov-scroll');
    pane.style.maxHeight = '82vh';
    pane.style.overflow = 'auto';
    const { renderArray } = await loadModule('render-array.js');
    await renderArray(buf, pane, ext);
  } else if (TABLE_EXTS.includes(ext)) {
    pane.classList.add('ov-scroll');
    pane.style.maxHeight = '82vh';
    pane.style.overflow = 'auto';
    const { renderTable } = await loadModule('render-table.js');
    await renderTable(buf, pane, ext);
  } else if (MODEL_EXTS.includes(ext)) {
    pane.classList.add('ov-scroll');
    pane.style.maxHeight = '82vh';
    pane.style.overflow = 'auto';
    const { renderModel } = await loadModule('render-model.js');
    renderModel(buf, pane, ext);
  } else if (IMAGE_EXTS.includes(ext)) {
    pane.classList.add('ov-scroll');
    pane.style.maxHeight = '82vh';
    pane.style.overflow = 'auto';
    const { renderImage } = await loadModule('render-image.js');
    renderImage(buf, pane, ext);
  } else {
    msg(pane, 'No preview for ' + ext + ' yet.');
  }
}

// A sandboxed frame runs the report/output's scripts in an opaque origin. Under
// github's CSP those inline scripts are blocked (Safari), so this is a static
// render; self-contained HTML content still shows.
function sandboxFrame(html, cls) {
  const f = document.createElement('iframe');
  f.className = cls;
  f.setAttribute('sandbox', 'allow-scripts');
  f.srcdoc = html;
  return f;
}

function msg(pane, text) {
  const p = document.createElement('p');
  p.className = 'ov-msg';
  p.textContent = text;
  pane.appendChild(p);
}

function ensureStyle() {
  if (document.getElementById('octoview-style')) return;
  const s = document.createElement('style');
  s.id = 'octoview-style';
  s.textContent = `
    #${BTN_ID}{font:500 12px/20px -apple-system,BlinkMacSystemFont,sans-serif;
      margin-right:8px;padding:3px 12px;color:#fff;background:#238636;
      border:1px solid rgba(240,246,252,.1);border-radius:6px;cursor:pointer;
      animation:octoview-pulse 2.4s ease-out infinite}
    #${BTN_ID}:hover{background:#2ea043;animation:none}
    #${BTN_ID}.active{background:#1f6feb;border-color:#388bfd;animation:none}
    @keyframes octoview-pulse{0%{box-shadow:0 0 0 0 rgba(46,160,67,.5)}
      70%{box-shadow:0 0 0 6px rgba(46,160,67,0)}100%{box-shadow:0 0 0 0 rgba(46,160,67,0)}}
    #${PANE_ID}{border:1px solid #30363d;border-radius:6px;overflow:hidden;background:#0d1117;
      color:#e6edf3;font:14px/1.55 -apple-system,BlinkMacSystemFont,sans-serif;margin:0 0 16px}
    #${PANE_ID}.ov-fill{height:78vh}
    #${PANE_ID}.ov-scroll{max-height:82vh;overflow:auto}
    #${PANE_ID}.ov-float{position:fixed;inset:52px 12px 12px;z-index:99998;height:auto}
    #${PANE_ID} .ov-frame{width:100%;height:100%;border:0;background:#fff}
    #${PANE_ID} .ov-msg{padding:24px}
    #${PANE_ID} .ov-nb{max-width:980px;margin:0 auto;padding:24px 20px}
    #${PANE_ID} .ov-md :is(h1,h2,h3){border-bottom:1px solid #21262d;padding-bottom:.3em}
    #${PANE_ID} .ov-md a{color:#4493f8}
    #${PANE_ID} .ov-code{background:#161b22;border:1px solid #30363d;border-radius:6px;
      padding:12px 14px;overflow-x:auto;font:12.5px/1.5 ui-monospace,monospace;color:#e6edf3;margin:0 0 4px}
    #${PANE_ID} .ov-nb-text{padding:4px 14px;margin:0 0 10px;overflow-x:auto;
      font:12.5px/1.5 ui-monospace,monospace;white-space:pre-wrap;color:#adbac7}
    #${PANE_ID} .ov-nb-err{color:#ff7b72}
    #${PANE_ID} .ov-nb-out{width:100%;height:360px;border:1px solid #30363d;border-radius:6px;background:#fff;margin:0 0 12px}
    #${PANE_ID} .ov-nb-img{max-width:100%;background:#fff;border-radius:6px;margin:0 0 12px}
    #${PANE_ID} .ov-arr-meta{padding:14px 18px 6px;font:12.5px/1.5 ui-monospace,monospace;color:#adbac7}
    #${PANE_ID} .ov-arr-canvas{display:block;margin:0 18px 18px;border:1px solid #30363d;border-radius:6px}
    #${PANE_ID} .ov-arr-tabs{display:flex;gap:6px;padding:0 18px 10px}
    #${PANE_ID} .ov-arr-tab{font:12px -apple-system,sans-serif;padding:3px 12px;color:#c9d1d9;
      background:#21262d;border:1px solid #30363d;border-radius:6px;cursor:pointer}
    #${PANE_ID} .ov-arr-tab.on{background:#1f6feb;border-color:#388bfd;color:#fff}
    #${PANE_ID} .ov-tbl-meta{padding:14px 18px 8px;font:12.5px/1.5 ui-monospace,monospace;color:#adbac7}
    #${PANE_ID} .ov-tbl-scroll{overflow-x:auto;margin:0 0 16px;padding:0 18px}
    #${PANE_ID} .ov-tbl{border-collapse:collapse;font:12.5px/1.45 ui-monospace,monospace;white-space:nowrap}
    #${PANE_ID} .ov-tbl th,#${PANE_ID} .ov-tbl td{border:1px solid #21262d;padding:3px 10px;text-align:left}
    #${PANE_ID} .ov-tbl th{position:sticky;top:0;background:#161b22;color:#e6edf3}
    #${PANE_ID} .ov-tbl-idx{color:#6e7681;text-align:right}
    #${PANE_ID} .ov-mdl-meta{padding:14px 18px 4px;font:12.5px/1.5 ui-monospace,monospace;color:#e6edf3}
    #${PANE_ID} .ov-mdl-h{padding:14px 18px 6px;font:600 12px/1.4 -apple-system,sans-serif;color:#7d8590;text-transform:uppercase;letter-spacing:.04em}
    #${PANE_ID} .ov-img-panel{display:flex;flex-direction:column;gap:4px;margin:0 18px 18px;
      font:12px ui-monospace,monospace;color:#adbac7;width:260px}
    #${PANE_ID} .ov-img-panel input{accent-color:#2ea043}`;
  document.head.appendChild(s);
}

function addButton() {
  ensureStyle();
  const btn = document.createElement('button');
  btn.id = BTN_ID;
  btn.textContent = 'Preview';
  btn.addEventListener('click', () => onPreview(btn));

  // Leftmost item of GitHub's file-view segmented control (Code | Blame, or
  // Preview | Code | Blame for notebooks), so ours sits left of Code.
  const blame = [...document.querySelectorAll('a[href*="/blame/"]')].find((a) =>
    a.href.startsWith('https://github.com/')
  );
  const seg = blame && (blame.closest('ul, nav, [role="tablist"]') || blame.parentElement);
  if (seg) {
    if (seg.tagName === 'UL') {
      const li = document.createElement('li');
      li.appendChild(btn);
      seg.insertBefore(li, seg.firstElementChild);
    } else {
      seg.insertBefore(btn, seg.firstElementChild);
    }
    return;
  }
  const raw = [...document.querySelectorAll('a[href*="/raw/"]')].find((a) =>
    a.href.startsWith('https://github.com/')
  );
  if (raw && raw.parentElement) raw.parentElement.appendChild(btn);
  else {
    btn.style.cssText = 'position:fixed;top:70px;right:20px;z-index:99999';
    document.body.appendChild(btn);
  }
}

function sync() {
  const show = /^\/[^/]+\/[^/]+\/blob\//.test(location.pathname) && O.SUPPORTED.includes(extOf());
  const btn = document.getElementById(BTN_ID);
  if (show && !btn) addButton();
  else if (!show && btn) {
    closePane();
    btn.remove();
  }
}

// github.com is a SPA — re-sync on soft navigations, closing any open pane.
let lastPath = location.pathname;
let queued = false;
function syncSoon() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      closePane();
    }
    sync();
  });
}

sync();
document.addEventListener('turbo:load', syncSoon);
document.addEventListener('soft-nav:end', syncSoon);
new MutationObserver(syncSoon).observe(document.body, { childList: true, subtree: true });
