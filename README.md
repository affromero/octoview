# octoview

Safari Web Extension that previews files straight from **private** GitHub repos —
the ones GitHub renders as raw source or strips: self-contained HTML reports,
Gaussian-splat files, and Jupyter notebooks with their interactive outputs intact.

It injects a **Preview** button on any GitHub `blob` page, scrapes the file's
tokenized raw URL (already authorized for the logged-in session — no OAuth/PAT),
and renders it in the extension's own page.

## Status

- **Phase 0 — auth spike (current):** button injects on blob pages; the viewer
  fetches the file and reports HTTP status + byte length. Proves private-repo
  access end to end before any renderer is built.
- Phase 1: HTML, splat (`@afromero/splattie-widget`), and notebook renderers.
- Later: `.parquet`, ONNX/Netron, `.npy`, `.exr`, `.lcc`, …

## Build & run (local, unsigned)

```sh
# 1. (Phase 1b+) vendor the renderer libs
scripts/vendor.sh

# 2. wrap the MV3 folder in an Xcode app
xcrun safari-web-extension-converter extension/ \
  --macos-only --bundle-identifier co.afromero.octoview \
  --project-location ./Safari

# 3. open, sign to run locally (Team 2HVQQ4W769), and Run
open Safari/octoview/octoview.xcodeproj
```

Then in Safari: **Settings ▸ Developer ▸ Allow unsigned extensions** (resets each
launch) ▸ **Extensions** ▸ enable octoview ▸ allow it on `github.com`.

Open a private-repo file and click **Preview**.

## Layout

```
extension/
  manifest.json          MV3 config
  content.js             inject button + scrape raw URL
  viewer.html/.js         extension page: fetch + renderer registry
  renderers/*.js          one file per file-type (self-register by extension)
  vendor/                 vendored self-contained libs (committed)
```
