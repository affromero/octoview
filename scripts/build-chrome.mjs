// Build the Chrome variant of the extension into build/chrome (+ Web Store zip).
// extension/ stays the Safari source of truth; this script copies it and patches
// the manifest for Chrome's stricter MV3 rules:
//   - extension_pages CSP must not contain 'unsafe-inline' (Chrome rejects the
//     whole extension otherwise; Safari needs it for the live-report path).
//   - viewer.html becomes a manifest sandbox page instead: Chrome's sandbox CSP
//     allows inline scripts, so the capability probe fires and live HTML
//     reports work — the same design, granted by a different mechanism.
//   - the Web Store requires PNG icons, rendered here from assets/logo.svg
//     with the repo's Playwright Chromium.
import { chromium } from 'playwright';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'build', 'chrome');
const SIZES = [16, 32, 48, 128];

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await cp(join(ROOT, 'extension'), OUT, { recursive: true });

// Icons: rasterize the SVG logo at each size.
const svg = await readFile(join(ROOT, 'assets', 'logo.svg'), 'utf8');
await mkdir(join(OUT, 'icons'), { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of SIZES) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>*{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`
  );
  await writeFile(
    join(OUT, 'icons', `icon${size}.png`),
    await page.screenshot({ omitBackground: true })
  );
}
await browser.close();

const manifest = JSON.parse(await readFile(join(OUT, 'manifest.json'), 'utf8'));
// Chrome refuses to load ANY extension whose extension_pages CSP contains
// 'unsafe-inline' or blob: (both fine in Safari, where blob: carries Spark's
// worker). So the Chrome pages CSP is the strict minimum; Spark's blob worker
// then CSP-fails in the viewer page and splats take the main-thread fallback
// renderer, which test/chrome.e2e.mjs verifies.
manifest.content_security_policy.extension_pages =
  "script-src 'self' 'wasm-unsafe-eval'; object-src 'none'";
manifest.sandbox = { pages: ['viewer.html'] };
manifest.icons = Object.fromEntries(SIZES.map((s) => [s, `icons/icon${s}.png`]));
await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

const zipPath = join(ROOT, 'build', 'octoview-chrome.zip');
await rm(zipPath, { force: true });
execFileSync('zip', ['-qr', zipPath, '.'], { cwd: OUT });
console.log(`built ${OUT} and ${zipPath}`);
