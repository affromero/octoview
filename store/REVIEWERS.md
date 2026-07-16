# octoview, notes for AMO reviewers

This add-on vendors a few minified third-party libraries under
`extension/vendor/`. This document explains how to reproduce them byte-for-byte
from source, and how the submitted Firefox package is produced from the Safari
source of truth.

## Build environment

- Node.js 22 (see `.github/workflows/ci.yml`)
- npm (uses the committed `package-lock.json`)
- The build rasterizes the extension icon from `assets/logo.svg` using the
  Playwright Chromium that npm installs, so the browser binary must be present.

## Reproduce the vendored libraries and the submitted package

```sh
npm ci                          # install exact locked dependencies
npx playwright install chromium # browser used only to rasterize the icon
./scripts/vendor.sh             # rebuild every extension/vendor/*.js from npm deps
npm run build:firefox           # produce build/firefox (the submitted, unzipped add-on)
```

`build/firefox` is exactly what was uploaded (the `.zip` is that directory
compressed). Diff it against the unpacked submission to confirm.

## What each vendored file is

Every bundle is produced by `esbuild` from a lockfile-pinned npm dependency in
`scripts/vendor.sh`. **Nothing is downloaded from a CDN at build time**:

| File                      | npm source (pinned in package.json / package-lock.json) |
| ------------------------- | ------------------------------------------------------- |
| `vendor/marked.min.js`    | `marked`                                                |
| `vendor/highlight.min.js` | `highlight.js` (core + python/javascript/json/bash)     |
| `vendor/three3d.esm.js`   | `three` + its example loaders                           |
| `vendor/hyparquet.esm.js` | `hyparquet`                                             |
| `vendor/flechette.esm.js` | `@uwdata/flechette`                                     |
| `vendor/plotly.esm.js`    | `plotly.js-cartesian-dist-min`                          |
| `vendor/fflate.esm.js`    | `fflate` (+ `fzstd`)                                    |

Every listed bundle ships as-is; there are no browser-specific bundle removals.
Splats render via a native WebGL2 renderer in the content script's isolated
world (`render-splat.js`), so Firefox needs no worker, blob, or WASM bundle.

## How the Firefox manifest differs from the source manifest

`extension/manifest.json` is the Safari manifest. `scripts/build-firefox.mjs`
patches it for Firefox:

- Content-security-policy `extension_pages` is set to the strict minimum
  (`script-src 'self'; connect-src 'none'; object-src 'none'`).
- `browser_specific_settings.gecko` is added (id, `strict_min_version`,
  `data_collection_permissions: { required: ['none'] }`).

## Data collection

None. The extension makes no network request to any host other than GitHub
(`github.com`, `raw.githubusercontent.com`, `media.githubusercontent.com`),
stores nothing, and has no analytics or telemetry. See `SECURITY.md`.
