# Octoview for VS Code

Preview Gaussian splats, meshes, point clouds, arrays, tables, model metadata,
scientific images, notebooks and HTML reports directly in VS Code.

Right-click a supported file in the Explorer and choose **Octoview: Open Preview**.
You can also use **Reopen Editor With... > Octoview Preview** or run
**Octoview: Open Preview** from the Command Palette for the active file.
The preview is read-only and opt-in. Use **Refresh** to read changes saved to disk.

Supported extensions: `.html`, `.htm`, `.ipynb`, `.glb`, `.gltf`, `.obj`, `.ply`,
`.pcd`, `.npy`, `.npz`, `.parquet`, `.arrow`, `.feather`, `.ipc`, `.safetensors`,
`.gguf`, `.onnx`, `.exr`, `.hdr`, `.tif`, `.tiff`, `.splat`, `.spz`, `.ksplat`,
`.sog` and `.lcc`.

LCC needs `index.bin` and `data.bin` beside the metadata file. glTF assets must
be self-contained. Reports and notebook HTML outputs show static content in
sandboxed frames. Notebook Plotly MIME outputs remain interactive.

Files stay on your machine or workspace host. There are no uploads, telemetry,
GitHub credentials, or external resource downloads. The webview can access only
packaged renderer assets. Reports cannot call VS Code APIs or run inline scripts.
Git LFS pointers need `git lfs pull` before previewing.

Normal files and each LCC companion have a 64 MiB limit. Local `.gguf` and
`.safetensors` files read only their first 32 MiB for metadata, so large weights
stay on disk. Other filesystem providers have a 32 MiB model limit because the
VS Code filesystem API cannot read byte ranges. Remote SSH workspaces run the
extension on their workspace host. Unsaved editor changes are not previewed.

Build from the [source repository](https://github.com/affromero/octoview):

```sh
npm ci
npm run build:vscode
code --install-extension build/octoview-vscode.vsix
```

Requires desktop VS Code 1.85 or newer and WebGL2 for 3D previews.
