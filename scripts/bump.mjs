// Single source of truth for the product version: extension/manifest.json's
// `version`. This bumps it (and package.json to match), moves the CHANGELOG's
// Unreleased notes under the new version, commits, and tags vX.Y.Z. All three
// browser builds read the manifest version; build-safari.sh derives the App
// Store MARKETING_VERSION from it and an ever-increasing build number from the
// git commit count.
//   node scripts/bump.mjs <patch|minor|major|X.Y.Z>
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const arg = process.argv[2];
if (!arg) throw new Error('usage: bump.mjs <patch|minor|major|X.Y.Z>');

const manifestPath = 'extension/manifest.json';
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const [maj, min, pat] = manifest.version.split('.').map(Number);
const next =
  arg === 'major'
    ? `${maj + 1}.0.0`
    : arg === 'minor'
      ? `${maj}.${min + 1}.0`
      : arg === 'patch'
        ? `${maj}.${min}.${pat + 1}`
        : arg;
if (!/^\d+\.\d+\.\d+$/.test(next)) throw new Error('bad version: ' + next);

const setVersion = (path) => {
  const json = JSON.parse(readFileSync(path, 'utf8'));
  json.version = next;
  writeFileSync(path, JSON.stringify(json, null, 2) + '\n');
};
setVersion(manifestPath);
setVersion('package.json');
// keep the top-level version in the lockfile aligned (npm reads it from here)
try {
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  lock.version = next;
  if (lock.packages && lock.packages['']) lock.packages[''].version = next;
  writeFileSync('package-lock.json', JSON.stringify(lock, null, 2) + '\n');
} catch {
  /* no lockfile is fine */
}

// Roll the CHANGELOG's Unreleased section into the new version.
const date = new Date().toISOString().slice(0, 10);
let changelog = readFileSync('CHANGELOG.md', 'utf8');
changelog = changelog.replace(/## \[Unreleased\]\n/, `## [Unreleased]\n\n## [${next}] - ${date}\n`);
writeFileSync('CHANGELOG.md', changelog);

execFileSync('git', ['add', manifestPath, 'package.json', 'package-lock.json', 'CHANGELOG.md']);
execFileSync('git', ['commit', '-m', `release: v${next}`]);
execFileSync('git', ['tag', `v${next}`]);
console.log(`bumped ${manifest.version} -> ${next}, committed and tagged v${next}`);
console.log(`push with:  git push origin main && git push origin v${next}`);
