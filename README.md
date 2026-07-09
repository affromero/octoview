<div align="center">

<img src="assets/logo.svg" alt="octoview" width="112" />

# octoview

**Preview the files GitHub won't, straight from your private repos.**

_Gaussian splats, meshes, point clouds, depth and EXR, HTML reports, notebooks, tabular data. The ML and data files GitHub serves as raw bytes._

[![CI](https://github.com/affromero/octoview/actions/workflows/ci.yml/badge.svg)](https://github.com/affromero/octoview/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-unit_%2B_webkit_e2e-brightgreen)](test/render.e2e.mjs)
[![Safari](https://img.shields.io/badge/Safari-Web_Extension-006CFF?logo=safari&logoColor=white)](https://developer.apple.com/documentation/safariservices/safari_web_extensions)
[![Manifest v3](https://img.shields.io/badge/manifest-v3-8250df)](extension/manifest.json)

[Why](#why) · [What it previews](#what-it-previews) · [Try it](#try-it-from-this-repo) · [How it works](#how-it-works) · [Develop](#develop)

</div>

---

## Why

ML and data work lives in files GitHub renders as **raw source or not at all**: self-contained HTML
reports (Plotly, `ydata-profiling`, W&B exports), notebooks whose interactive plots get stripped,
Gaussian splat captures, meshes and point clouds, model graphs, Parquet, `.npy` arrays, EXR and
depth images.

The usual fixes (`htmlpreview`, `nbviewer`, `raw.githack`) **can't reach private repos** because they
can't authenticate as you. octoview can. It is a Safari extension, so it rides your existing GitHub
session: it adds a **Preview** button on any `blob` page, fetches the file with your cookies, and
renders it in place. No service, no upload, no personal access token.

## What it previews

Everything runs through one small, unit-tested core that dispatches by file extension. Each row is a
renderer. Status is **verified in WebKit (Safari's engine) by an automated render test**.

| Type                           | Extensions                                                                                              | Renderer                                                       | Status |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | :----: |
| **HTML reports / plots**       | `.html` `.htm`                                                                                          | manifest sandbox page (inline scripts run)                     |   ✅   |
| **Jupyter notebooks**          | `.ipynb`                                                                                                | keeps the interactive outputs GitHub strips                    |   ✅   |
| **3D meshes and point clouds** | `.glb` `.obj` `.ply` `.pcd`                                                                             | three.js loaders (parsed on the main thread)                   |   ✅   |
| **Gaussian splats**            | `.spz` `.splat` `.ksplat` `.sog` `.pcsogs` `.rad` `.lcc` `.lcc2` `.splattie` (and splat-encoded `.ply`) | splat renderer, Spark formats plus LCC/RAD (WebKit data layer) |   🚧   |
| **Model graphs**               | `.onnx` `.tflite` `.gguf` `.safetensors`                                                                | Netron plus a tensor and metadata table                        |   🚧   |
| **Tabular data**               | `.parquet` `.arrow` `.feather`                                                                          | hyparquet                                                      |   🚧   |
| **Array previews**             | `.npy` `.npz`                                                                                           | header parse to a heatmap or image thumbnail                   |   🚧   |
| **Scientific images**          | `.exr` `.hdr` `.tiff` `16-bit .png`                                                                     | tone map to a canvas                                           |   🚧   |

> **On WebKit.** Safari cannot fetch a main-thread `blob:` URL from inside a worker, so renderers
> parse the file bytes on the main thread (three.js loaders, pure-JS parsers) or fetch a real
> same-origin URL. Every format is verified in the WebKit test harness before it ships.

## Try it from this repo

Open any file below on GitHub and click **Preview** (after [installing](#develop)):

| Sample                                             | Shows                                       |
| -------------------------------------------------- | ------------------------------------------- |
| [`samples/report.html`](samples/report.html)       | a live HTML report (its inline script runs) |
| [`samples/notebook.ipynb`](samples/notebook.ipynb) | a notebook whose interactive output is kept |
| [`samples/cube.obj`](samples/cube.obj)             | a mesh                                      |
| [`samples/points.ply`](samples/points.ply)         | a colored point cloud                       |
| [`samples/cloud.pcd`](samples/cloud.pcd)           | a PCD point cloud                           |
| [`samples/head.splattie`](samples/head.splattie)   | a Gaussian splat (splat phase, 🚧)          |

## How it works

Three constraints, each solved once.

- **Private-repo access.** The content script runs on `github.com`, so it has your cookies. It
  resolves the file's tokenized `raw.githubusercontent.com` URL. No PAT, no OAuth.
- **Script execution under GitHub's CSP.** github.com's CSP (`default-src 'none'`) is inherited by
  any in-page frame (`srcdoc`, `blob:`, `data:`), and its `frame-src` blocks embedding the
  extension, so a report's scripts cannot run in the page. octoview renders in the **extension's own
  tab** instead, the one context with its own CSP. Arbitrary inline report scripts run in a
  **manifest-declared sandbox page** that is postMessaged the report HTML.
- **Crossing Safari's process boundary.** The github tab and the extension tab are separate
  processes, so `postMessage`, `storage`, and cross-tab navigation do not reliably cross. The content
  script messages a **background event page**, which opens the viewer tab with the URL baked into its
  hash. No shared state, no handshake.

The dispatch, URL resolution, and notebook rendering live in
[`extension/core.js`](extension/core.js), kept free of browser APIs so they run under Vitest.

## Develop

No Xcode is needed for the dev loop. Safari loads the unpacked folder directly.

1. **Develop, Add Temporary Extension**, then select `extension/`.
2. Reload the page you are testing and click **Preview**. (Re-add after editing to reload.)

To package it as an installable app:

```sh
xcrun safari-web-extension-converter extension/ \
  --macos-only --bundle-identifier co.afromero.octoview --project-location ./Safari
```

## Test

```sh
npm install
npm test                              # vitest (jsdom): core logic and renderers
npx playwright install chromium webkit
npm run test:e2e                      # renders every sample in Chromium AND WebKit (Safari's engine)
npm run ci                            # lint, format check, unit tests
```

The e2e test is the important one. It renders each sample under the real extension CSP in **WebKit**,
which is how Safari-specific breakage that jsdom cannot see gets caught.

## Layout

```
extension/
  manifest.json        MV3 config (background event page, extension and sandbox CSP)
  core.js              pure and DOM logic: dispatch, URL resolve, renderers (unit-tested)
  content.js           github.com glue: button, fetch with cookies, message the background
  background.js        opens the viewer tab with the resolved URL
  viewer.html/.js      the extension tab that fetches and renders
  viewer3d.js          three.js mesh and point-cloud renderer (lazy-loaded)
  sandbox/report.html  runs a report's inline scripts under a relaxed CSP
  vendor/              vendored self-contained libs (marked, three.js bundle)
samples/               one file per type, previewable from the repo
tests/                 vitest suite over core.js
test/render.e2e.mjs    Chromium and WebKit render check
```

## License

[MIT](LICENSE) © Andres Romero
