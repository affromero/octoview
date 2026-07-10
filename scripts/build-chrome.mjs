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
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { rasterizeIcons } from './icons.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'build', 'chrome');
const SIZES = [16, 32, 48, 128];

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await cp(join(ROOT, 'extension'), OUT, { recursive: true });
await rasterizeIcons(join(OUT, 'icons'), SIZES);

const manifest = JSON.parse(await readFile(join(OUT, 'manifest.json'), 'utf8'));
// Chrome refuses to load ANY extension whose extension_pages CSP contains
// 'unsafe-inline' (fine in Safari, for the report probe). So the Chrome pages CSP
// is the strict minimum. Splats render in the content script's isolated world
// (native WebGL2, no extension page needed), so no relaxation is required.
manifest.content_security_policy.extension_pages =
  "script-src 'self'; connect-src 'none'; object-src 'none'";
manifest.sandbox = { pages: ['viewer.html'] };
// The sandbox page hosts the report's own scripts; deny it network so a
// malicious report cannot beacon "user viewed file X" back out. 'unsafe-inline'
// is required for the inline capability probe (sandbox pages allow it).
manifest.content_security_policy.sandbox =
  "sandbox allow-scripts; script-src 'self' 'unsafe-inline'; connect-src 'none'; object-src 'none'";
// NOTE: use_dynamic_url would blunt install fingerprinting, but it breaks the
// content script's `import(getURL(...))` of the render modules (the fixed URL
// stops resolving once resources are served at a rotating URL). A Low-severity
// fingerprinting mitigation is not worth breaking module loading — left off.
manifest.icons = Object.fromEntries(SIZES.map((s) => [s, `icons/icon${s}.png`]));
await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

const zipPath = join(ROOT, 'build', 'octoview-chrome.zip');
await rm(zipPath, { force: true });
execFileSync('zip', ['-qr', zipPath, '.'], { cwd: OUT });
console.log(`built ${OUT} and ${zipPath}`);
