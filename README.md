<div align="center">

<img src="assets/logo.svg" alt="octoview" width="112" />

# octoview

**Preview the files GitHub won't — straight from your private repos.**

_HTML reports, Markdown, and notebooks with their interactive outputs intact._

[![CI](https://github.com/affromero/octoview/actions/workflows/ci.yml/badge.svg)](https://github.com/affromero/octoview/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-10_unit_+_e2e-brightgreen)](tests/core.test.js)
[![Safari](https://img.shields.io/badge/Safari-Web_Extension-006CFF?logo=safari&logoColor=white)](https://developer.apple.com/documentation/safariservices/safari_web_extensions)
[![Manifest v3](https://img.shields.io/badge/manifest-v3-8250df)](extension/manifest.json)

[Why](#why) · [What it previews](#what-it-previews) · [Try it](#try-it-from-this-repo) · [How it works](#how-it-works) · [Develop](#develop)

</div>

---

## Why

ML and data work lives in files GitHub renders as **raw source or not at all**: self-contained HTML
reports (Plotly, `ydata-profiling`, W&B exports), notebooks whose interactive plots get stripped,
Gaussian-splat captures, model graphs, Parquet, `.npy` arrays, EXR/depth images.

The usual fixes — `htmlpreview`, `nbviewer`, `raw.githack` — **can't touch private repos** because
they can't authenticate as you. octoview can: it's a Safari extension, so it rides your existing
GitHub session. It adds a **Preview** button on any `blob` page, fetches the file with your cookies,
and renders it — no service, no upload, no personal access token.

## What it previews

Everything runs through one small, unit-tested core that dispatches by file extension; each row is a
renderer. Status is **verified in WebKit (Safari's engine) via an automated render test**.

| Type                               | Extensions                                  | Renderer                                          | Status |
| ---------------------------------- | ------------------------------------------- | ------------------------------------------------- | :----: |
| **HTML reports / plots**           | `.html` `.htm`                              | manifest sandbox page (inline scripts run)        |   ✅   |
| **Jupyter notebooks**              | `.ipynb`                                    | `marked` + sandbox frames for interactive outputs |   ✅   |
| **Markdown**                       | `.md`                                       | `marked` (KaTeX planned)                          |   ✅   |
| **3D — splats/pointclouds/meshes** | `.ply` `.spz` `.splat` `.glb` `.obj` `.pcd` | three.js loaders + splat renderer                 |   🚧   |
| **Model graphs**                   | `.onnx` `.tflite` `.gguf` `.safetensors`    | Netron + tensor/metadata table                    |   🚧   |
| **Tabular data**                   | `.parquet` `.arrow` `.feather`              | hyparquet                                         |   🚧   |
| **Array previews**                 | `.npy` `.npz`                               | header parse → heatmap / image thumbnail          |   🚧   |
| **Scientific images**              | `.exr` `.hdr` `.tiff` `16-bit .png`         | tone-map to canvas                                |   🚧   |

> **3D is a deliberate phase.** WebKit can't fetch a main-thread `blob:` URL from inside a worker,
> so 3D loaders get real same-origin URLs (three.js parses meshes/point clouds on the main thread;
> splats hand their renderer a URL its worker can fetch). Each format is verified in the WebKit test
> harness before it ships.

## Try it from this repo

Open any file below on GitHub and click **Preview** (after [installing](#develop)):

| Sample                                             | Demonstrates                                |
| -------------------------------------------------- | ------------------------------------------- |
| [`samples/report.html`](samples/report.html)       | a live HTML report (its inline script runs) |
| [`samples/notebook.ipynb`](samples/notebook.ipynb) | a notebook whose interactive output is kept |
| [`samples/notes.md`](samples/notes.md)             | Markdown rendering                          |
| [`samples/head.splattie`](samples/head.splattie)   | a 3D Gaussian splat (3D phase — 🚧)         |

## How it works

Three constraints, each solved once:

- **Private-repo access.** The content script (on `github.com`, so it has your cookies) resolves the
  file's tokenized `raw.githubusercontent.com` URL. No PAT, no OAuth.
- **Script execution under GitHub's CSP.** github.com's CSP (`default-src 'none'`) is inherited by
  any in-page frame (`srcdoc`/`blob:`/`data:`) and its `frame-src` blocks embedding the extension —
  so a report's scripts can't run in the page. octoview renders in the **extension's own tab**
  instead (the one context with its own CSP). Arbitrary inline report scripts run in a
  **manifest-declared sandbox page** postMessaged the report HTML.
- **Crossing Safari's process boundary.** The github tab and the extension tab are separate
  processes; `postMessage`, `storage`, and cross-tab navigation don't reliably cross. So the content
  script messages a **background event page**, which opens the viewer tab with the URL baked into its
  hash — no shared state, no handshake.

The dispatch, URL resolution, and notebook rendering live in
[`extension/core.js`](extension/core.js), kept free of browser APIs so they run under Vitest.

## Develop

No Xcode needed for the dev loop — Safari loads the unpacked folder directly:

1. **Develop ▸ Add Temporary Extension…** → select `extension/`
2. Reload the page you're testing and click **Preview**. (Re-add after editing to reload.)

To package it as an installable app:

```sh
xcrun safari-web-extension-converter extension/ \
  --macos-only --bundle-identifier co.afromero.octoview --project-location ./Safari
```

### Test

```sh
npm install
npm test                              # vitest (jsdom) — core logic + renderers
npx playwright install chromium webkit
npm run test:e2e                      # renders every sample in Chromium AND WebKit (= Safari)
npm run ci                            # lint + format check + test
```

The e2e test is the important one: it renders each sample under the real extension CSP in **WebKit**,
which is how we catch Safari-specific breakage jsdom can't see.

## Layout

```
extension/
  manifest.json     MV3 config (background event page + extension/sandbox CSP)
  core.js           pure + DOM logic: dispatch, URL resolve, renderers (unit-tested)
  content.js        github.com glue: button, fetch-with-cookies, message background
  background.js     opens the viewer tab with the resolved URL
  viewer.html/.js   the extension tab that fetches + renders
  sandbox/report.html   runs a report's inline scripts under a relaxed CSP
  vendor/           vendored self-contained libs (marked; splat widget for the 3D phase)
samples/            one file per type, previewable from the repo
tests/              vitest suite over core.js
test/render.e2e.mjs Chromium + WebKit render check
```

## License

[MIT](LICENSE) © Andres Romero
