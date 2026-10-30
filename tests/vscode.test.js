// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { createRequire } from 'node:module';
import '../extension/core.js';

const require = createRequire(import.meta.url);
const { createProvider, readPreview } = require('../vscode/extension.js');
const manifest = require('../vscode/package.json');
const directories = [];

function uri(path, scheme = 'file') {
  return { path, fsPath: path, scheme, toString: () => `${scheme}://${path}` };
}

async function temporaryFile(name, content = 'sample') {
  const directory = await mkdtemp(join(tmpdir(), 'octoview-test-'));
  directories.push(directory);
  const path = join(directory, name);
  await writeFile(path, content);
  return uri(path);
}

function editor() {
  const messages = [];
  let receive;
  let dispose;
  const vscode = {
    Uri: { joinPath: (base, ...parts) => uri(posix.join(base.path, ...parts), base.scheme) },
    FileType: { File: 1 },
  };
  const panel = {
    webview: {
      cspSource: 'https://assets.example',
      asWebviewUri: (asset) => new URL(asset.path, 'https://assets.example'),
      onDidReceiveMessage: (handler) => {
        receive = handler;
        return {
          dispose: () => {
            receive = undefined;
          },
        };
      },
      postMessage: async (message) => {
        messages.push(message);
      },
    },
    onDidDispose: (handler) => {
      dispose = handler;
    },
  };
  return {
    vscode,
    panel,
    messages,
    provider: createProvider(vscode, { extensionUri: uri('/extension') }),
    send: (message) => receive(message),
    close: () => dispose(),
  };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('VS Code previews', () => {
  it('offers every shared format without taking over default editors', () => {
    const customEditor = manifest.contributes.customEditors[0];
    expect(customEditor.priority).toBe('option');
    expect(
      customEditor.selector.map(({ filenamePattern }) => filenamePattern.slice(1)).sort()
    ).toEqual([...globalThis.octoview.SUPPORTED].sort());
  });

  it('opens supported uppercase filenames and rejects other formats', () => {
    const { provider } = editor();
    expect(provider.openCustomDocument(uri('/workspace/ARRAY.NPY')).uri.path).toContain(
      'ARRAY.NPY'
    );
    expect(() => provider.openCustomDocument(uri('/workspace/private.txt'))).toThrow(
      /not supported/
    );
  });

  it('reads saved bytes on open and again when refreshed', async () => {
    const file = await temporaryFile('report.html', '<h1>First</h1>');
    const host = editor();
    host.provider.resolveCustomEditor(host.provider.openCustomDocument(file), host.panel);
    await host.send({ type: 'ready' });
    expect(Buffer.from(host.messages.at(-1).bytes, 'base64').toString()).toContain('First');
    await writeFile(file.fsPath, '<h1>Changed</h1>');
    await host.send({ type: 'refresh', path: '/unrelated/secret.txt' });
    expect(Buffer.from(host.messages.at(-1).bytes, 'base64').toString()).toContain('Changed');
    expect(host.panel.webview.options.localResourceRoots.map((root) => root.path)).toEqual([
      '/extension/media',
    ]);
    host.close();
  });

  it('ignores arbitrary file-read messages', async () => {
    const host = editor();
    host.provider.resolveCustomEditor(
      host.provider.openCustomDocument(uri('/missing.npy')),
      host.panel
    );
    await host.send({ type: 'readFile', path: '/private/secret' });
    expect(host.messages).toEqual([]);
    host.close();
  });

  it('loads only the fixed LCC companions and names missing companions', async () => {
    const file = await temporaryFile('meta.lcc', '{}');
    const host = editor();
    host.provider.resolveCustomEditor(host.provider.openCustomDocument(file), host.panel);
    await host.send({ type: 'ready' });
    expect(host.messages.at(-1)).toMatchObject({
      type: 'error',
      message: expect.stringContaining('index.bin'),
    });
    await writeFile(join(file.path, '..', 'index.bin'), 'index');
    await writeFile(join(file.path, '..', 'data.bin'), 'data');
    await host.send({ type: 'refresh' });
    const result = host.messages.at(-1);
    expect(result.type).toBe('preview');
    expect(Buffer.from(result.companions['index.bin'], 'base64').toString()).toBe('index');
    expect(Buffer.from(result.companions['data.bin'], 'base64').toString()).toBe('data');
    host.close();
  });

  it('rejects oversized normal files before loading their contents', async () => {
    const file = await temporaryFile('array.npy');
    const handle = await open(file.fsPath, 'r+');
    try {
      await handle.truncate(64 * 1024 * 1024 + 1);
    } finally {
      await handle.close();
    }
    await expect(readPreview({}, file)).rejects.toThrow(/64 MiB/);
  });

  it('reads only the metadata prefix of large local model files', async () => {
    const file = await temporaryFile('model.gguf', 'GGUF');
    const handle = await open(file.fsPath, 'r+');
    try {
      await handle.truncate(4 * 1024 ** 3);
    } finally {
      await handle.close();
    }
    const bytes = Buffer.from(await readPreview({}, file, true), 'base64');
    expect(bytes.byteLength).toBe(32 * 1024 * 1024);
    expect(bytes.subarray(0, 4).toString()).toBe('GGUF');
  });

  it('reads virtual files and refuses large model reads without range support', async () => {
    const api = {
      FileType: { File: 1 },
      workspace: {
        fs: {
          stat: async () => ({ type: 1, size: 6 }),
          readFile: async () => new TextEncoder().encode('remote'),
        },
      },
    };
    const file = uri('/workspace/model.gguf', 'memfs');
    expect(Buffer.from(await readPreview(api, file), 'base64').toString()).toBe('remote');
    api.workspace.fs.stat = async () => ({ type: 1, size: 1024 ** 3 });
    api.workspace.fs.readFile = async () => {
      throw new Error('Must not read a large file');
    };
    await expect(readPreview(api, file, true)).rejects.toThrow(/cannot read model headers/);
  });

  it('reports filesystem errors as preview errors', async () => {
    const host = editor();
    host.provider.resolveCustomEditor(
      host.provider.openCustomDocument(uri('/missing.npy')),
      host.panel
    );
    await host.send({ type: 'ready' });
    expect(host.messages.at(-1)).toMatchObject({
      type: 'error',
      message: expect.stringMatching(/ENOENT/),
    });
    host.close();
  });

  it('preserves filenames with spaces and URL punctuation in previews', async () => {
    const file = await temporaryFile('a # b.npy');
    const host = editor();
    host.provider.resolveCustomEditor(host.provider.openCustomDocument(file), host.panel);
    await host.send({ type: 'ready' });
    expect(host.messages.at(-1)).toMatchObject({ name: 'a # b.npy', type: 'preview' });
    host.close();
  });
});
