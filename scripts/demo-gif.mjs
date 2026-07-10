// Record the real extension in action (load a GitHub blob page for a Gaussian
// splat, click Preview, orbit the 3D render) and turn it into assets/demo.gif.
// Uses the built Chrome extension in a route-intercepted (hermetic) Chromium,
// then ffmpeg for a palette-optimized GIF.
//   npm run build:chrome && node scripts/demo-gif.mjs
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const EXT = join(ROOT, 'build', 'chrome');
const SAMPLE = 'capybara.splat';
const W = 1200;
const H = 720;

const blobPage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
  :root{color-scheme:dark}
  body{margin:0;background:#0d1117;color:#e6edf3;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  a{color:inherit;text-decoration:none}
  .hdr{display:flex;align-items:center;gap:12px;padding:12px 24px;background:#010409;border-bottom:1px solid #30363d}
  .hdr svg{fill:#e6edf3}
  .crumb{font-size:15px}.crumb b{font-weight:600}.crumb span{color:#8d96a0}
  main{max-width:1120px;margin:14px auto;padding:0 24px}
  .filebar{display:flex;align-items:center;gap:10px;margin-bottom:12px}
  .branch{display:inline-flex;align-items:center;gap:6px;background:#21262d;border:1px solid #30363d;border-radius:6px;padding:4px 12px;font-size:13px;font-weight:600}
  .path{font-size:14px}.path b{font-weight:600}.path span{color:#8d96a0}
  .box{border:1px solid #30363d;border-radius:8px;overflow:hidden}
  .toolbar{display:flex;align-items:center;justify-content:space-between;padding:8px 14px;background:#161b22;border-bottom:1px solid #30363d}
  .toolbar .meta{color:#8d96a0;font-size:12.5px}
  .seg{display:flex;list-style:none;margin:0;padding:0;border:1px solid #30363d;border-radius:6px;overflow:hidden}
  .seg li a{display:block;padding:3px 12px;font-size:12.5px;background:#21262d;border-left:1px solid #30363d;color:#e6edf3}
  .seg li:first-child a{border-left:0}
  .code{padding:14px 18px;font:12.5px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;color:#8d96a0;white-space:pre;overflow:hidden;max-height:520px}
</style></head><body>
<div class="hdr">
  <svg height="30" viewBox="0 0 16 16" width="30"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"></path></svg>
  <div class="crumb"><span>affromero</span> <span>/</span> <b>octoview</b></div>
</div>
<main>
  <div class="filebar"><span class="branch">&#8942;&#8942; main</span>
    <div class="path"><span>octoview / samples /</span> <b>${SAMPLE}</b></div></div>
  <div class="box">
    <div class="toolbar"><span class="meta">2.8 MB</span>
      <ul class="seg">
        <li><a href="https://github.com/affromero/octoview/raw/main/samples/${SAMPLE}">Raw</a></li>
        <li><a href="https://github.com/affromero/octoview/blame/main/samples/${SAMPLE}">Blame</a></li>
      </ul></div>
    <div data-testid="blob-viewer-file-content"><div class="code">${'0110 1101 0110 0011 raw Gaussian-splat bytes GitHub cannot render\n'.repeat(22)}</div></div>
  </div>
</main>
</body></html>`;

const videoDir = await mkdtemp(join(tmpdir(), 'octoview-demo-'));
const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  viewport: { width: W, height: H },
  recordVideo: { dir: videoDir, size: { width: W, height: H } },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
await ctx.route('https://github.com/**', async (route) => {
  const { pathname } = new URL(route.request().url());
  if (pathname.includes('/raw/'))
    return route.fulfill({
      body: await readFile(join(ROOT, 'samples', pathname.split('/').pop())),
      contentType: 'application/octet-stream',
    });
  return route.fulfill({ body: blobPage, contentType: 'text/html' });
});

const page = await ctx.newPage();
await page.goto(`https://github.com/affromero/octoview/blob/main/samples/${SAMPLE}`);
await page.locator('#octoview-btn').waitFor({ timeout: 10000 });
await page.waitForTimeout(1300); // show the raw code view first
await page.locator('#octoview-btn').click();
await page
  .locator('#octoview-pane canvas')
  .first()
  .waitFor({ timeout: 20000 })
  .catch(() => {});
await page.waitForTimeout(2200); // let the splat settle

// Orbit: drag across the render to spin the model.
const canvas = page.locator('#octoview-pane canvas').first();
const box = await canvas.boundingBox();
if (box) {
  const cy = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.32, cy);
  await page.mouse.down();
  for (let i = 0; i <= 40; i++) {
    await page.mouse.move(
      box.x + box.width * (0.32 + 0.42 * (i / 40)),
      cy - Math.sin((i / 40) * Math.PI) * 40
    );
    await page.waitForTimeout(28);
  }
  await page.mouse.up();
}
await page.waitForTimeout(900);
await ctx.close();

// webm -> optimized GIF
const webm = join(
  videoDir,
  (await readdir(videoDir)).find((f) => f.endsWith('.webm'))
);
const out = join(ROOT, 'assets', 'demo.gif');
execFileSync(
  'ffmpeg',
  [
    '-y',
    '-i',
    webm,
    '-vf',
    'fps=16,scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer',
    '-loop',
    '0',
    out,
  ],
  { stdio: 'ignore' }
);
await rm(videoDir, { recursive: true, force: true });
const size = execFileSync('du', ['-h', out]).toString().split('\t')[0];
console.log(`demo GIF: ${out} (${size})`);
