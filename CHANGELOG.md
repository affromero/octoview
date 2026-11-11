# Changelog

All notable changes to octoview. The version in `extension/manifest.json` is the
single source of truth; `npm run bump` moves the Unreleased notes below into a
new version, commits, and tags it.

## [Unreleased]

## [0.3.0] - 2026-11-10

### Added

- NumPy previews support float16 values, exact 64-bit integers, scalar arrays,
  and slices of higher-dimensional arrays. ([#32](https://github.com/affromero/octoview/pull/32))

### Fixed

- Empty Arrow and Parquet tables retain their column names. Wide tables report
  the full column count and show up to 100 columns. Parquet previews allow up
  to 100 selected leaf columns. ([#32](https://github.com/affromero/octoview/pull/32))

### Changed

- Updated preview bundles and development dependencies, and patched minimatch
  preprocessing.
  ([#31](https://github.com/affromero/octoview/pull/31), [#30](https://github.com/affromero/octoview/pull/30))

## [0.2.0] - 2026-10-30

### Added

- VS Code extension for local and remote files, using the shared renderers and
  sandboxed notebook and HTML previews. ([#26](https://github.com/affromero/octoview/pull/26))
- Per-file-type automatic previews in VS Code settings. Manual previews remain
  the default, and existing editor associations are preserved.
  ([#28](https://github.com/affromero/octoview/pull/28))

### Changed

- Updated Parquet and Arrow parsers and added checks that vendored bundles match
  the lockfile. ([#27](https://github.com/affromero/octoview/pull/27))
- Updated development dependencies and patched Vite and Undici security issues.
  ([#24](https://github.com/affromero/octoview/pull/24), [#23](https://github.com/affromero/octoview/pull/23), [#18](https://github.com/affromero/octoview/pull/18))

## [0.1.0] - 2026-07-11

First public release.

- Inline preview on GitHub blob pages: 3D Gaussian splats (`.splat`, `.spz`
  v1-4, `.ksplat`, `.sog`, 3DGS/compressed `.ply`, `.lcc`), meshes and point
  clouds, live HTML reports, Jupyter notebooks, `.safetensors`/`.gguf` tables and
  `.onnx` graphs, `.parquet`/`.arrow` tables, `.npy`/`.npz` arrays, and
  `.exr`/`.hdr`/`.tiff` images.
- Gaussian splats render as true oriented (anisotropic) gaussians on the main
  thread — no Spark, no worker, no WASM — under the strict extension CSP in every
  browser. A Variance control collapses each splat to its mean.
- Works on private repositories via the existing GitHub session; no service,
  upload, or access token.
- Safari (Mac App Store), Chrome (Web Store), and Firefox (AMO) build variants.
- Security-hardened: sandboxed untrusted content with no network egress,
  defensive parsers, pinned dependencies, gitleaks + npm audit + Dependabot.
