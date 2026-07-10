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
    '.spz',
    '.ksplat',
    '.sog',
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

  // Plotly outputs carry their chart spec as a declarative MIME bundle — a plain
  // {data, layout} object, no script execution needed — so a vendored Plotly can
  // draw it live even where the report's own scripts are CSP-blocked.
  const PLOTLY_MIME = 'application/vnd.plotly.v1+json';

  // `htmlFrame(html)` returns an element that renders the given HTML (the content
  // script supplies a sandboxed iframe). `chart(spec)` (optional) returns an
  // element that renders a Plotly MIME bundle live. Injecting both keeps this
  // module browser-free and testable.
  function renderOutput(out, wrap, htmlFrame, chart) {
    const data = out.data || {};
    if (out.output_type === 'stream') {
      addText(wrap, joinLines(out.text));
    } else if (out.output_type === 'error') {
      // eslint-disable-next-line no-control-regex -- strip ANSI color codes from tracebacks
      addText(wrap, joinLines(out.traceback).replace(/\x1b\[[0-9;]*m/g, ''), true);
    } else if (chart && data[PLOTLY_MIME]) {
      // Before text/html: Plotly emits both, and the html variant needs scripts.
      wrap.appendChild(chart(data[PLOTLY_MIME]));
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
        // Strip whitespace (tab/newline/CR) before the scheme check: browsers
        // ignore it inside a URL, so `jav&#x09;ascript:` still executes otherwise.
        const stripped = attr.value.replace(/\s+/g, '');
        if (n.startsWith('on')) el.removeAttribute(attr.name);
        else if (/^(href|src|xlink:href)$/.test(n) && /^javascript:/i.test(stripped))
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

  // The notebook's kernel language (python for most ML notebooks), so code cells
  // highlight against the right grammar. hljs falls back to auto-detect if we
  // don't recognize it.
  function notebookLang(nb) {
    const m = nb.metadata || {};
    return (
      (m.language_info && m.language_info.name) || (m.kernelspec && m.kernelspec.language) || ''
    );
  }

  // Syntax-highlight a code cell like GitHub does, but keep it optional: hljs is
  // absent in the jsdom unit tests, so fall back to plain text there.
  function highlightInto(pre, src, lang) {
    if (!g.hljs) {
      pre.textContent = src;
      return;
    }
    try {
      pre.innerHTML = g.hljs.getLanguage(lang)
        ? g.hljs.highlight(src, { language: lang, ignoreIllegals: true }).value
        : g.hljs.highlightAuto(src).value;
    } catch {
      pre.textContent = src;
    }
  }

  function renderNotebook(nb, mount, htmlFrame, chart) {
    const wrap = document.createElement('div');
    wrap.className = 'ov-nb';
    const lang = notebookLang(nb);
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
        pre.className = 'ov-code hljs';
        highlightInto(pre, src, lang);
        wrap.appendChild(pre);
        for (const out of cell.outputs || []) renderOutput(out, wrap, htmlFrame, chart);
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
