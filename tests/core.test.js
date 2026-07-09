import { describe, it, expect, beforeAll } from 'vitest';
import '../extension/core.js';

const O = globalThis.octoview;
const enc = (s) => new TextEncoder().encode(s).buffer;

// core.js renders markdown via a global `marked`; stub it so we test our own
// dispatch/wrapping, not the third-party parser.
beforeAll(() => {
  globalThis.marked = { parse: (s) => `<p>${s}</p>` };
});

describe('extname', () => {
  it('returns the lowercased extension with the dot', () => {
    expect(O.extname('h1.SPLATTIE')).toBe('.splattie');
    expect(O.extname('a.b.spz')).toBe('.spz');
  });
  it('returns empty string when there is no extension', () => {
    expect(O.extname('README')).toBe('');
    expect(O.extname('')).toBe('');
  });
});

describe('shouldShow', () => {
  it('shows on a blob page for a supported, case-insensitive extension', () => {
    expect(O.shouldShow('/o/r/blob/main/report.HTML', 'report.HTML')).toBe(true);
    expect(O.shouldShow('/o/r/blob/main/a/b/h1.ply', 'h1.ply')).toBe(true);
  });
  it('hides for unsupported files and non-blob pages', () => {
    expect(O.shouldShow('/o/r/blob/main/train.py', 'train.py')).toBe(false);
    expect(O.shouldShow('/o/r/tree/main', 'main')).toBe(false);
    expect(O.shouldShow('/o/r/blob/main/data.csv', 'data.csv')).toBe(false);
  });
});

describe('pickRawUrl', () => {
  it('prefers the github.com /raw/ anchor (which carries the token)', () => {
    const doc = document.createElement('div');
    doc.innerHTML =
      '<a href="https://raw.githubusercontent.com/o/r/main/f.ply">raw host</a>' +
      '<a href="https://github.com/o/r/raw/main/f.ply">Raw</a>';
    expect(O.pickRawUrl(doc, 'https://github.com/o/r/blob/main/f.ply')).toBe(
      'https://github.com/o/r/raw/main/f.ply'
    );
  });
  it('falls back to transforming the blob path when no anchor is present', () => {
    const doc = document.createElement('div');
    expect(O.pickRawUrl(doc, 'https://github.com/o/r/blob/dev/x/f.spz')).toBe(
      'https://github.com/o/r/raw/dev/x/f.spz'
    );
  });
});

describe('toBase64', () => {
  it('base64-encodes the bytes', () => {
    expect(O.toBase64(new Uint8Array([72, 105]).buffer)).toBe('SGk='); // "Hi"
  });
});

describe('splatDoc', () => {
  it('inlines the widget + data and points the widget at a blob#.ext', () => {
    const doc = O.splatDoc('WIDGET', 'QUJD', '.ply');
    expect(doc).toContain('WIDGET');
    expect(doc).toContain('atob("QUJD")');
    expect(doc).toContain('"#.ply"');
    expect(doc).toContain('createElement("splattie-widget")');
  });
  it('escapes a </script> inside the widget so it cannot close our tag', () => {
    const doc = O.splatDoc('STUB</script>MORE', 'QQ==', '.spz');
    expect(doc).toContain('STUB<\\/script>MORE');
    expect(doc).not.toContain('STUB</script>MORE');
  });
});

describe('dispatchPreview', () => {
  it('renders HTML into a sandboxed srcdoc iframe', () => {
    const body = document.createElement('div');
    O.dispatchPreview({ body, name: 'r.html', buf: enc('<h1>hi</h1>') });
    const f = body.querySelector('iframe');
    expect(f).toBeTruthy();
    expect(f.getAttribute('sandbox')).toBe('allow-scripts');
    expect(f.srcdoc).toBe('<h1>hi</h1>');
  });

  it('renders a splat by inlining the widget and the file bytes', () => {
    const body = document.createElement('div');
    const buf = new Uint8Array([1, 2, 3]).buffer;
    O.dispatchPreview({ body, name: 'h1.ply', buf, widget: 'WIDGET_STUB' });
    const f = body.querySelector('iframe');
    expect(f.getAttribute('sandbox')).toBe('allow-scripts');
    expect(f.srcdoc).toContain('WIDGET_STUB');
    expect(f.srcdoc).toContain(O.toBase64(buf));
    expect(f.srcdoc).toContain('"#.ply"');
  });

  it('renders a notebook: markdown, code, interactive + image outputs', () => {
    const body = document.createElement('div');
    const nb = {
      cells: [
        { cell_type: 'markdown', source: ['# Title'] },
        {
          cell_type: 'code',
          source: ['print(1)'],
          outputs: [
            { output_type: 'stream', text: ['1\n'] },
            { output_type: 'display_data', data: { 'text/html': ['<div id="plot"></div>'] } },
            { output_type: 'display_data', data: { 'image/png': 'AAAA' } },
          ],
        },
      ],
    };
    O.dispatchPreview({ body, name: 'n.ipynb', buf: enc(JSON.stringify(nb)) });
    expect(body.querySelector('.ov-nb')).toBeTruthy();
    expect(body.querySelector('.ov-md').innerHTML).toContain('# Title');
    expect(body.querySelector('.ov-code').textContent).toBe('print(1)');
    const out = body.querySelector('iframe.ov-nb-out');
    expect(out.getAttribute('sandbox')).toBe('allow-scripts');
    expect(out.srcdoc).toContain('id="plot"');
    expect(body.querySelector('img.ov-nb-img').src).toBe('data:image/png;base64,AAAA');
  });

  it('renders markdown into a .ov-md block', () => {
    const body = document.createElement('div');
    O.dispatchPreview({ body, name: 'notes.md', buf: enc('# Heading') });
    expect(body.querySelector('.ov-nb .ov-md').innerHTML).toContain('# Heading');
  });

  it('shows a friendly message for an unsupported type', () => {
    const body = document.createElement('div');
    O.dispatchPreview({ body, name: 'weights.safetensors', buf: enc('x') });
    expect(body.querySelector('.ov-msg').textContent).toContain('No preview for .safetensors');
  });

  it('shows the fetch error when one is passed', () => {
    const body = document.createElement('div');
    O.dispatchPreview({ body, name: 'r.html', error: 'HTTP 404' });
    expect(body.querySelector('.ov-msg').textContent).toBe("Couldn't load: HTTP 404");
  });
});
