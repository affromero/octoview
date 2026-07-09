import { describe, it, expect, beforeAll } from 'vitest';
import '../extension/core.js';

const O = globalThis.octoview;
const enc = (s) => new TextEncoder().encode(s).buffer;
const ESC = String.fromCharCode(27); // ANSI escape
// Stand-in for the viewer's sandbox iframe: records the HTML it was handed.
const stubFrame = (html) => {
  const d = document.createElement('div');
  d.className = 'stub-html';
  d.dataset.html = html;
  return d;
};

beforeAll(() => {
  globalThis.marked = { parse: (s) => `<p>${s}</p>` };
});

describe('extname', () => {
  it('returns the lowercased extension with the dot', () => {
    expect(O.extname('report.HTML')).toBe('.html');
    expect(O.extname('a.b.ipynb')).toBe('.ipynb');
  });
  it('returns empty string when there is no extension', () => {
    expect(O.extname('README')).toBe('');
    expect(O.extname('')).toBe('');
  });
});

describe('shouldShow', () => {
  it('shows on a blob page for a supported, case-insensitive extension', () => {
    expect(O.shouldShow('/o/r/blob/main/report.HTML', 'report.HTML')).toBe(true);
    expect(O.shouldShow('/o/r/blob/main/nb.ipynb', 'nb.ipynb')).toBe(true);
    expect(O.shouldShow('/o/r/blob/main/mesh.glb', 'mesh.glb')).toBe(true);
    expect(O.shouldShow('/o/r/blob/main/cloud.pcd', 'cloud.pcd')).toBe(true);
    expect(O.shouldShow('/o/r/blob/main/model.ply', 'model.ply')).toBe(true);
  });
  it('hides for unsupported files and non-blob pages', () => {
    expect(O.shouldShow('/o/r/blob/main/train.py', 'train.py')).toBe(false);
    expect(O.shouldShow('/o/r/blob/main/notes.md', 'notes.md')).toBe(false); // GitHub renders markdown
    expect(O.shouldShow('/o/r/blob/main/data.parquet', 'data.parquet')).toBe(false); // not shipped yet
    expect(O.shouldShow('/o/r/tree/main', 'main')).toBe(false);
  });
});

describe('pickRawUrl', () => {
  it('prefers the github.com /raw/ anchor (which carries the token)', () => {
    const doc = document.createElement('div');
    doc.innerHTML =
      '<a href="https://raw.githubusercontent.com/o/r/main/f.html">raw host</a>' +
      '<a href="https://github.com/o/r/raw/main/f.html">Raw</a>';
    expect(O.pickRawUrl(doc, 'https://github.com/o/r/blob/main/f.html')).toBe(
      'https://github.com/o/r/raw/main/f.html'
    );
  });
  it('falls back to transforming the blob path when no anchor is present', () => {
    const doc = document.createElement('div');
    expect(O.pickRawUrl(doc, 'https://github.com/o/r/blob/dev/x/notes.md')).toBe(
      'https://github.com/o/r/raw/dev/x/notes.md'
    );
  });
});

describe('renderNotebook', () => {
  it('renders markdown, code, and text/image/html outputs', () => {
    const mount = document.createElement('div');
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
    O.renderNotebook(nb, mount, stubFrame);
    expect(mount.querySelector('.ov-nb .ov-md').innerHTML).toContain('# Title');
    expect(mount.querySelector('.ov-code').textContent).toBe('print(1)');
    expect(mount.querySelector('.ov-nb-text').textContent).toBe('1\n');
    // interactive html output is routed to the sandbox-frame factory
    expect(mount.querySelector('.stub-html').dataset.html).toContain('id="plot"');
    expect(mount.querySelector('img.ov-nb-img').src).toBe('data:image/png;base64,AAAA');
  });

  it('strips ANSI codes from error tracebacks', () => {
    const mount = document.createElement('div');
    const nb = {
      cells: [
        {
          cell_type: 'code',
          source: [''],
          outputs: [{ output_type: 'error', traceback: [`${ESC}[31mBoom${ESC}[0m`] }],
        },
      ],
    };
    O.renderNotebook(nb, mount, stubFrame);
    expect(mount.querySelector('.ov-nb-text.ov-nb-err').textContent).toBe('Boom');
  });
});

describe('decode', () => {
  it('decodes a UTF-8 ArrayBuffer to text', () => {
    expect(O.decode(enc('héllo'))).toBe('héllo');
  });
});
