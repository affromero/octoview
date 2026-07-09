<div align="center">

<img src="assets/logo.svg" alt="octoview" width="112" />

# octoview

**Preview the files GitHub won't — straight from your private repos.**

_HTML reports, 3D Gaussian splats, and notebooks with their interactive outputs intact._

[![CI](https://github.com/affromero/octoview/actions/workflows/ci.yml/badge.svg)](https://github.com/affromero/octoview/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-15_passing-brightgreen)](tests/core.test.js)
[![Safari](https://img.shields.io/badge/Safari-Web_Extension-006CFF?logo=safari&logoColor=white)](https://developer.apple.com/documentation/safariservices/safari_web_extensions)
[![Manifest v3](https://img.shields.io/badge/manifest-v3-8250df)](extension/manifest.json)

[Why](#why) · [What it previews](#what-it-previews) · [Try it](#try-it-from-this-repo) · [How it works](#how-it-works) · [Develop](#develop)

</div>

---

## Why

ML and data work lives in files GitHub renders as **raw source or not at all**: self-contained HTML
reports (Plotly, `ydata-profiling`, W&B exports), Gaussian-splat captures, notebooks whose
interactive plots get stripped, model graphs, Parquet, `.npy` arrays, EXR/depth images.

The usual fixes — `htmlpreview`, `nbviewer`, `raw.githack` — **can't touch private repos** because
they can't authenticate as you. octoview can: it's a Safari extension, so it rides your existing
GitHub session. It adds a **Preview** button on any `blob` page, fetches the file with your cookies,
and renders it **in place** — no service, no upload, no personal access token.

## What it previews

Adding the button, resolving the URL, and dispatching by type is one small tested core; each row is
a renderer keyed by extension.

| Type                     | Extensions                               | Why GitHub falls short                  | Renderer                                  | Status |
| ------------------------ | ---------------------------------------- | --------------------------------------- | ----------------------------------------- | :----: |
| **HTML reports / plots** | `.html` `.htm`                           | shows raw source                        | sandboxed `srcdoc` iframe (scripts run)   |   ✅   |
| **Gaussian splats**      | `.splattie` `.ply` `.spz` `.splat`       | no viewer for large / private           | [`@afromero/splattie-widget`][sw] (Spark) |   ✅   |
| **Jupyter notebooks**    | `.ipynb`                                 | renders static; strips live outputs     | `marked` + sandboxed output frames        |   ✅   |
| **Markdown**             | `.md`                                    | fine, but LaTeX is inconsistent         | `marked` (KaTeX planned)                  |   ✅   |
| **3D assets**            | `.glb` `.obj` `.pcd`                     | viewer only for some formats            | `<model-viewer>` / three.js               |   🚧   |
| **Model graphs**         | `.onnx` `.tflite` `.gguf` `.safetensors` | no arch view; safetensors shows nothing | Netron + tensor/metadata table            |   🚧   |
| **Tabular data**         | `.parquet` `.arrow` `.feather`           | only CSV/TSV render                     | hyparquet                                 |   🚧   |
| **Array previews**       | `.npy` `.npz`                            | raw binary                              | header parse → heatmap / image thumbnail  |   🚧   |
| **Scientific images**    | `.exr` `.hdr` `.tiff` `16-bit .png`      | no render / wrong tone-mapping          | tone-map to canvas                        |   🚧   |

[sw]: https://github.com/affromero/splattie-widget

## Try it from this repo

Open any file below on GitHub and click **Preview** (after [installing](#develop)):

| Sample                                             | Demonstrates                                |
| -------------------------------------------------- | ------------------------------------------- |
| [`samples/report.html`](samples/report.html)       | a live HTML report (its inline script runs) |
| [`samples/head.splattie`](samples/head.splattie)   | a rigged 3D Gaussian splat                  |
| [`samples/notebook.ipynb`](samples/notebook.ipynb) | a notebook whose interactive output is kept |
| [`samples/notes.md`](samples/notes.md)             | Markdown rendering                          |

## How it works

Two problems, one trick each:

- **Private-repo access.** The content script (running on `github.com`, so it has your cookies)
  resolves the file's tokenized `raw.githubusercontent.com` URL and fetches the bytes. No PAT, no
  OAuth — the token GitHub already minted for your session does the work.
- **Rendering under GitHub's CSP.** octoview renders **in-page** inside a **sandboxed `srcdoc`
  iframe**. That frame gets an opaque origin not bound by github.com's Content-Security-Policy, so a
  report's (or the splat widget's) scripts run — and there's no fragile hand-off to a separate
  extension page (in Safari those live in another process that `postMessage`, storage, and
  background messaging don't reliably cross).

The type-dispatch, URL resolution, notebook parsing, and splat-document generation live in
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

### Test & lint

```sh
npm install
npm test          # vitest (jsdom) — core logic + renderers
npm run ci        # lint + format check + test
```

Set up hooks once with `pre-commit install`.

## Layout

```
extension/
  manifest.json     MV3 config (injects the three scripts below on github.com)
  core.js           pure + DOM logic: dispatch, URL resolve, renderers (unit-tested)
  content.js        browser glue: button, fetch-with-cookies, overlay
  vendor/           vendored self-contained libs (splattie-widget, marked)
samples/            one file per supported type, previewable from the repo
tests/              vitest suite over core.js
```

## License

[MIT](LICENSE) © Andres Romero
