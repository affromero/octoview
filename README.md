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
reports ([Plotly](https://plotly.com/python/),
[`ydata-profiling`](https://github.com/ydataai/ydata-profiling),
[W&B](https://wandb.ai/) exports), notebooks whose interactive plots get stripped, Gaussian splat
captures, meshes and point clouds, model graphs, Parquet, `.npy` arrays, EXR and depth images.

The usual fixes ([`htmlpreview`](https://htmlpreview.github.io/),
[`nbviewer`](https://nbviewer.org/), [`raw.githack`](https://raw.githack.com/)) **can't reach private
repos** because they can't authenticate as you. octoview can. It is a Safari extension, so it rides
your existing GitHub session: it adds a **Preview** button on any `blob` page, fetches the file with
your cookies, and renders it in place. No service, no upload, no personal access token.

## What it previews

Everything runs through one small, unit-tested core that dispatches by file extension. Each row is a
renderer. Status is **verified in WebKit (Safari's engine) by an automated render test**.

| Type                           | Extensions                                         | Renderer                                                                           | Status |
| ------------------------------ | -------------------------------------------------- | ---------------------------------------------------------------------------------- | :----: |
| **HTML reports / plots**       | `.html` `.htm`                                     | sandboxed frame, inline; static HTML content                                       |   ✅   |
| **Jupyter notebooks**          | `.ipynb`                                           | keeps the interactive outputs GitHub strips                                        |   ✅   |
| **3D meshes and point clouds** | `.glb` `.gltf` `.obj` `.ply` `.pcd`                | three.js loaders (parsed on the main thread), gizmo + point sliders                |   ✅   |
| **Gaussian splats**            | `.splat` `.ply` (3DGS + compressed) `.splattie`    | main-thread gaussian sprites, depth-sorted; standard and SuperSplat-compressed PLY |   ✅   |
| **Model graphs**               | `.safetensors` `.gguf`                             | main-thread header parse to a tensor + metadata table                              |   ✅   |
| **Tabular data**               | `.parquet`                                         | hyparquet, sticky-header table                                                     |   ✅   |
| **Array previews**             | `.npy` `.npz`                                      | viridis heatmap / RGB image, with a raw-numbers view (1-3D)                        |   ✅   |
| **Scientific images**          | `.exr` `.hdr` `.tif` `.tiff`                       | tone-mapped to a canvas with an exposure slider                                    |   ✅   |
| **More splats / graphs**       | `.spz` `.ksplat` `.sog` `.lcc` `.rad`, ONNX, Arrow | bespoke decoders (some Spark-only / worker-based) or Netron                        |   🚧   |

> **On WebKit.** Two Safari limits shape the design. (1) Renderers parse file bytes on the main
> thread (three.js loaders, pure-JS parsers) because Safari cannot fetch a main-thread `blob:` URL
> from inside a worker. (2) A report's own inline `<script>` tags cannot execute in a Safari
> extension (github's CSP is inherited by in-page frames, and Safari does not honor sandbox pages),
> so HTML reports and interactive outputs render as **static** HTML. Everything octoview draws
> itself (3D, tables, arrays, images) is unaffected. Every format is verified in the WebKit harness.

## Try it from this repo

Open any file below on GitHub and click **Preview** (after [installing](#develop)):

| Sample                                                   | Shows                                       |
| -------------------------------------------------------- | ------------------------------------------- |
| [`samples/report.html`](samples/report.html)             | a self-contained HTML report                |
| [`samples/notebook.ipynb`](samples/notebook.ipynb)       | a notebook whose interactive output is kept |
| [`samples/cube.obj`](samples/cube.obj)                   | a mesh                                      |
| [`samples/points.ply`](samples/points.ply)               | a colored point cloud                       |
| [`samples/cloud.pcd`](samples/cloud.pcd)                 | a PCD point cloud                           |
| [`samples/capybara.splat`](samples/capybara.splat)       | a Gaussian splat (antimatter15 `.splat`)    |
| [`samples/capybara.ply`](samples/capybara.ply)           | a compressed (SuperSplat) 3DGS splat PLY    |
| [`samples/head.splattie`](samples/head.splattie)         | a `.splattie` bundle (base splat rendered)  |
| [`samples/array.npy`](samples/array.npy)                 | a NumPy array as a heatmap                  |
| [`samples/array.npz`](samples/array.npz)                 | a compressed multi-array `.npz`             |
| [`samples/metrics.parquet`](samples/metrics.parquet)     | a Parquet table                             |
| [`samples/model.safetensors`](samples/model.safetensors) | a safetensors tensor list                   |
| [`samples/model.gguf`](samples/model.gguf)               | a GGUF model header                         |
| [`samples/depth.tiff`](samples/depth.tiff)               | a TIFF image                                |
| [`samples/render.hdr`](samples/render.hdr)               | a Radiance HDR, tone-mapped                 |
| [`samples/render.exr`](samples/render.exr)               | an OpenEXR image, tone-mapped               |

## How it works

Everything renders **inline in the blob view**, no new tab. Clicking **Preview** swaps the code for
the rendered file; clicking it again swaps back.

- **Private-repo access.** The content script runs on `github.com`, so it has your cookies. It
  resolves the file's tokenized `raw.githubusercontent.com` URL and fetches the bytes. No PAT, no
  OAuth.
- **Rendering under GitHub's CSP.** A content script runs in an isolated world that github's CSP does
  not bind, so octoview's own renderers (three.js on a `<canvas>`, DOM tables, notebook cells) run
  right there in the page. Heavy renderers (the three.js bundle) are lazy-imported only when their
  file type is opened, so normal browsing stays light.
- **Reports are static.** An HTML report's _own_ inline scripts cannot execute in a Safari extension
  (github's CSP is inherited by in-page frames, and Safari does not honor sandbox pages), so reports
  and interactive notebook outputs render in a sandboxed frame as static HTML. Script-generated
  charts (a bare Plotly canvas) stay blank; everything octoview draws itself is unaffected.

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
  manifest.json        MV3 config (content scripts, web-accessible render modules)
  core.js              pure and DOM logic: dispatch, URL resolve, notebook render (unit-tested)
  content.js           github.com: button, fetch with cookies, inline render pane
  render3d.js          three.js mesh and point-cloud renderer (gizmo, point sliders)
  render-splat.js      main-thread Gaussian splat renderer (.splat, 3DGS/compressed .ply, .splattie)
  render-array.js      .npy/.npz heatmap/image + raw-numbers view
  render-table.js      .parquet table (hyparquet)
  render-model.js      .safetensors/.gguf tensor and metadata table
  render-image.js      .exr/.hdr/.tiff tone-mapped to a canvas
  splat-decode.js      pure splat parsers (.splat, 3DGS .ply, .splattie); unit-tested
  unzip.js             shared ZIP reader (fflate) for .npz and .splattie
  vendor/              self-contained libs (marked, three.js + loaders, hyparquet, fflate)
samples/               one file per type, previewable from the repo
tests/                 vitest suite over core.js
test/harness.html/.js  stand-in blob page that drives the inline render path
test/render.e2e.mjs    Chromium and WebKit render check under a github-like CSP
```

Each `render-*.js` is an ES module, lazy-imported by `content.js` only when its file type is opened.

## License

[MIT](LICENSE) © Andres Romero
