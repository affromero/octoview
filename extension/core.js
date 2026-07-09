// octoview core — the pure + DOM-building logic, kept free of browser.* and the
// network so it can be unit-tested in jsdom. Loaded as a classic content script
// (before content.js) where it attaches to `octoview`; imported directly by the
// test suite, which reads the same global. content.js supplies the browser glue
// (fetch, runtime.getURL, button wiring).
(function (g) {
  const SUPPORTED = ['.html', '.htm', '.md', '.splattie', '.ply', '.spz', '.splat', '.ipynb'];
  const SPLAT = ['.splattie', '.ply', '.spz', '.splat'];

  const extname = (name) => {
    const i = (name || '').lastIndexOf('.');
    return i < 0 ? '' : name.slice(i).toLowerCase();
  };
  const isSupported = (name) => SUPPORTED.includes(extname(name));

  // Show the Preview button only on a blob page for a supported file type.
  const shouldShow = (pathname, name) =>
    /^\/[^/]+\/[^/]+\/blob\//.test(pathname) && isSupported(name);

  // GitHub's "Raw" button is github.com/OWNER/REPO/raw/REF/PATH (302s to the
  // tokenized raw host). Prefer the real anchor (correct ref encoding); fall back
  // to transforming the current blob path. Never construct the raw host URL — it
  // would lack the token and 404 on private repos.
  const pickRawUrl = (doc, href) => {
    const gh = [...doc.querySelectorAll('a[href*="/raw/"]')].find((a) =>
      a.href.startsWith('https://github.com/')
    );
    return gh ? gh.href : href.replace('/blob/', '/raw/');
  };

  const toBase64 = (buf) => {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  };

  // Self-contained document for the sandboxed frame: the widget bundle, then the
  // splat bytes (base64) as a blob the widget loads. The widget sniffs format from
  // the "#.ext" suffix, mirroring its own internal convention.
  const splatDoc = (widget, b64, ext) =>
    '<!doctype html><meta charset="utf-8"><style>' +
    'html,body{margin:0;height:100%;background:#0d1117;overflow:hidden}' +
    'splattie-widget{display:block;width:100vw;height:100vh}' +
    '#err{color:#e6edf3;font:14px -apple-system;padding:20px}</style><body>' +
    '<script>' +
    widget.replace(/<\/(script)/gi, '<\\/$1') +
    '</scr' +
    'ipt><script>try{' +
    'var b=atob("' +
    b64 +
    '"),a=new Uint8Array(b.length),i=0;' +
    'for(;i<b.length;i++)a[i]=b.charCodeAt(i);' +
    'var u=URL.createObjectURL(new Blob([a]))+"#' +
    ext +
    '";' +
    'var el=document.createElement("splattie-widget");el.setAttribute("src",u);' +
    'document.body.appendChild(el);}catch(e){' +
    "document.body.innerHTML='<div id=err>Splat failed: '+e.message+'</div>';}" +
    '</scr' +
    'ipt></body>';

  const sandboxed = () => {
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts'); // opaque origin: content can't reach the host page
    return f;
  };

  const showMsg = (body, text) => {
    const p = document.createElement('p');
    p.className = 'ov-msg';
    p.textContent = text;
    body.appendChild(p);
  };

  const decode = (buf) => new TextDecoder().decode(buf);
  const joinLines = (v) => (Array.isArray(v) ? v.join('') : v || '');

  function renderOutput(out, wrap) {
    const data = out.data || {};
    if (out.output_type === 'stream') {
      addText(wrap, joinLines(out.text));
    } else if (out.output_type === 'error') {
      // eslint-disable-next-line no-control-regex -- strip ANSI color codes from tracebacks
      addText(wrap, joinLines(out.traceback).replace(/\x1b\[[0-9;]*m/g, ''), true);
    } else if (data['text/html']) {
      const f = sandboxed(); // interactive output (plotly/bokeh) runs in the frame
      f.className = 'ov-nb-out';
      f.srcdoc = joinLines(data['text/html']);
      wrap.appendChild(f);
    } else if (data['image/png'] || data['image/jpeg']) {
      const png = data['image/png'];
      const img = document.createElement('img');
      img.className = 'ov-nb-img';
      img.src =
        'data:image/' + (png ? 'png' : 'jpeg') + ';base64,' + joinLines(png || data['image/jpeg']);
      wrap.appendChild(img);
    } else if (data['text/plain']) {
      addText(wrap, joinLines(data['text/plain']));
    }
  }

  function addText(wrap, text, isErr) {
    const pre = document.createElement('pre');
    pre.className = 'ov-nb-text' + (isErr ? ' ov-nb-err' : '');
    pre.textContent = text;
    wrap.appendChild(pre);
  }

  function renderMarkdown(text, body) {
    const wrap = document.createElement('div');
    wrap.className = 'ov-nb';
    const d = document.createElement('div');
    d.className = 'ov-md';
    d.innerHTML = g.marked.parse(text);
    wrap.appendChild(d);
    body.appendChild(wrap);
  }

  function renderNotebook(nb, body) {
    const wrap = document.createElement('div');
    wrap.className = 'ov-nb';
    for (const cell of nb.cells || []) {
      const src = joinLines(cell.source);
      if (cell.cell_type === 'markdown') {
        const d = document.createElement('div');
        d.className = 'ov-md';
        d.innerHTML = g.marked.parse(src);
        wrap.appendChild(d);
      } else if (cell.cell_type === 'code') {
        const pre = document.createElement('pre');
        pre.className = 'ov-code';
        pre.textContent = src;
        wrap.appendChild(pre);
        for (const out of cell.outputs || []) renderOutput(out, wrap);
      }
    }
    body.appendChild(wrap);
  }

  // Render the fetched file into `body` by type. `widget` is the splat bundle text
  // (only needed for splat types); passing it in keeps this network-free.
  function dispatchPreview({ body, name, buf, widget, error }) {
    const ext = extname(name);
    if (error) return showMsg(body, "Couldn't load: " + error);
    if (ext === '.html' || ext === '.htm') {
      const f = sandboxed();
      f.srcdoc = decode(buf);
      body.appendChild(f);
    } else if (ext === '.md') {
      renderMarkdown(decode(buf), body);
    } else if (SPLAT.includes(ext)) {
      const f = sandboxed();
      f.srcdoc = splatDoc(widget, toBase64(buf), ext);
      body.appendChild(f);
    } else if (ext === '.ipynb') {
      renderNotebook(JSON.parse(decode(buf)), body);
    } else {
      showMsg(body, 'No preview for ' + ext + ' yet.');
    }
  }

  g.octoview = {
    SUPPORTED,
    SPLAT,
    extname,
    isSupported,
    shouldShow,
    pickRawUrl,
    toBase64,
    splatDoc,
    sandboxed,
    showMsg,
    renderMarkdown,
    renderNotebook,
    renderOutput,
    dispatchPreview,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
