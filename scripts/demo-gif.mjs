// Record the real extension in action (load a GitHub blob page for a Gaussian
// splat, click Preview, orbit the render, play the opacity slider) and turn it
// into assets/demo.gif. Uses the built Chrome extension in a route-intercepted
// (hermetic) Chromium. Frames are captured with page.screenshot() rather than
// recordVideo, which drops WebGL canvas content unreliably.
//   npm run build:chrome && node scripts/demo-gif.mjs
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const EXT = join(ROOT, 'build', 'chrome');
const SAMPLE = 'capybara.ply';
const SIZE = '4.1 MB';
const W = 1120;
const H = 680;
const FPS = 15;

const blobPage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
  :root{color-scheme:dark}
  body{margin:0;background:#0d1117;color:#e6edf3;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  a{color:inherit;text-decoration:none}
  .hdr{display:flex;align-items:center;gap:12px;padding:12px 24px;background:#010409;border-bottom:1px solid #30363d}
  .hdr svg{fill:#e6edf3}
  .crumb{font-size:15px}.crumb b{font-weight:600}.crumb span{color:#8d96a0}
  main{max-width:1040px;margin:14px auto;padding:0 24px}
  .filebar{display:flex;align-items:center;gap:10px;margin-bottom:12px}
  .branch{display:inline-flex;align-items:center;gap:6px;background:#21262d;border:1px solid #30363d;border-radius:6px;padding:4px 12px;font-size:13px;font-weight:600}
  .path{font-size:14px}.path b{font-weight:600}.path span{color:#8d96a0}
  .box{border:1px solid #30363d;border-radius:8px;overflow:hidden}
  .toolbar{display:flex;align-items:center;justify-content:space-between;padding:8px 14px;background:#161b22;border-bottom:1px solid #30363d}
  .toolbar .meta{color:#8d96a0;font-size:12.5px}
  .seg{display:flex;list-style:none;margin:0;padding:0;border:1px solid #30363d;border-radius:6px;overflow:hidden}
  .seg li a{display:block;padding:3px 12px;font-size:12.5px;background:#21262d;border-left:1px solid #30363d;color:#e6edf3}
  .seg li:first-child a{border-left:0}
  .code{padding:14px 18px;font:12.5px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;color:#8d96a0;white-space:pre;overflow:hidden;max-height:480px}
</style></head><body>
<div class="hdr">
  <svg height="30" viewBox="0 0 16 16" width="30"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"></path></svg>
  <div class="crumb"><span>affromero</span> <span>/</span> <b>octoview</b></div>
</div>
<main>
  <div class="filebar"><span class="branch">&#8942;&#8942; main</span>
    <div class="path"><span>octoview / samples /</span> <b>${SAMPLE}</b></div></div>
  <div class="box">
    <div class="toolbar"><span class="meta">${SIZE}</span>
      <ul class="seg">
        <li><a href="https://github.com/affromero/octoview/raw/main/samples/${SAMPLE}">Raw</a></li>
        <li><a href="https://github.com/affromero/octoview/blame/main/samples/${SAMPLE}">Blame</a></li>
      </ul></div>
    <div data-testid="blob-viewer-file-content"><div class="code">${'0110 1101 0110 0011 raw Gaussian-splat bytes GitHub cannot render\n'.repeat(20)}</div></div>
  </div>
</main>
</body></html>`;

const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  viewport: { width: W, height: H },
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
const frames = await mkdtemp(join(tmpdir(), 'octoview-frames-'));
let fn = 0;
const snap = () => page.screenshot({ path: join(frames, String(fn++).padStart(4, '0') + '.png') });
const hold = async (n) => {
  for (let i = 0; i < n; i++) {
    await snap();
    await page.waitForTimeout(1000 / FPS);
  }
};

await page.goto(`https://github.com/affromero/octoview/blob/main/samples/${SAMPLE}`);
await page.locator('#octoview-btn').waitFor({ timeout: 10000 });
await hold(10); // raw code view
await page.locator('#octoview-btn').click();
await page
  .locator('#octoview-pane canvas')
  .first()
  .waitFor({ timeout: 20000 })
  .catch(() => {});
await page.waitForTimeout(1200);
await hold(8); // splat settled

// Orbit: drag across the render, capturing a frame each step.
const canvas = page.locator('#octoview-pane canvas').first();
const box = await canvas.boundingBox();
if (box) {
  const cy = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.32, cy);
  await page.mouse.down();
  for (let i = 0; i <= 26; i++) {
    await page.mouse.move(
      box.x + box.width * (0.32 + 0.42 * (i / 26)),
      cy - Math.sin((i / 26) * Math.PI) * 40
    );
    await snap();
  }
  await page.mouse.up();
}
await hold(4);

// Play with the Variance slider: collapse the oriented gaussians down to their
// full-intensity means (revealing the raw point cloud) and back to a solid
// surface — the most legible of the controls, and unmistakably different.
const variance = page
  .locator('#octoview-pane label.ov3d-slider', { hasText: 'Variance' })
  .locator('input[type="range"]');
const setVariance = (v) =>
  variance.evaluate((el, val) => {
    el.value = String(val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, v);
if (await variance.count()) {
  for (let v = 1; v >= 0; v -= 0.05) {
    await setVariance(v);
    await snap();
  }
  await hold(6);
  for (let v = 0; v <= 1; v += 0.05) {
    await setVariance(v);
    await snap();
  }
}
await hold(6);
await ctx.close();

const out = join(ROOT, 'assets', 'demo.gif');
execFileSync(
  'ffmpeg',
  [
    '-y',
    '-framerate',
    String(FPS),
    '-i',
    join(frames, '%04d.png'),
    '-vf',
    'scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=64[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3',
    '-loop',
    '0',
    out,
  ],
  { stdio: 'ignore' }
);
await rm(frames, { recursive: true, force: true });
const kb = Math.round(execFileSync('stat', ['-f%z', out]).toString().trim() / 1024);
console.log(`demo GIF: ${out} (${kb} KB)`);
