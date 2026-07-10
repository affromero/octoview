// octoview — inline preview on GitHub blob pages. Everything renders IN the blob
// view (no new tab): the content script fetches the file with the page's cookies
// and renders it in a pane that replaces the code, with Preview toggling back to
// the code. Rendering runs in the content script's isolated world, which is not
// bound by github.com's CSP for our own code (three.js, DOM building). HTML
// reports render in a sandboxed frame, which inherits github's CSP, so their own
// inline scripts do not run in Safari (a platform limit) but self-contained
// static HTML shows. core.js (loaded before) exposes `octoview`; marked is loaded
// alongside for notebook markdown.
// Safari and Firefox define `browser`; Chrome only `chrome` (same MV3 API).
globalThis.browser ??= globalThis.chrome;
const O = octoview;
const BTN_ID = 'octoview-btn';
const PANE_ID = 'octoview-pane';
const THREE_EXTS = ['.glb', '.gltf', '.obj', '.ply', '.pcd'];
const ARRAY_EXTS = ['.npy', '.npz'];
const TABLE_EXTS = ['.parquet', '.arrow', '.feather', '.ipc'];
const MODEL_EXTS = ['.safetensors', '.gguf'];
const IMAGE_EXTS = ['.exr', '.hdr', '.tif', '.tiff'];
const SPLAT_EXTS = ['.splat', '.splattie', '.spz', '.ksplat', '.sog'];
const MAX_PREVIEW_BYTES = 64 * 1024 * 1024;
const MAX_MODEL_BYTES = 32 * 1024 * 1024;

// Cheap header sniff: a 3DGS .ply carries gaussian props; a plain .ply does not.
// Lets us route .ply to the splat vs the mesh/point-cloud renderer without
// loading either module first.
function isPlySplatHead(buf) {
  const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(16384, buf.byteLength)));
  // Compressed (PlayCanvas/SuperSplat) or standard-float 3DGS ply, vs a mesh/point cloud.
  return (
    /property\s+\S+\s+packed_position\b/.test(head) ||
    (/property\s+\S+\s+f_dc_0\b/.test(head) &&
      /property\s+\S+\s+scale_0\b/.test(head) &&
      /property\s+\S+\s+rot_0\b/.test(head))
  );
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
let previewController = null;
function closePane(btn) {
  previewController?.abort();
  previewController = null;
  document.getElementById(PANE_ID)?.remove();
  if (hidden) {
    hidden.style.display = '';
    hidden = null;
  }
  if (btn) btn.classList.remove('active');
}

async function onPreview(btn) {
  if (document.getElementById(PANE_ID)) return closePane(btn);
  if (previewController) return;
  const label = btn.textContent;
  btn.textContent = 'Loading…';
  btn.disabled = true;
  const controller = new AbortController();
  previewController = controller;
  try {
    // Model files keep their structure at the front, so range-fetch the first 32MB
    // instead of pulling a multi-GB weights file down whole.
    const headers = MODEL_EXTS.includes(extOf()) ? { Range: 'bytes=0-33554431' } : undefined;
    const res = await fetch(O.pickRawUrl(document, location.href), {
      credentials: 'same-origin',
      headers,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error('GitHub returned HTTP ' + res.status);
    openPane(
      btn,
      await readPreviewBody(res, MODEL_EXTS.includes(extOf()) ? MAX_MODEL_BYTES : MAX_PREVIEW_BYTES)
    );
  } catch (e) {
    if (e.name === 'AbortError') return;
    console.error('[octoview]', e);
    btn.textContent = 'failed';
    setTimeout(() => (btn.textContent = label), 2500);
    return;
  } finally {
    if (previewController === controller) previewController = null;
    btn.disabled = false;
  }
  btn.textContent = label;
}

// Read incrementally so an arbitrary GitHub raw asset never becomes an
// unbounded ArrayBuffer. The final buffer is deliberately capped before it is
// handed to renderers, which may allocate decoded representations of it.
async function readPreviewBody(res, maxBytes) {
  const length = Number(res.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxBytes)
    throw new Error(
      `file is ${formatBytes(length)}; previews are limited to ${formatBytes(maxBytes)}`
    );

  const reader = res.body?.getReader();
  if (!reader) {
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes)
      throw new Error(`file is larger than the ${formatBytes(maxBytes)} preview limit`);
    return buf;
  }

  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.byteLength > maxBytes) {
        await reader.cancel();
        throw new Error(`file is larger than the ${formatBytes(maxBytes)} preview limit`);
      }
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

function formatBytes(bytes) {
  return Math.round(bytes / (1024 * 1024)) + ' MiB';
}

function openPane(btn, buf) {
  ensureStyle();
  const pane = document.createElement('div');
  pane.id = PANE_ID;

  // Always-visible bar with a way back to the code, since the preview replaces it.
  const bar = document.createElement('div');
  bar.className = 'ov-bar';
  const back = document.createElement('button');
  back.className = 'ov-back';
  back.textContent = '◀ Back to code';
  back.onclick = () => closePane(btn);
  const name = document.createElement('span');
  name.className = 'ov-bar-name';
  name.textContent = fileName();
  bar.append(back, name);
  const body = document.createElement('div');
  body.className = 'ov-pane-body';
  pane.append(bar, body);

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
  render(body, buf, extOf()).catch((e) => msg(body, "Couldn't render: " + e.message));
}

async function render(pane, buf, ext) {
  // Critical dimensions are set inline (CSSOM), not only via the stylesheet, in
  // case github's CSP blocks our injected <style>; the canvas/frame still fills.
  if (ext === '.html' || ext === '.htm') {
    pane.classList.add('ov-fill');
    pane.style.height = '78vh';
    pane.appendChild(reportFrame(O.decode(buf)));
  } else if (ext === '.ipynb') {
    pane.classList.add('ov-scroll');
    pane.style.maxHeight = '82vh';
    pane.style.overflow = 'auto';
    O.renderNotebook(
      JSON.parse(O.decode(buf)),
      pane,
      (html) => sandboxFrame(html, 'ov-nb-out'),
      plotlyChart
    );
  } else if (THREE_EXTS.includes(ext) || SPLAT_EXTS.includes(ext)) {
    pane.classList.add('ov-fill');
    pane.style.height = '78vh';
    if (SPLAT_EXTS.includes(ext) || (ext === '.ply' && isPlySplatHead(buf))) {
      pane.appendChild(await splatFrame(buf, ext));
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
  } else if (ext === '.onnx') {
    pane.classList.add('ov-scroll');
    pane.style.maxHeight = '82vh';
    pane.style.overflow = 'auto';
    const { renderOnnx } = await loadModule('render-onnx.js');
    renderOnnx(buf, pane);
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

// A Plotly MIME bundle renders LIVE: the vendored Plotly runs as our own code in
// the isolated world (github's CSP does not bind it — same trick as three.js), so
// the interactive chart GitHub strips works here without executing any notebook
// script. The div returns synchronously; the lazy bundle fills it when loaded.
function plotlyChart(spec) {
  const div = document.createElement('div');
  div.className = 'ov-nb-plotly';
  // Plotly renders nothing into a zero-height box; honor the spec's height.
  div.style.height = ((spec.layout && spec.layout.height) || 420) + 'px';
  const L = spec.layout || {};
  loadModule('vendor/plotly.esm.js')
    .then(({ default: Plotly }) => {
      // Autosize to fill the pane width, and theme to match the dark notebook
      // instead of Plotly's default white box.
      const layout = {
        ...L,
        autosize: true,
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        font: { color: '#adbac7', ...(L.font || {}) },
        margin: { t: 32, r: 20, b: 44, l: 56, ...(L.margin || {}) },
        xaxis: { gridcolor: '#21262d', zerolinecolor: '#30363d', ...(L.xaxis || {}) },
        yaxis: { gridcolor: '#21262d', zerolinecolor: '#30363d', ...(L.yaxis || {}) },
        legend: { font: { color: '#adbac7' }, ...(L.legend || {}) },
      };
      delete layout.width;
      delete layout.height;
      return Plotly.newPlot(div, spec.data || [], layout, {
        responsive: true,
        displaylogo: false,
      });
    })
    .catch((e) => msg(div, "Couldn't render chart: " + e.message));
  return div;
}

// Live report path: host the report inside the extension's own viewer page —
// the one context whose CSP octoview controls. The viewer nests the report in a
// sandboxed srcdoc frame that inherits the viewer's relaxed CSP, so the report's
// own scripts EXECUTE, in an opaque origin (no browser.* APIs, no
// extension-permission fetch, no github cookies — the trust level of today's
// static frame, plus script execution). The viewer's inline handshake is the
// capability probe: if Safari refuses 'unsafe-inline' for extension pages, or
// github's CSP blocks the extension iframe, no ready beacon arrives and the
// static sandboxFrame swaps in. Verified manually in Safari; the e2e harness can
// only exercise the fallback (it has no extension origin).
function reportFrame(html) {
  const viewerUrl = browser.runtime.getURL('viewer.html');
  const f = document.createElement('iframe');
  f.className = 'ov-frame';
  f.src = viewerUrl;
  const fallback = setTimeout(swap, 800);
  function swap() {
    removeEventListener('message', onReady);
    f.replaceWith(sandboxFrame(html, 'ov-frame'));
  }
  function onReady(e) {
    if (e.source !== f.contentWindow || !e.data || e.data.type !== 'ov-live-ready') return;
    clearTimeout(fallback);
    removeEventListener('message', onReady);
    // targetOrigin '*', not the extension origin: in the Chrome build
    // viewer.html is a manifest sandbox page, whose origin is opaque ("null"),
    // so a targeted post would be silently dropped. Safe — the message goes
    // only to our own just-created frame, which holds no secrets and verifies
    // the sender's origin itself.
    e.source.postMessage({ type: 'ov-report', html }, '*');
  }
  addEventListener('message', onReady);
  return f;
}

// Render a splat inside an extension viewer page (embedded inline as an iframe,
// the one context whose CSP allows Spark's worker + WASM): a static splat goes to
// the Spark viewer; a rigged .splattie goes to the interactive splattie-widget
// viewer. If the frame is blocked or the viewer cannot start (no beacon / error /
// timeout), every splat format falls back to the main-thread renderer —
// splat-decode.js covers .splat, 3DGS .ply, .splattie, .spz, .ksplat and .sog.

async function splatFrame(buf, ext) {
  const splattie = ext === '.splattie';
  const bytes = buf;
  const fileName = splattie ? 'file.splattie' : 'splat' + ext;
  const viewerUrl = browser.runtime.getURL(splattie ? 'splattie-viewer.html' : 'splat-viewer.html');
  const f = document.createElement('iframe');
  f.className = 'ov-frame';
  let settled = false;
  let sparkError = null;
  const timer = setTimeout(() => {
    console.warn('[octoview] Spark viewer frame did not respond in 12s (blocked or slow)');
    fallback();
  }, 12000);
  function fallback() {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    removeEventListener('message', onMsg);
    const mount = document.createElement('div');
    mount.className = 'ov-fill';
    mount.style.height = '78vh';
    f.replaceWith(mount);
    if (sparkError)
      console.warn(
        '[octoview] Spark viewer failed (' + sparkError + '), using main-thread renderer'
      );
    loadModule('render-splat.js').then(({ renderSplat }) => renderSplat(buf, mount, ext));
  }
  function onMsg(e) {
    if (e.source !== f.contentWindow || !e.data) return;
    if (e.data.type === 'ov-splat-ready') {
      f.contentWindow.postMessage({ type: 'ov-splat', bytes, fileName }, new URL(viewerUrl).origin);
    } else if (e.data.type === 'ov-splat-ok') {
      settled = true;
      clearTimeout(timer);
      removeEventListener('message', onMsg);
    } else if (e.data.type === 'ov-splat-error') {
      sparkError = e.data.error;
      console.warn('[octoview] Spark path failed, falling back:', e.data.error);
      fallback();
    }
  }
  addEventListener('message', onMsg);
  f.src = viewerUrl;
  return f;
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
    #${BTN_ID}.ov-btn-bar{align-self:center;vertical-align:middle;margin:0 8px 0 0}
    @keyframes octoview-pulse{0%{box-shadow:0 0 0 0 rgba(46,160,67,.5)}
      70%{box-shadow:0 0 0 6px rgba(46,160,67,0)}100%{box-shadow:0 0 0 0 rgba(46,160,67,0)}}
    #${PANE_ID}{border:1px solid #30363d;border-radius:6px;overflow:hidden;background:#0d1117;
      color:#e6edf3;font:14px/1.55 -apple-system,BlinkMacSystemFont,sans-serif;margin:0 0 16px;
      display:flex;flex-direction:column}
    #${PANE_ID} .ov-pane-body.ov-fill{height:78vh}
    #${PANE_ID} .ov-pane-body.ov-scroll{max-height:82vh;overflow:auto}
    #${PANE_ID}.ov-float{position:fixed;inset:52px 12px 12px;z-index:99998}
    #${PANE_ID} .ov-frame{width:100%;height:100%;border:0;background:#fff}
    #${PANE_ID} .ov-msg{padding:24px}
    #${PANE_ID} .ov-nb{max-width:980px;margin:0 auto;padding:24px 20px}
    #${PANE_ID} .ov-md :is(h1,h2,h3){border-bottom:1px solid #21262d;padding-bottom:.3em}
    #${PANE_ID} .ov-md a{color:#4493f8}
    #${PANE_ID} .ov-code{background:#161b22;border:1px solid #30363d;border-radius:6px;
      padding:12px 14px;overflow-x:auto;font:12.5px/1.5 ui-monospace,monospace;color:#e6edf3;margin:0 0 4px}
    /* highlight.js github-dark theme, scoped to the notebook code cells. */
    #${PANE_ID} .hljs-doctag,#${PANE_ID} .hljs-keyword,#${PANE_ID} .hljs-meta .hljs-keyword,#${PANE_ID} .hljs-template-tag,#${PANE_ID} .hljs-template-variable,#${PANE_ID} .hljs-type,#${PANE_ID} .hljs-variable.language_{color:#ff7b72}
    #${PANE_ID} .hljs-title,#${PANE_ID} .hljs-title.class_,#${PANE_ID} .hljs-title.function_{color:#d2a8ff}
    #${PANE_ID} .hljs-attr,#${PANE_ID} .hljs-attribute,#${PANE_ID} .hljs-literal,#${PANE_ID} .hljs-meta,#${PANE_ID} .hljs-number,#${PANE_ID} .hljs-operator,#${PANE_ID} .hljs-selector-attr,#${PANE_ID} .hljs-selector-class,#${PANE_ID} .hljs-selector-id,#${PANE_ID} .hljs-variable{color:#79c0ff}
    #${PANE_ID} .hljs-string,#${PANE_ID} .hljs-regexp,#${PANE_ID} .hljs-meta .hljs-string{color:#a5d6ff}
    #${PANE_ID} .hljs-built_in,#${PANE_ID} .hljs-symbol{color:#ffa657}
    #${PANE_ID} .hljs-comment,#${PANE_ID} .hljs-code,#${PANE_ID} .hljs-formula{color:#8b949e}
    #${PANE_ID} .hljs-name,#${PANE_ID} .hljs-quote,#${PANE_ID} .hljs-selector-tag,#${PANE_ID} .hljs-selector-pseudo{color:#7ee787}
    #${PANE_ID} .hljs-subst{color:#c9d1d9}
    #${PANE_ID} .hljs-bullet{color:#f2cc60}
    #${PANE_ID} .hljs-emphasis{font-style:italic}
    #${PANE_ID} .hljs-strong{font-weight:bold}
    #${PANE_ID} .ov-nb-text{padding:4px 14px;margin:0 0 10px;overflow-x:auto;
      font:12.5px/1.5 ui-monospace,monospace;white-space:pre-wrap;color:#adbac7}
    #${PANE_ID} .ov-nb-err{color:#ff7b72}
    #${PANE_ID} .ov-nb-out{width:100%;height:360px;border:1px solid #30363d;border-radius:6px;background:#fff;margin:0 0 12px}
    #${PANE_ID} .ov-nb-plotly{width:100%;border:1px solid #21262d;border-radius:6px;background:#0d1117;margin:0 0 12px;overflow:hidden}
    #${PANE_ID} .ov-bar{flex:0 0 auto;display:flex;align-items:center;gap:10px;
      padding:8px 14px;background:#161b22;border-bottom:1px solid #30363d}
    #${PANE_ID} .ov-pane-body{min-height:0}
    #${PANE_ID} .ov-back{font:500 12px/1 -apple-system,sans-serif;padding:5px 12px;color:#c9d1d9;
      background:#21262d;border:1px solid #30363d;border-radius:6px;cursor:pointer}
    #${PANE_ID} .ov-back:hover{background:#30363d;color:#fff}
    #${PANE_ID} .ov-bar-name{font:12px ui-monospace,monospace;color:#7d8590;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
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

  // GitHub renders the Code | Blame toggle as a Primer SegmentedControl whose
  // per-segment classes are hashed and change between releases, so we don't try
  // to become a segment (that mismatch is what looked "off"). Instead we drop the
  // button in as a plain sibling immediately to the LEFT of the whole control, in
  // the same flex row — .ov-btn-bar aligns it to the toggle's height.
  const blame = [...document.querySelectorAll('a[href*="/blame/"]')].find((a) =>
    a.href.startsWith('https://github.com/')
  );
  const seg = blame && blame.closest('ul, nav, [role="tablist"], [role="list"]');
  if (seg && seg.parentElement) {
    btn.classList.add('ov-btn-bar');
    seg.parentElement.insertBefore(btn, seg);
    return;
  }
  // Fallback: sit beside the Raw/edit action group on the right of the header.
  const raw = [...document.querySelectorAll('a[href*="/raw/"]')].find((a) =>
    a.href.startsWith('https://github.com/')
  );
  if (raw && raw.parentElement) {
    btn.classList.add('ov-btn-bar');
    raw.parentElement.insertBefore(btn, raw.parentElement.firstElementChild);
  } else {
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
