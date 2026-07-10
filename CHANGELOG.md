# Changelog

All notable changes to octoview. The version in `extension/manifest.json` is the
single source of truth; `npm run bump` moves the Unreleased notes below into a
new version, commits, and tags it.

## [Unreleased]

## [1.0.0] - 2026-07-10

First public release.

- Inline preview on GitHub blob pages for 24 formats: 3D Gaussian splats
  (`.splat`, `.spz` v1-4, `.ksplat`, `.sog`, 3DGS/compressed `.ply`, `.splattie`,
  `.lcc`, `.rad`), meshes and point clouds, live HTML reports, Jupyter notebooks,
  `.safetensors`/`.gguf` tables and `.onnx` graphs, `.parquet`/`.arrow` tables,
  `.npy`/`.npz` arrays, and `.exr`/`.hdr`/`.tiff` images.
- Works on private repositories via the existing GitHub session; no service,
  upload, or access token.
- Safari (Mac App Store), Chrome (Web Store), and Firefox (AMO) build variants.
- Security-hardened: sandboxed untrusted content with no network egress,
  defensive parsers, pinned dependencies, gitleaks + npm audit + Dependabot.
