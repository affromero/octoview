import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('release bump', () => {
  it('updates and stages the browser and VS Code versions together', () => {
    const root = mkdtempSync(join(tmpdir(), 'octoview-bump-'));
    try {
      for (const dir of ['scripts', 'extension', 'vscode', 'bin']) mkdirSync(join(root, dir));
      copyFileSync(join(process.cwd(), 'scripts/bump.mjs'), join(root, 'scripts/bump.mjs'));
      for (const path of ['extension/manifest.json', 'vscode/package.json', 'package.json']) {
        writeFileSync(join(root, path), JSON.stringify({ version: '0.2.0' }));
      }
      writeFileSync(
        join(root, 'package-lock.json'),
        JSON.stringify({ version: '0.2.0', packages: { '': { version: '0.2.0' } } })
      );
      writeFileSync(join(root, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n');
      const git = join(root, 'bin/git');
      writeFileSync(git, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$BUMP_GIT_LOG"\n');
      chmodSync(git, 0o755);
      const log = join(root, 'git.log');
      execFileSync(process.execPath, [join(root, 'scripts/bump.mjs'), 'minor'], {
        cwd: root,
        env: {
          ...process.env,
          PATH: join(root, 'bin') + delimiter + process.env.PATH,
          BUMP_GIT_LOG: log,
        },
      });
      for (const path of [
        'extension/manifest.json',
        'vscode/package.json',
        'package.json',
        'package-lock.json',
      ]) {
        expect(JSON.parse(readFileSync(join(root, path), 'utf8')).version).toBe('0.3.0');
      }
      expect(readFileSync(log, 'utf8')).toMatch(/^add .*vscode\/package\.json/m);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
