// Store screenshots: load build/chrome into Chromium, open showcase samples on
// a GitHub-styled stand-in blob page (route-intercepted, hermetic), click
// Preview, and capture the rendered pane. Two sizes per sample:
//   1280x800  (Chrome Web Store)   build/screenshots/<name>.png
//   2560x1600 (Mac App Store, @2x) build/screenshots/<name>@2x.png
//
//   npm run build:chrome && node scripts/screenshots.mjs
import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const EXT = join(ROOT, 'build', 'chrome');
const OUT = join(ROOT, 'build', 'screenshots');

// A GitHub-dark blob page faithful enough for store shots: header, repo nav,
// file breadcrumb, and the Code/Blame segmented control the Preview button
// joins. content.js needs: a /raw/ anchor, a /blame/ anchor in a UL, and the
// blob-viewer content region the pane replaces.
const blobPage = (file, size) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<style>
  :root{color-scheme:dark}
  body{margin:0;background:#0d1117;color:#e6edf3;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  a{color:inherit;text-decoration:none}
  .hdr{display:flex;align-items:center;gap:12px;padding:14px 24px;background:#010409;border-bottom:1px solid #30363d}
  .hdr svg{fill:#e6edf3}
  .crumb{font-size:15px}.crumb b{font-weight:600}.crumb span{color:#8d96a0}
  .tabs{display:flex;gap:6px;padding:0 24px;background:#010409;border-bottom:1px solid #30363d}
  .tabs a{padding:8px 12px 10px;font-size:14px;color:#e6edf3;border-bottom:2px solid transparent}
  .tabs a.sel{border-color:#f78166;font-weight:600}
  .tabs a small{background:#30363d;border-radius:10px;padding:1px 7px;margin-left:5px;font-size:11px;color:#8d96a0}
  main{max-width:1180px;margin:16px auto;padding:0 24px}
  .filebar{display:flex;align-items:center;gap:10px;margin-bottom:12px}
  .branch{display:inline-flex;align-items:center;gap:6px;background:#21262d;border:1px solid #30363d;border-radius:6px;padding:4px 12px;font-size:13px;font-weight:600}
  .path{font-size:14px}.path b{font-weight:600}.path span{color:#8d96a0}
  .box{border:1px solid #30363d;border-radius:8px;overflow:hidden}
  .toolbar{display:flex;align-items:center;justify-content:space-between;padding:8px 14px;background:#161b22;border-bottom:1px solid #30363d}
  .toolbar .meta{color:#8d96a0;font-size:12.5px}
  .seg{display:flex;list-style:none;margin:0;padding:0;border:1px solid #30363d;border-radius:6px;overflow:hidden}
  .seg li a,.seg li button{display:block;padding:3px 12px;font-size:12.5px;background:#21262d;border:0;border-left:1px solid #30363d;color:#e6edf3}
  .seg li:first-child a,.seg li:first-child button{border-left:0}
  .code{padding:14px 18px;font:12.5px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;color:#8d96a0;white-space:pre;overflow:hidden;max-height:560px}
</style></head><body>
<div class="hdr">
  <svg height="30" viewBox="0 0 16 16" width="30"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"></path></svg>
  <div class="crumb"><span>affromero</span> <span>/</span> <b>octoview</b></div>
</div>
<div class="tabs">
  <a class="sel" href="#">&lt;&gt; Code</a><a href="#">Issues <small>2</small></a><a href="#">Pull requests <small>1</small></a><a href="#">Actions</a><a href="#">Settings</a>
</div>
<main>
  <div class="filebar">
    <span class="branch">&#8942;&#8942; main</span>
    <div class="path"><span>octoview / samples /</span> <b>${file}</b></div>
  </div>
  <div class="box">
    <div class="toolbar">
      <span class="meta">${size}</span>
      <ul class="seg">
        <li><a href="https://github.com/affromero/octoview/raw/main/samples/${file}">Raw</a></li>
        <li><a href="https://github.com/affromero/octoview/blame/main/samples/${file}">Blame</a></li>
      </ul>
    </div>
    <div data-testid="blob-viewer-file-content"><div class="code">${'0110 1101 0110 0011 raw bytes github cannot render\n'.repeat(24)}</div></div>
  </div>
</main>
</body></html>`;

const canvasIn = (page) =>
  page
    .locator('#octoview-pane canvas')
    .first()
    .isVisible()
    .catch(() => false);
const frameText = async (page, text) => {
  for (const f of page.frames()) {
    if (
      await f
        .locator(`text=${text}`)
        .first()
        .isVisible()
        .catch(() => false)
    )
      return true;
  }
  return false;
};

// name, on-disk sample, human size label, readiness check, settle ms (renderers
// that animate in — splats, 3D — get extra time so the shot isn't mid-draw).
const SHOTS = [
  ['report', 'report.html', '4.1 KB', (p) => frameText(p, 'LIVE'), 1200],
  ['splat', 'capybara.ply', '4.1 MB', canvasIn, 3500],
  ['points', 'scan.ply', '4.6 MB', canvasIn, 2500],
  [
    'notebook',
    'notebook.ipynb',
    '18.4 KB',
    (p) =>
      p
        .locator('#octoview-pane .js-plotly-plot, #octoview-pane svg')
        .first()
        .isVisible()
        .catch(() => false),
    1500,
  ],
  ['table', 'metrics.parquet', '24.9 KB', (p) => frameText(p, 'accuracy'), 800],
];

// The repo's 3D samples are minimal e2e fixtures (8-point cubes) — too sparse
// for a store shot. Generate a dense colored point cloud (torus knot) instead;
// it exists only in memory, served by the route below as scan.ply.
const scanPly = (() => {
  const N = 160000;
  const rows = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2 * 3;
    // p=2,q=3 torus knot centerline, points scattered in a tube around it
    const r = 2 + Math.cos(3 * t);
    const cx = r * Math.cos(2 * t);
    const cy = r * Math.sin(2 * t);
    const cz = Math.sin(3 * t);
    const a = ((i * 137) % 360) / 57.29578;
    const b = ((i * 61) % 360) / 57.29578;
    const rad = 0.35 * Math.sqrt(((i * 89) % 1000) / 1000);
    const x = cx + rad * Math.cos(a) * Math.cos(b);
    const y = cy + rad * Math.sin(a);
    const z = cz + rad * Math.cos(a) * Math.sin(b);
    const hue = (t / (Math.PI * 6)) * 360;
    const f = (n) => {
      const k = (n + hue / 30) % 12;
      return Math.round(255 * (0.62 - 0.42 * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    rows.push(`${x.toFixed(4)} ${y.toFixed(4)} ${z.toFixed(4)} ${f(0)} ${f(8)} ${f(4)}`);
  }
  return Buffer.from(
    `ply\nformat ascii 1.0\nelement vertex ${N}\nproperty float x\nproperty float y\nproperty float z\n` +
      `property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n` +
      rows.join('\n') +
      '\n'
  );
})();

await mkdir(OUT, { recursive: true });
for (const dsf of [1, 2]) {
  const ctx = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: dsf,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  await ctx.route('https://github.com/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.includes('/raw/')) {
      const name = pathname.split('/').pop();
      return route.fulfill({
        body: name === 'scan.ply' ? scanPly : await readFile(join(ROOT, 'samples', name)),
        contentType: 'application/octet-stream',
      });
    }
    const file = pathname.split('/').pop();
    const size = SHOTS.find((s) => s[1] === file)?.[2] ?? '';
    return route.fulfill({
      body: blobPage(file, size),
      contentType: 'text/html',
      headers: {
        'content-security-policy':
          "default-src 'none'; script-src github.githubassets.com; style-src 'unsafe-inline'; " +
          "img-src * data: blob:; frame-src 'self' chrome-extension:; connect-src *",
      },
    });
  });

  for (const [name, file, , ready, settle] of SHOTS) {
    const page = await ctx.newPage();
    await page.goto(`https://github.com/affromero/octoview/blob/main/samples/${file}`);
    await page.locator('#octoview-btn').click({ timeout: 10000 });
    const deadline = Date.now() + 30000;
    let ok = false;
    while (!ok && Date.now() < deadline) {
      ok = await ready(page);
      if (!ok) await page.waitForTimeout(400);
    }
    await page.waitForTimeout(settle);
    const path = join(OUT, `${name}${dsf === 2 ? '@2x' : ''}.png`);
    await page.screenshot({ path });
    console.log(`${ok ? '✓' : '✗ (timed out, shot anyway)'} ${path}`);
    await page.close();
  }
  await ctx.close();
}
console.log('screenshots in build/screenshots/');
