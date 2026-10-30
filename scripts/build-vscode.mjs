import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createVSIX } from '@vscode/vsce';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'build', 'vscode');
await rm(out, { recursive: true, force: true });
await mkdir(join(out, 'media'), { recursive: true });
await cp(join(root, 'vscode'), out, { recursive: true });
for (const name of await readdir(join(root, 'extension'))) {
  if (name === 'vendor' || (name.endsWith('.js') && name !== 'content.js')) {
    await cp(join(root, 'extension', name), join(out, 'media', name), { recursive: true });
  }
}
await rm(join(out, 'media', 'vendor', '.gitkeep'), { force: true });
for (const name of ['webview.js', 'webview.css']) {
  await cp(join(out, name), join(out, 'media', name));
  await rm(join(out, name));
}
await cp(join(root, 'extension', 'icons', 'icon128.png'), join(out, 'icon.png'));
for (const name of ['LICENSE', 'SECURITY.md']) await cp(join(root, name), join(out, name));
await cp(join(root, 'vscode', 'README.md'), join(out, 'README.md'));
const manifest = JSON.parse(await readFile(join(out, 'package.json'), 'utf8'));
const browser = JSON.parse(await readFile(join(root, 'extension', 'manifest.json'), 'utf8'));
manifest.version = browser.version;
await writeFile(join(out, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
const packagePath = join(root, 'build', 'octoview-vscode.vsix');
await createVSIX({ cwd: out, packagePath, dependencies: false, skipLicense: false });
console.log(`Built ${packagePath}`);
