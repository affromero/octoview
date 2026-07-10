# octoview, store listing copy

Ready-to-paste text for the Chrome Web Store, Mac App Store (Safari), and Firefox
AMO. Keep the wording truthful: octoview collects no data and makes no network
request to any non-GitHub host.

---

## Shared facts (all stores)

- **Name:** octoview
- **Category:** Developer Tools
- **Price:** Free
- **License:** MIT
- **Data collection:** None. No analytics, no telemetry, no accounts, no external
  servers. The extension only fetches the file you ask it to preview, from
  GitHub, using your existing session.
- **Permissions and why each is needed:**
  - `github.com`, the content script adds the Preview button and reads the blob
    page you are viewing.
  - `raw.githubusercontent.com`, `media.githubusercontent.com`, to fetch the raw
    file bytes (and, for LCC, its sibling `index.bin` / `data.bin`) that GitHub
    serves from these hosts, using your session cookies so private repos work.
- **Support / homepage URL:** https://github.com/affromero/octoview
  (only use this once the repository is public; otherwise leave blank or point to
  a landing page).

---

## Chrome Web Store

**Summary** (max 132 characters):

> Preview 3D Gaussian splats, notebooks, HTML reports, Parquet, ONNX and more, inline on GitHub. Private repos included.

**Description:**

> octoview turns a GitHub file page into a live preview of the file itself. It adds
> a Preview button on any blob page and renders the file in place, right where the
> code would be, without leaving GitHub or uploading anything.
>
> It previews 24 formats that GitHub shows as raw bytes or not at all:
>
> • 3D Gaussian splats: .splat, .spz (v1-v4), .ksplat, .sog, 3DGS .ply, .splattie
> • Meshes and point clouds: .glb, .gltf, .obj, .ply, .pcd
> • HTML reports: Plotly, ydata-profiling, W&B exports, with the report's own
> charts running live in a sandbox
> • Jupyter notebooks: .ipynb, keeping the interactive Plotly outputs GitHub strips
> • Model files: .safetensors and .gguf tensor tables, plus a Netron-style graph
> view for .onnx
> • Tables: .parquet, .arrow, .feather
> • Arrays: .npy, .npz, as heatmaps or images
> • Scientific images: .exr, .hdr, .tiff, tone-mapped with an exposure slider
>
> It works on private repositories because it rides your existing GitHub session.
> There is no service, no upload, and no personal access token. octoview collects
> no data and never contacts any server other than GitHub.
>
> Open source (MIT). Built with a strict content-security policy: untrusted file
> content only ever runs sandboxed, with no network access.

**Single-purpose description** (for the privacy tab):

> octoview has one purpose: to preview the contents of files on GitHub blob pages
> inline, for formats GitHub does not render itself.

**Permission justifications** (privacy tab):

- Host permission `github.com`: to add the Preview button and read the file page
  you are viewing.
- Host permission `raw.githubusercontent.com` / `media.githubusercontent.com`: to
  download the raw bytes of the file being previewed, using your session so
  private-repo files load.
- No `tabs`, `storage`, `cookies`, or `scripting` permissions are requested.

---

## Mac App Store (Safari Web Extension)

**Name:** octoview

**Subtitle** (max 30 characters):

> Preview ML files on GitHub

**Promotional text** (max 170 characters):

> Preview 3D Gaussian splats, notebooks, HTML reports, Parquet, ONNX graphs and more inline on any GitHub file page, private repos included. No upload, no account.

**Description** (max 4000 characters):

> octoview turns a GitHub file page into a live preview of the file itself. It adds
> a Preview button on any blob page and renders the file right where the code would
> be, without leaving GitHub or uploading anything.
>
> It previews the ML and data formats GitHub serves as raw bytes or not at all:
>
> - 3D Gaussian splats: .splat, .spz (v1-v4), .ksplat, .sog, 3DGS .ply, .splattie
> - Meshes and point clouds: .glb, .gltf, .obj, .ply, .pcd
> - HTML reports (Plotly, ydata-profiling, W&B) with their charts running live
> - Jupyter notebooks, keeping the interactive outputs GitHub strips
> - Model files: .safetensors, .gguf, and a graph view for .onnx
> - Tables: .parquet, .arrow, .feather
> - Arrays: .npy, .npz
> - Scientific images: .exr, .hdr, .tiff
>
> Because it rides your existing GitHub session, it previews files in private
> repositories too. There is no service, no upload, and no access token.
>
> Privacy first: octoview collects no data, has no analytics, and never contacts
> any server other than GitHub. Untrusted file content is always rendered in a
> sandbox with no network access. Open source under the MIT license.

**Keywords** (max 100 characters, comma-separated):

> github,gaussian splat,3d,notebook,jupyter,parquet,onnx,safetensors,preview,ml,developer

**Privacy:** Data Not Collected. No tracking.

---

## Firefox AMO

**Name:** octoview

**Summary** (max 250 characters):

> Preview the files GitHub won't. octoview adds a Preview button on any GitHub file page and renders 3D Gaussian splats, notebooks, HTML reports, Parquet, ONNX graphs, arrays and scientific images inline. Works on private repos. No upload, no account.

**Description:**

> (Same body as the Chrome description above.)

**Categories:** Developer Tools

**Tags:** github, gaussian-splatting, jupyter, parquet, onnx, developer-tools

**License:** MIT

**Privacy policy:** octoview collects no data. It makes no network request to any
host other than GitHub, stores nothing, and has no analytics or telemetry. Link to
`SECURITY.md` in the repository once public.

**Notes for reviewers / source code:** This add-on vendors minified third-party
libraries (three.js, Plotly, hyparquet, flechette, fflate + fzstd, marked). A
source package with exact build instructions is provided separately. See
`store/REVIEWERS.md` (also included in the source zip). Every vendored bundle is
rebuilt from a lockfile-pinned npm dependency by `scripts/vendor.sh`; nothing is
fetched from a CDN.

**Known limitation to disclose:** the `.rad` splat format renders only through the
bundled Spark viewer, which requires blob-URL workers that Firefox's extension-page
CSP does not permit, so `.rad` previews are unavailable on Firefox (every other
format works). Live HTML reports fall back to a static render for the same reason.
