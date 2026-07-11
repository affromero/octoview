# Changelog

All notable changes to octoview. The version in `extension/manifest.json` is the
single source of truth; `npm run bump` moves the Unreleased notes below into a
new version, commits, and tags it.

## [Unreleased]

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
