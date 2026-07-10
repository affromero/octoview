// octoview core — the pure + DOM-building logic, kept free of browser.* and the
// network so it can be unit-tested in jsdom. Loaded as a classic script (content
// script AND the viewer page) where it attaches to `octoview`; imported directly
// by the test suite, which reads the same global.
(function (g) {
  const SUPPORTED = [
    '.html',
    '.htm',
    '.ipynb',
    '.glb',
    '.gltf',
    '.obj',
    '.ply',
    '.pcd',
    '.npy',
    '.npz',
    '.parquet',
    '.safetensors',
    '.gguf',
    '.exr',
    '.hdr',
    '.tif',
    '.tiff',
    '.splat',
    '.splattie',
  ];

  const extname = (name) => {
    const i = (name || '').lastIndexOf('.');
    return i < 0 ? '' : name.slice(i).toLowerCase();
  };
  const isSupported = (name) => SUPPORTED.includes(extname(name));

  // Show the Preview button only on a blob page for a supported file type.
  const shouldShow = (pathname, name) =>
    /^\/[^/]+\/[^/]+\/blob\//.test(pathname) && isSupported(name);

  // GitHub's "Raw" button is github.com/OWNER/REPO/raw/REF/PATH (302s to the
  // tokenized raw host with the page cookies). Match the anchor whose path maps to
  // the CURRENT blob (a page can contain unrelated raw links, e.g. in a rendered
  // README), else construct it from the blob path. github.com/.../raw/... needs no
  // token: it 302s to the tokenized host when the request carries the session.
  const pickRawUrl = (doc, href) => {
    const want = new URL(href, 'https://github.com').pathname.replace('/blob/', '/raw/');
    const anchors = [...doc.querySelectorAll('a[href*="/raw/"]')].filter((a) =>
      a.href.startsWith('https://github.com/')
    );
    const match = anchors.find((a) => new URL(a.href).pathname === want);
    return match ? match.href : 'https://github.com' + want;
  };

  const decode = (buf) => new TextDecoder().decode(buf);
  const joinLines = (v) => (Array.isArray(v) ? v.join('') : v || '');

  // `htmlFrame(html)` returns an element that renders the given HTML (the content
  // script supplies a sandboxed iframe). Injecting it keeps this module browser-free
  // and testable.
  function renderOutput(out, wrap, htmlFrame) {
    const data = out.data || {};
    if (out.output_type === 'stream') {
      addText(wrap, joinLines(out.text));
    } else if (out.output_type === 'error') {
      // eslint-disable-next-line no-control-regex -- strip ANSI color codes from tracebacks
      addText(wrap, joinLines(out.traceback).replace(/\x1b\[[0-9;]*m/g, ''), true);
    } else if (data['text/html']) {
      wrap.appendChild(htmlFrame(joinLines(data['text/html'])));
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

  // Strip active content from rendered markdown (a notebook is untrusted input):
  // drop script-ish elements, on* handlers, and javascript: URLs. github's CSP
  // also refuses inline handlers, but this keeps the module correct on its own.
  function sanitize(root) {
    root
      .querySelectorAll('script, iframe, object, embed, link, meta, base, form, style')
      .forEach((el) => el.remove());
    for (const el of root.querySelectorAll('*')) {
      for (const attr of [...el.attributes]) {
        const n = attr.name.toLowerCase();
        if (n.startsWith('on')) el.removeAttribute(attr.name);
        else if (/^(href|src|xlink:href)$/.test(n) && /^\s*javascript:/i.test(attr.value))
          el.removeAttribute(attr.name);
      }
    }
  }

  function addText(wrap, text, isErr) {
    const pre = document.createElement('pre');
    pre.className = 'ov-nb-text' + (isErr ? ' ov-nb-err' : '');
    pre.textContent = text;
    wrap.appendChild(pre);
  }

  function renderNotebook(nb, mount, htmlFrame) {
    const wrap = document.createElement('div');
    wrap.className = 'ov-nb';
    for (const cell of nb.cells || []) {
      const src = joinLines(cell.source);
      if (cell.cell_type === 'markdown') {
        const d = document.createElement('div');
        d.className = 'ov-md';
        d.innerHTML = g.marked.parse(src);
        sanitize(d);
        wrap.appendChild(d);
      } else if (cell.cell_type === 'code') {
        const pre = document.createElement('pre');
        pre.className = 'ov-code';
        pre.textContent = src;
        wrap.appendChild(pre);
        for (const out of cell.outputs || []) renderOutput(out, wrap, htmlFrame);
      }
    }
    mount.appendChild(wrap);
  }

  g.octoview = {
    SUPPORTED,
    extname,
    isSupported,
    shouldShow,
    pickRawUrl,
    decode,
    renderNotebook,
    renderOutput,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
