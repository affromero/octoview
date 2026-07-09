// octoview — browser glue on top of core.js (loaded before this, exposes
// `octoview`). Injects the Preview button on GitHub blob pages, fetches the file
// with the page's cookies (works for private repos), and renders it in-page inside
// a sandboxed srcdoc frame. Rendering is IN-PAGE on purpose: a sandboxed frame's
// opaque origin isn't bound by github.com's CSP, so scripts run — and there's no
// cross-process hop to an extension page (postMessage / storage / background
// messaging all fail to cross that boundary in Safari).
const O = octoview;
const BTN_ID = 'octoview-btn';

function fileName() {
  return decodeURIComponent(location.pathname.split('/').pop() || 'file');
}

// Vendored splat widget, fetched once as text so it can be inlined into the
// sandboxed frame (an extension <script src> would be blocked there).
let _widgetJs = null;
async function widgetJs() {
  if (_widgetJs === null) {
    const res = await fetch(browser.runtime.getURL('vendor/splattie-widget.cdn.js'));
    _widgetJs = await res.text();
  }
  return _widgetJs;
}

function buildOverlay(name) {
  document.getElementById('octoview-overlay')?.remove();
  const ov = document.createElement('div');
  ov.id = 'octoview-overlay';
  ov.innerHTML =
    '<div class="ov-bar"><span class="ov-name"></span>' +
    '<button class="ov-close">Close ✕</button></div><div class="ov-body"></div>';
  ov.querySelector('.ov-name').textContent = name;
  const close = () => {
    ov.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => e.key === 'Escape' && close();
  ov.querySelector('.ov-close').onclick = close;
  document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);
  return ov.querySelector('.ov-body');
}

async function onPreview(btn) {
  const name = fileName();
  btn.textContent = 'Loading…';
  try {
    const res = await fetch(O.pickRawUrl(document, location.href), { credentials: 'same-origin' });
    if (!res.ok) throw new Error('GitHub returned HTTP ' + res.status);
    const buf = await res.arrayBuffer();
    const widget = O.SPLAT.includes(O.extname(name)) ? await widgetJs() : null;
    O.dispatchPreview({ body: buildOverlay(name), name, buf, widget });
  } catch (e) {
    O.dispatchPreview({ body: buildOverlay(name), name, error: e.message });
    console.error('[octoview]', e);
  } finally {
    btn.textContent = 'Preview';
  }
}

function ensureStyle() {
  if (document.getElementById('octoview-style')) return;
  const s = document.createElement('style');
  s.id = 'octoview-style';
  s.textContent = `
    #${BTN_ID}{font:500 12px/20px -apple-system,BlinkMacSystemFont,sans-serif;
      margin-left:8px;padding:3px 12px;color:#fff;background:#238636;
      border:1px solid rgba(240,246,252,.1);border-radius:6px;cursor:pointer;
      animation:octoview-pulse 2.4s ease-out infinite}
    #${BTN_ID}:hover{background:#2ea043;animation:none}
    @keyframes octoview-pulse{0%{box-shadow:0 0 0 0 rgba(46,160,67,.5)}
      70%{box-shadow:0 0 0 7px rgba(46,160,67,0)}100%{box-shadow:0 0 0 0 rgba(46,160,67,0)}}
    #octoview-overlay{position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;background:#0d1117}
    #octoview-overlay .ov-bar{display:flex;align-items:center;gap:12px;padding:8px 14px;
      background:#161b22;border-bottom:1px solid #30363d;
      font:600 13px -apple-system,BlinkMacSystemFont,sans-serif;color:#e6edf3}
    #octoview-overlay .ov-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #octoview-overlay .ov-close{background:transparent;border:1px solid #30363d;color:#c9d1d9;
      font:500 12px -apple-system,sans-serif;cursor:pointer;padding:4px 10px;border-radius:6px}
    #octoview-overlay .ov-close:hover{background:#30363d;color:#fff}
    #octoview-overlay .ov-body{flex:1;overflow:auto;position:relative}
    #octoview-overlay .ov-body>iframe{width:100%;height:100%;border:0;background:#fff}
    #octoview-overlay .ov-msg{padding:24px;color:#e6edf3;font:14px -apple-system,sans-serif}
    #octoview-overlay .ov-nb{max-width:980px;margin:0 auto;padding:24px 20px;color:#e6edf3}
    #octoview-overlay .ov-md :is(h1,h2,h3){border-bottom:1px solid #21262d;padding-bottom:.3em}
    #octoview-overlay .ov-md a{color:#4493f8}
    #octoview-overlay .ov-code{background:#161b22;border:1px solid #21262d;border-radius:6px;
      padding:12px 14px;overflow-x:auto;font:12.5px/1.5 ui-monospace,monospace;color:#e6edf3;margin:0 0 4px}
    #octoview-overlay .ov-nb-text{padding:4px 14px;margin:0 0 10px;overflow-x:auto;
      font:12.5px/1.5 ui-monospace,monospace;white-space:pre-wrap;color:#adbac7}
    #octoview-overlay .ov-nb-err{color:#ff7b72}
    #octoview-overlay .ov-nb-out{width:100%;height:520px;border:1px solid #21262d;border-radius:6px;background:#fff;margin:0 0 12px}
    #octoview-overlay .ov-nb-img{max-width:100%;background:#fff;border-radius:6px;margin:0 0 12px}`;
  document.head.appendChild(s);
}

function addButton() {
  ensureStyle();
  const btn = document.createElement('button');
  btn.id = BTN_ID;
  btn.textContent = 'Preview';
  btn.addEventListener('click', () => onPreview(btn));

  const rawAnchor = [...document.querySelectorAll('a[href*="/raw/"]')].find((a) =>
    a.href.startsWith('https://github.com/')
  );
  if (rawAnchor && rawAnchor.parentElement) {
    rawAnchor.parentElement.appendChild(btn);
  } else {
    btn.style.cssText = 'position:fixed;top:70px;right:20px;z-index:99999';
    document.body.appendChild(btn);
  }
}

function sync() {
  const show = O.shouldShow(location.pathname, fileName());
  const btn = document.getElementById(BTN_ID);
  if (show && !btn) addButton();
  else if (!show && btn) btn.remove();
}

// github.com is a SPA — re-sync on soft navigations, not just first load.
let queued = false;
function syncSoon() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    sync();
  });
}

sync();
document.addEventListener('turbo:load', sync);
document.addEventListener('soft-nav:end', sync);
new MutationObserver(syncSoon).observe(document.body, { childList: true, subtree: true });
