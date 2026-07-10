// Build the Firefox (AMO) variant into build/firefox (+ zip). Same shape as
// build-chrome.mjs — extension/ stays the Safari source of truth — with the
// Gecko differences:
//   - strict pages CSP (Firefox MV3 rejects 'unsafe-inline'), and NO manifest
//     sandbox key: Firefox doesn't support it, so the viewer's capability probe
//     fails and live HTML reports fall back to the static sandboxed frame — the
//     same graceful path Safari ships when the relaxed CSP is refused. Splats
//     render identically to every browser: the native WebGL2 renderer runs in
//     the content script's isolated world, bound by no extension-page CSP.
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

const manifest = JSON.parse(await readFile(join(OUT, 'manifest.json'), 'utf8'));
manifest.content_security_policy.extension_pages =
  "script-src 'self'; connect-src 'none'; object-src 'none'";
// NOTE: use_dynamic_url is intentionally NOT set — it breaks the content
// script's dynamic import() of render modules via getURL (see build-chrome.mjs).
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
