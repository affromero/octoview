// Build the source package AMO requires for an add-on that ships minified
// vendored libraries. It contains exactly the tracked source needed to
// reproduce build/firefox (per store/REVIEWERS.md) — no build output, no
// node_modules, no LFS sample fixtures — plus the reviewer instructions.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, cpSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'build', 'octoview-amo-source.zip');

// The files a reviewer needs to run `npm ci && ./scripts/vendor.sh &&
// npm run build:firefox`. Deliberately excludes samples/ (huge LFS test
// fixtures, irrelevant to the build), test/, tests/, build/, node_modules/,
// Safari/, .git/, and the store/ listing copy except REVIEWERS.md.
const INCLUDE = [
  'extension',
  'scripts/vendor.sh',
  'scripts/build-firefox.mjs',
  'scripts/build-chrome.mjs',
  'scripts/icons.mjs',
  'assets/logo.svg',
  'package.json',
  'package-lock.json',
  'eslint.config.mjs',
  'LICENSE',
  'README.md',
  'SECURITY.md',
  'store/REVIEWERS.md',
];

const stage = mkdtempSync(join(tmpdir(), 'octoview-amo-'));
try {
  for (const rel of INCLUDE) {
    const dest = join(stage, rel);
    mkdirSync(join(dest, '..'), { recursive: true });
    cpSync(join(ROOT, rel), dest, { recursive: true });
  }
  mkdirSync(join(ROOT, 'build'), { recursive: true });
  rmSync(OUT, { force: true });
  execFileSync('zip', ['-qr', OUT, '.'], { cwd: stage });
  console.log('AMO source package: ' + OUT);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
