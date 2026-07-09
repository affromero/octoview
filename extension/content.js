// octoview — browser glue on top of core.js (loaded before this, exposes
// `octoview`). Injects the Preview button on GitHub blob pages, fetches the file
// with the page's cookies to resolve its tokenized raw URL, and hands that URL to
// the background, which opens the viewer tab. Rendering happens in that extension
// tab because it's the only context that can execute scripts: github.com's CSP is
// inherited by any in-page frame (srcdoc/blob/data), and its frame-src blocks
// embedding the extension page.
const O = octoview;
const BTN_ID = 'octoview-btn';

function fileName() {
  return decodeURIComponent(location.pathname.split('/').pop() || 'file');
}

function onPreview(btn) {
  btn.textContent = 'Loading…';
  // same-origin (not include): cookies ride the github.com leg; res.url is the
  // final tokenized raw.githubusercontent.com URL (needs no cookies afterwards).
  fetch(O.pickRawUrl(document, location.href), { credentials: 'same-origin' })
    .then((res) => {
      if (!res.ok) throw new Error('GitHub returned HTTP ' + res.status);
      return browser.runtime.sendMessage({ type: 'preview', src: res.url, name: fileName() });
    })
    .then(() => {
      btn.textContent = 'Preview';
    })
    .catch((e) => {
      btn.textContent = 'failed';
      console.error('[octoview]', e);
      setTimeout(() => (btn.textContent = 'Preview'), 2500);
    });
}

// GitHub-green primary styling + a soft pulse ring so it stands out among the
// header's monochrome buttons without reading as a bolted-on widget.
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
      70%{box-shadow:0 0 0 7px rgba(46,160,67,0)}100%{box-shadow:0 0 0 0 rgba(46,160,67,0)}}`;
  document.head.appendChild(s);
}

function addButton() {
  ensureStyle();
  const btn = document.createElement('button');
  btn.id = BTN_ID;
  btn.textContent = 'Preview';
  btn.addEventListener('click', () => onPreview(btn));

  // Place it as the leftmost item of GitHub's file-view segmented control
  // (Code | Blame, or Preview | Code | Blame for notebooks), so ours sits left of
  // Code and left of GitHub's own Preview when present.
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

  // Fallback: next to Raw, else fixed in a corner.
  const raw = [...document.querySelectorAll('a[href*="/raw/"]')].find((a) =>
    a.href.startsWith('https://github.com/')
  );
  if (raw && raw.parentElement) {
    raw.parentElement.appendChild(btn);
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
