// End-to-end render check in real engines — Chromium AND WebKit (Safari's engine).
// octoview renders INLINE in the github blob page, so this serves a stand-in blob
// page (test/harness.html) under a github-like CSP and drives the same dispatch
// the content script uses. That is what catches Safari-specific breakage jsdom
// can't (see the CSP saga in git history): three.js WebGL in WebKit, and the fact
// that a sandboxed srcdoc report renders its STATIC HTML while its inline scripts
// are refused by the inherited CSP (a Safari platform limit we design around).
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

// A github-like CSP: 'self' scripts/modules load (the content-script equivalent),
// srcdoc frames render but their inline scripts are refused (no 'unsafe-inline'),
// which is exactly how github's inherited CSP treats our report/output frames.
const GITHUB_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src * data: blob:; frame-src 'self'; connect-src 'self'; font-src * data:";

const CASES = [
  {
    name: 'report.html',
    sample: 'samples/report.html',
    // 'not executed': the static-fallback state of the sample's script badge —
    // under the github-like CSP the report's inline script must NOT run.
    ok: (r) =>
      /Training report/.test(r.frameText) &&
      /Validation loss/.test(r.frameText) &&
      /not executed/.test(r.frameText),
  },
  {
    name: 'notebook.ipynb',
    sample: 'samples/notebook.ipynb',
    // plotlySvg: the Plotly MIME output rendered LIVE by the vendored bundle.
    ok: (r) => /Notebook sample/.test(r.text) && r.plotlySvg && r.hljs,
  },
  { name: 'cube.obj', sample: 'samples/cube.obj', ok: (r) => r.mainCanvas },
  { name: 'points.ply', sample: 'samples/points.ply', ok: (r) => r.mainCanvas },
  { name: 'cloud.pcd', sample: 'samples/cloud.pcd', ok: (r) => r.mainCanvas },
  { name: 'array.npy', sample: 'samples/array.npy', ok: (r) => r.mainCanvas },
  {
    name: 'array.npz',
    sample: 'samples/array.npz',
    ok: (r) => r.mainCanvas && /field|signal/.test(r.text),
  },
  {
    name: 'model.onnx',
    sample: 'samples/model.onnx',
    ok: (r) =>
      /tiny_classifier/.test(r.text) &&
      /6 ops/.test(r.text) &&
      /Softmax/.test(r.text) &&
      /conv.weight/.test(r.text),
  },
  {
    name: 'metrics.arrow',
    sample: 'samples/metrics.arrow',
    ok: (r) => /500 rows × 5 cols/.test(r.text) && /accuracy/.test(r.text),
  },
  {
    name: 'metrics.parquet',
    sample: 'samples/metrics.parquet',
    ok: (r) => /500 rows × 5 cols/.test(r.text) && /accuracy/.test(r.text),
  },
  {
    name: 'model.safetensors',
    sample: 'samples/model.safetensors',
    ok: (r) => /4 tensors/.test(r.text) && /embed_tokens/.test(r.text),
  },
  {
    name: 'model.gguf',
    sample: 'samples/model.gguf',
    ok: (r) => /GGUF v3/.test(r.text) && /llama/.test(r.text) && /token_embd/.test(r.text),
  },
  {
    name: 'depth.tiff',
    sample: 'samples/depth.tiff',
    ok: (r) => r.mainCanvas && /TIFF/.test(r.text),
  },
  {
    name: 'render.hdr',
    sample: 'samples/render.hdr',
    ok: (r) => r.mainCanvas && /Radiance HDR/.test(r.text),
  },
  {
    name: 'render.exr',
    sample: 'samples/render.exr',
    ok: (r) => r.mainCanvas && /EXR/.test(r.text),
  },
  {
    name: 'capybara.splat',
    sample: 'samples/capybara.splat',
    ok: (r) => r.mainCanvas && /splats/.test(r.text),
  },
  {
    name: 'capybara.ply',
    sample: 'samples/capybara.ply',
    ok: (r) => r.mainCanvas && /splats/.test(r.text),
  },
  {
    name: 'head.splattie',
    sample: 'samples/head.splattie',
    ok: (r) => r.mainCanvas && /splats/.test(r.text),
  },
  {
    name: 'capybara.spz',
    sample: 'samples/capybara.spz',
    ok: (r) => r.mainCanvas && /splats/.test(r.text),
  },
  {
    name: 'butterfly.spz',
    sample: 'samples/butterfly.spz',
    ok: (r) => r.mainCanvas && /splats/.test(r.text),
  },
  {
    name: 'capybara-v4.spz',
    sample: 'samples/capybara-v4.spz',
    ok: (r) => r.mainCanvas && /splats/.test(r.text),
  },
  {
    name: 'capybara.ksplat',
    sample: 'samples/capybara.ksplat',
    ok: (r) => r.mainCanvas && /splats/.test(r.text),
  },
  {
    // .sog additionally exercises the injected webp decode (createImageBitmap +
    // WebGL2 readback) in the real engines — the part jsdom cannot see.
    name: 'capybara.sog',
    sample: 'samples/capybara.sog',
    ok: (r) => r.mainCanvas && /splats/.test(r.text),
  },
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
    // Serve the stand-in blob page under github's CSP.
    await page.route('**/test/harness.html', async (route) => {
      const rr = await route.fetch();
      await route.fulfill({
        body: await rr.text(),
        contentType: 'text/html',
        headers: { 'content-security-policy': GITHUB_CSP },
      });
    });
    const url = `${base}/test/harness.html#sample=${encodeURIComponent(`${base}/${c.sample}`)}&name=${c.name}`;
    await page.goto(url, { waitUntil: 'load' });
    await page
      .waitForFunction(() => window.__ovReady || window.__ovError, { timeout: 8000 })
      .catch(() => {});
    await page.waitForTimeout(1500);
    const { text, mainCanvas, plotlySvg, hljs, err } = await page.evaluate(() => ({
      text: document.body.textContent,
      mainCanvas: !!document.querySelector('#mount canvas'),
      plotlySvg: !!document.querySelector('#mount .js-plotly-plot svg'),
      hljs: !!document.querySelector('#mount .ov-code [class^="hljs-"]'),
      err: window.__ovError || null,
    }));
    let frameText = '';
    for (const fr of page.frames()) {
      if (fr === page.mainFrame()) continue;
      try {
        frameText += await fr.evaluate(() => document.body.textContent);
      } catch {
        /* frame gone */
      }
    }
    const pass = !err && c.ok({ text, frameText, mainCanvas, plotlySvg, hljs });
    // Note: a refused srcdoc inline script is EXPECTED (the Safari static-render
    // path), so CSP-refusal console noise is informational, not a failure.
    console.log(`${pass ? '✓' : '✗'} [${label}] ${c.name}${err ? '  ERROR: ' + err : ''}`);
    if (!pass) failed++;
    await page.close();
  }
  await browser.close();
}
server.close();
console.log(failed ? `\n${failed} case(s) FAILED` : '\nall render cases passed ✓');
process.exit(failed ? 1 : 0);
