// octoview — inject a Preview button on GitHub blob pages and open the viewer
// with the file's tokenized raw URL. Works for private repos, no OAuth/PAT:
// the raw URL GitHub gives a logged-in user already carries a signed token.
const BTN_ID = "octoview-btn";

// Scrape the raw URL at CLICK time — the token is short-lived, so never cache it.
function scrapeRawUrl() {
  // Layer 1: embedded React payload (present for smaller text files).
  const el = document.querySelector(
    'script[type="application/json"][data-target="react-app.embeddedData"]'
  );
  if (el) {
    try {
      const raw = JSON.parse(el.textContent)?.payload?.blob?.rawBlobUrl;
      if (raw) return new URL(raw, location.origin).href;
    } catch {
      /* fall through to the anchor */
    }
  }
  // Layer 2: the Raw anchor. Either a tokenized raw.githubusercontent.com URL,
  // or a /OWNER/REPO/raw/… github.com URL that 302s to the tokenized host.
  // Never construct from location.pathname — a constructed URL has no token.
  const a = document.querySelector(
    'a[data-testid="raw-button"], a[href*="raw.githubusercontent.com"], a[href*="/raw/"]'
  );
  return a ? a.href : null;
}

function addButton() {
  const btn = document.createElement("button");
  btn.id = BTN_ID;
  btn.textContent = "👁 Preview";
  // ponytail: fixed-position button — always visible, immune to header markup churn.
  btn.style.cssText =
    "position:fixed;top:64px;right:16px;z-index:99999;padding:6px 14px;" +
    "font:600 12px/1 -apple-system,BlinkMacSystemFont,sans-serif;color:#fff;" +
    "background:#8250df;border:0;border-radius:6px;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.3)";
  btn.addEventListener("click", () => {
    const src = scrapeRawUrl();
    if (!src) {
      btn.textContent = "⚠ no raw url";
      return;
    }
    const name = decodeURIComponent(location.pathname.split("/").pop() || "file");
    const url =
      browser.runtime.getURL("viewer.html") +
      "?src=" + encodeURIComponent(src) +
      "&name=" + encodeURIComponent(name);
    window.open(url, "_blank");
  });
  document.body.appendChild(btn);
}

function sync() {
  const isBlob = /^\/[^/]+\/[^/]+\/blob\//.test(location.pathname);
  const btn = document.getElementById(BTN_ID);
  if (isBlob && !btn) addButton();
  else if (!isBlob && btn) btn.remove();
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
document.addEventListener("turbo:load", sync);
document.addEventListener("soft-nav:end", sync);
new MutationObserver(syncSoon).observe(document.body, { childList: true, subtree: true });
