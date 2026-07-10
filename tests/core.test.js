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
    expect(O.shouldShow('/o/r/blob/main/emb.npy', 'emb.npy')).toBe(true);
    expect(O.shouldShow('/o/r/blob/main/data.parquet', 'data.parquet')).toBe(true);
    expect(O.shouldShow('/o/r/blob/main/meta.lcc', 'meta.lcc')).toBe(true);
    expect(O.shouldShow('/o/r/blob/main/scene.rad', 'scene.rad')).toBe(true);
  });
  it('hides for unsupported files and non-blob pages', () => {
    expect(O.shouldShow('/o/r/blob/main/train.py', 'train.py')).toBe(false);
    expect(O.shouldShow('/o/r/blob/main/notes.md', 'notes.md')).toBe(false); // GitHub renders markdown
    expect(O.shouldShow('/o/r/blob/main/data.csv', 'data.csv')).toBe(false); // GitHub renders CSV
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
  it('ignores an unrelated raw link and picks the one for the current blob', () => {
    const doc = document.createElement('div');
    doc.innerHTML =
      '<a href="https://github.com/o/r/raw/main/OTHER.html">stray</a>' +
      '<a href="https://github.com/o/r/raw/main/f.html">Raw</a>';
    expect(O.pickRawUrl(doc, 'https://github.com/o/r/blob/main/f.html')).toBe(
      'https://github.com/o/r/raw/main/f.html'
    );
  });
  it('constructs the raw path when only unrelated raw links exist', () => {
    const doc = document.createElement('div');
    doc.innerHTML = '<a href="https://github.com/o/r/raw/main/OTHER.html">stray</a>';
    expect(O.pickRawUrl(doc, 'https://github.com/o/r/blob/main/f.html')).toBe(
      'https://github.com/o/r/raw/main/f.html'
    );
  });
});

describe('Git LFS download URLs', () => {
  const blobUrl = 'https://github.com/o/r/blob/main/assets/model.obj';
  const rawUrl = 'https://github.com/o/r/raw/main/assets/model.obj';

  it('uses the matching GitHub media link from the blob page', () => {
    const doc = document.createElement('div');
    doc.innerHTML =
      '<a href="https://media.githubusercontent.com/media/o/r/main/assets/other.obj">Other</a>' +
      '<a href="https://media.githubusercontent.com/media/o/r/main/assets/model.obj?token=signed">Download</a>';
    expect(O.lfsDownloadUrl(doc, rawUrl)).toBe(
      'https://media.githubusercontent.com/media/o/r/main/assets/model.obj?token=signed'
    );
  });

  it("uses GitHub's public media URL when the matching link is absent", () => {
    const doc = document.createElement('div');
    doc.innerHTML = '<a href="https://example.com/media/o/r/main/assets/model.obj">External</a>';
    expect(O.lfsDownloadUrl(doc, rawUrl)).toBe(
      'https://media.githubusercontent.com/media/o/r/main/assets/model.obj'
    );
    expect(O.lfsDownloadUrl(doc, blobUrl)).toBeNull();
  });

  it('parses only complete Git LFS pointer files', () => {
    const oid = 'a'.repeat(64);
    expect(
      O.lfsPointer(enc(`version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize 123\n`))
    ).toEqual({ oid, size: '123' });
    expect(O.lfsPointer(enc(`version https://git-lfs.github.com/spec/v1\nsize 123\n`))).toBeNull();
    expect(O.lfsPointer(enc('not an LFS pointer'))).toBeNull();
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

  it('routes a Plotly MIME bundle to the chart hook, over its text/html sibling', () => {
    const mount = document.createElement('div');
    const spec = { data: [{ type: 'bar', y: [1, 2] }], layout: { height: 320 } };
    const nb = {
      cells: [
        {
          cell_type: 'code',
          source: ['fig.show()'],
          outputs: [
            {
              output_type: 'display_data',
              data: {
                'application/vnd.plotly.v1+json': spec,
                'text/html': ['<div>needs scripts</div>'],
              },
            },
          ],
        },
      ],
    };
    const seen = [];
    const chart = (s) => {
      seen.push(s);
      const d = document.createElement('div');
      d.className = 'stub-chart';
      return d;
    };
    O.renderNotebook(nb, mount, stubFrame, chart);
    expect(seen).toEqual([spec]); // the live chart wins over the script-needing html
    expect(mount.querySelector('.stub-chart')).not.toBeNull();
    expect(mount.querySelector('.stub-html')).toBeNull();
  });

  it('falls back to the text/html frame when no chart hook is supplied', () => {
    const mount = document.createElement('div');
    const nb = {
      cells: [
        {
          cell_type: 'code',
          source: [''],
          outputs: [
            {
              output_type: 'display_data',
              data: {
                'application/vnd.plotly.v1+json': { data: [] },
                'text/html': ['<div id="plot"></div>'],
              },
            },
          ],
        },
      ],
    };
    O.renderNotebook(nb, mount, stubFrame);
    expect(mount.querySelector('.stub-html').dataset.html).toContain('id="plot"');
  });

  it('sanitizes active content from untrusted notebook markdown', () => {
    const mount = document.createElement('div');
    const nb = {
      cells: [
        {
          cell_type: 'markdown',
          source: [
            '<a id="lnk" href="jav&#x09;ascript:alert(1)">x</a><img id="im" src="x" onerror="alert(1)">',
          ],
        },
      ],
    };
    O.renderNotebook(nb, mount, stubFrame);
    expect(mount.querySelector('#lnk').getAttribute('href')).toBeNull();
    expect(mount.querySelector('#im').getAttribute('onerror')).toBeNull();
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
