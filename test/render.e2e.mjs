// End-to-end render check in real engines — Chromium AND WebKit (Safari's engine).
// Serves the repo, loads the viewer page for each sample under the extension CSP,
// and asserts it renders without CSP/console errors. This is what catches Safari-
// specific breakage that jsdom can't (see the blob/CSP saga in git history).
//
//   npx playwright install chromium webkit   # once
//   npm run test:e2e
import pw from 'playwright';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const { chromium, webkit } = pw;
const ROOT = new URL('..', import.meta.url).pathname;
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.ipynb': 'application/json',
  '.css': 'text/css',
};

const server = http.createServer(async (req, res) => {
  try {
    const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    const body = await readFile(join(ROOT, rel));
    res.writeHead(200, { 'content-type': MIME[extname(rel)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
// Mirror manifest.json's CSPs faithfully, applied as real response headers so the
// sandbox page is exercised under its actual policy (the white-page bug hid here).
const EXT_CSP = `script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; connect-src 'self' ${base}; frame-src 'self'`;
const SANDBOX_CSP = `sandbox allow-scripts allow-popups allow-modals; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https: blob: data:; style-src 'unsafe-inline' https: data:; img-src * data: blob:; connect-src *`;

const CASES = [
  { sample: 'samples/report.html', name: 'report.html', ok: (r) => r.frameCanvas },
  { sample: 'samples/notes.md', name: 'notes.md', ok: (r) => /Markdown sample/.test(r.text) },
  {
    sample: 'samples/notebook.ipynb',
    name: 'notebook.ipynb',
    ok: (r) => /Notebook sample/.test(r.text),
  },
  { sample: 'samples/cube.obj', name: 'cube.obj', ok: (r) => r.mainCanvas },
  { sample: 'samples/points.ply', name: 'points.ply', ok: (r) => r.mainCanvas },
  { sample: 'samples/cloud.pcd', name: 'cloud.pcd', ok: (r) => r.mainCanvas },
];

let failed = 0;
for (const [label, engine] of [
  ['chromium', chromium],
  ['webkit', webkit],
]) {
  const browser = await engine.launch(
    engine === chromium
      ? { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }
      : {}
  );
  for (const c of CASES) {
    const page = await browser.newPage();
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/viewer.html', async (route) => {
      const rr = await route.fetch();
      await route.fulfill({
        body: await rr.text(),
        contentType: 'text/html',
        headers: { 'content-security-policy': EXT_CSP },
      });
    });
    await page.route('**/sandbox/report.html', async (route) => {
      const rr = await route.fetch();
      await route.fulfill({
        body: await rr.text(),
        contentType: 'text/html',
        headers: { 'content-security-policy': SANDBOX_CSP },
      });
    });
    const url = `${base}/extension/viewer.html#src=${encodeURIComponent(`${base}/${c.sample}`)}&name=${c.name}`;
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(3000);
    const { text, mainCanvas } = await page.evaluate(() => ({
      text: document.body.textContent,
      mainCanvas: !!document.querySelector('canvas'),
    }));
    let frameCanvas = false;
    for (const fr of page.frames()) {
      if (fr === page.mainFrame()) continue;
      try {
        frameCanvas ||= await fr.evaluate(() => !!document.querySelector('canvas'));
      } catch {
        /* frame gone */
      }
    }
    const cspErr = errors.some((e) => /csp|refused|policy/i.test(e));
    const pass = c.ok({ text, frameCanvas, mainCanvas }) && !cspErr;
    console.log(
      `${pass ? '✓' : '✗'} [${label}] ${c.name}${errors.length ? '  ' + errors.slice(0, 2).join(' | ') : ''}`
    );
    if (!pass) failed++;
    await page.close();
  }
  await browser.close();
}
server.close();
console.log(failed ? `\n${failed} case(s) FAILED` : '\nall render cases passed ✓');
process.exit(failed ? 1 : 0);
