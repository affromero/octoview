// Build the Firefox (AMO) variant into build/firefox (+ zip). Same shape as
// build-chrome.mjs — extension/ stays the Safari source of truth — with the
// Gecko differences:
//   - same strict pages CSP (Firefox MV3 also rejects 'unsafe-inline' and
//     blob:), but NO manifest sandbox key: Firefox doesn't support it, so the
//     viewer's capability probe fails and live HTML reports fall back to the
//     static sandboxed frame — the same graceful path Safari ships when the
//     relaxed CSP is refused.
//   - browser_specific_settings.gecko: id and data_collection_permissions are
//     mandatory for AMO submissions.
// ponytail: verification is `npx web-ext lint` (the linter AMO itself runs),
// not a browser e2e — Playwright can't install Firefox extensions; wire
// selenium-webdriver + geckodriver installAddon() if runtime coverage matters.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { rasterizeIcons } from './icons.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'build', 'firefox');
const SIZES = [16, 32, 48, 128];

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await cp(join(ROOT, 'extension'), OUT, { recursive: true });
await rasterizeIcons(join(OUT, 'icons'), SIZES);

// Spark can never run in Firefox — blob: workers in extension pages are
// CSP-blocked with no exemption (Bugzilla 1294996, WONTFIX) — so its two
// bundles are dead weight that also trip addons-linter's 5MB FILE_TOO_LARGE
// error. Strip them; the viewer pages stay, their import fails instantly, and
// the error relay drops splats to the main-thread renderer.
const SPARK_ONLY_VENDOR = ['vendor/spark.esm.js', 'vendor/splattie-widget.esm.js'];
for (const f of SPARK_ONLY_VENDOR) await rm(join(OUT, f));

const manifest = JSON.parse(await readFile(join(OUT, 'manifest.json'), 'utf8'));
manifest.web_accessible_resources[0].resources =
  manifest.web_accessible_resources[0].resources.filter((r) => !SPARK_ONLY_VENDOR.includes(r));
manifest.content_security_policy.extension_pages =
  "script-src 'self' 'wasm-unsafe-eval'; object-src 'none'";
manifest.browser_specific_settings = {
  gecko: {
    id: 'octoview@afromero.co',
    strict_min_version: '109.0',
    data_collection_permissions: { required: ['none'] },
  },
};
manifest.icons = Object.fromEntries(SIZES.map((s) => [s, `icons/icon${s}.png`]));
await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

const zipPath = join(ROOT, 'build', 'octoview-firefox.zip');
await rm(zipPath, { force: true });
execFileSync('zip', ['-qr', zipPath, '.'], { cwd: OUT });
console.log(`built ${OUT} and ${zipPath}`);
