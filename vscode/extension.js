const { open } = require('node:fs/promises');
const { posix } = require('node:path');
const manifest = require('./package.json');
const { initializeAutoPreviews } = require('./settings.js');

const VIEW_TYPE = 'octoview.preview';
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_MODEL_BYTES = 32 * 1024 * 1024;

function extensionOf(uri) {
  return posix.extname(uri.path).toLowerCase();
}

function isSupported(uri) {
  return manifest.contributes.customEditors[0].selector.some(
    ({ filenamePattern }) => filenamePattern.slice(1) === extensionOf(uri)
  );
}

async function readPreview(vscode, uri, headerOnly = false) {
  const limit = headerOnly ? MAX_MODEL_BYTES : MAX_BYTES;
  const tooLarge = () => new Error(`File exceeds the ${limit / 1024 / 1024} MiB preview limit.`);
  if (uri.scheme === 'file') {
    const file = await open(uri.fsPath, 'r');
    try {
      const stat = await file.stat();
      if (!stat.isFile()) throw new Error('Preview requires a file.');
      if (!headerOnly && stat.size > limit) throw tooLarge();
      // One extra byte detects a file growing beyond its stat size.
      const bytes = Buffer.alloc(Math.min(stat.size, limit) + (headerOnly ? 0 : 1));
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      if (offset > limit) throw tooLarge();
      if (!headerOnly && offset > stat.size)
        throw new Error('File changed while reading. Refresh the preview.');
      return bytes.subarray(0, offset).toString('base64');
    } finally {
      await file.close();
    }
  }
  const stat = await vscode.workspace.fs.stat(uri);
  if (!(stat.type & vscode.FileType.File)) throw new Error('Preview requires a file.');
  if (stat.size > limit) {
    if (headerOnly) {
      throw new Error(
        'This file provider cannot read model headers in ranges. Open a local copy to preview models larger than 32 MiB.'
      );
    }
    throw tooLarge();
  }
  const bytes = await vscode.workspace.fs.readFile(uri);
  if (bytes.byteLength > limit) throw tooLarge();
  return Buffer.from(bytes).toString('base64');
}

function escapeAttribute(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
  );
}

function getWebviewHtml(webview, mediaUri, vscode) {
  const asset = (name) =>
    escapeAttribute(webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, name)).toString());
  const source = escapeAttribute(webview.cspSource);
  // srcdoc inherits this policy. Reports cannot run inline scripts or load
  // external resources, even inside their opaque-origin sandbox.
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${source}; style-src ${source} 'unsafe-inline'; img-src ${source} data: blob:; font-src ${source} data:; connect-src ${source} data: blob:; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${asset('webview.css')}">
<title>Octoview Preview</title></head><body>
<header><strong id="filename">Octoview</strong><button id="refresh" type="button">Refresh</button></header>
<p id="status" role="status">Loading preview...</p>
<main id="mount"></main>
<script src="${asset('vendor/marked.min.js')}"></script>
<script src="${asset('vendor/highlight.min.js')}"></script>
<script src="${asset('core.js')}"></script>
<script type="module" src="${asset('webview.js')}"></script>
</body></html>`;
}

function createProvider(vscode, context) {
  return {
    openCustomDocument(uri) {
      if (!isSupported(uri)) throw new Error('This file type is not supported by Octoview.');
      return {
        uri,
        dispose() {
          /* File bytes belong to the webview, not the document. */
        },
      };
    },
    resolveCustomEditor(document, panel) {
      const mediaUri = vscode.Uri.joinPath(context.extensionUri, 'media');
      panel.webview.options = { enableScripts: true, localResourceRoots: [mediaUri] };
      let loading = false;
      let disposed = false;
      const receiver = panel.webview.onDidReceiveMessage(async (message) => {
        // No message can supply a path, command, URL, or arbitrary read request.
        if (disposed || loading || !message || !['ready', 'refresh'].includes(message.type)) return;
        loading = true;
        try {
          const ext = extensionOf(document.uri);
          const bytes = await readPreview(
            vscode,
            document.uri,
            ['.gguf', '.safetensors'].includes(ext)
          );
          const companions = {};
          if (ext === '.lcc') {
            const directory = vscode.Uri.joinPath(document.uri, '..');
            for (const name of ['index.bin', 'data.bin']) {
              try {
                companions[name] = await readPreview(vscode, vscode.Uri.joinPath(directory, name));
              } catch (error) {
                throw new Error(`LCC companion ${name}: ${error.message}`, { cause: error });
              }
            }
          }
          if (!disposed)
            await panel.webview.postMessage({
              type: 'preview',
              name: posix.basename(document.uri.path),
              ext,
              bytes,
              companions,
            });
        } catch (error) {
          if (!disposed) await panel.webview.postMessage({ type: 'error', message: error.message });
        } finally {
          loading = false;
        }
      });
      panel.onDidDispose(() => {
        disposed = true;
        receiver.dispose();
      });
      panel.webview.html = getWebviewHtml(panel.webview, mediaUri, vscode);
    },
  };
}

function activate(context) {
  const vscode = require('vscode');
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, createProvider(vscode, context)),
    vscode.commands.registerCommand('octoview.openPreview', async (resource) => {
      const uri = resource || vscode.window.activeTextEditor?.document.uri;
      if (!uri || !isSupported(uri)) {
        await vscode.window.showErrorMessage('Select a supported file to preview with Octoview.');
        return;
      }
      await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    })
  );
  initializeAutoPreviews(vscode, context);
}

module.exports = { activate, createProvider, getWebviewHtml, readPreview };
