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
  // tokenized raw host). Prefer the real anchor (correct ref encoding); fall back
  // to transforming the current blob path. Never construct the raw host URL — it
  // would lack the token and 404 on private repos.
  const pickRawUrl = (doc, href) => {
    const gh = [...doc.querySelectorAll('a[href*="/raw/"]')].find((a) =>
      a.href.startsWith('https://github.com/')
    );
    return gh ? gh.href : href.replace('/blob/', '/raw/');
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
