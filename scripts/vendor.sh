#!/usr/bin/env bash
# Rebuild the vendored, self-contained libs the renderers load. Re-run to refresh.
# The outputs are committed so the extension is self-contained; this script just
# regenerates them. Needs devDeps installed (npm install) for the bundles.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build

# marked: markdown -> HTML (used by the notebook renderer, loaded as a content script)
curl -fsSL https://cdn.jsdelivr.net/npm/marked/marked.min.js \
  -o extension/vendor/marked.min.js

# three.js + loaders (mesh/point-cloud/EXR/HDR/TIFF) as an ES module, lazy-imported
# by render3d.js / render-image.js / render-splat.js.
cat > build/three3d.entry.mjs <<'JS'
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { PCDLoader } from 'three/examples/jsm/loaders/PCDLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ViewHelper } from 'three/examples/jsm/helpers/ViewHelper.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { TIFFLoader } from 'three/examples/jsm/loaders/TIFFLoader.js';
export {
  THREE, GLTFLoader, OBJLoader, PLYLoader, PCDLoader, OrbitControls, ViewHelper,
  EXRLoader, RGBELoader, TIFFLoader,
};
JS
npx esbuild build/three3d.entry.mjs --bundle --format=esm --minify \
  --outfile=extension/vendor/three3d.esm.js

# hyparquet: pure-JS parquet reader, ES module, lazy-imported by render-table.js.
cat > build/hyparquet.entry.mjs <<'JS'
export { parquetReadObjects, parquetMetadata } from 'hyparquet';
JS
npx esbuild build/hyparquet.entry.mjs --bundle --format=esm --minify \
  --outfile=extension/vendor/hyparquet.esm.js

# plotly (cartesian traces: scatter/bar/histogram/heatmap/box/contour/pie) as an
# ES module, lazy-imported by content.js only when a notebook output carries a
# Plotly MIME bundle.
# ponytail: cartesian bundle; swap to plotly.js-dist-min if 3D/geo traces are needed
cat > build/plotly.entry.mjs <<'JS'
import Plotly from 'plotly.js-cartesian-dist-min';
export default Plotly;
JS
npx esbuild build/plotly.entry.mjs --bundle --format=esm --minify \
  --outfile=extension/vendor/plotly.esm.js

# Spark (@sparkjsdev/spark): full Gaussian-splat renderer. three is a peer dep so
# esbuild dedupes it to one copy; the worker (inline blob) and WASM (inline
# base64) come from the prebuilt dist. Runs in the splat-viewer extension page,
# whose CSP allows workers + WASM. Lazy-loaded there only for splats.
cat > build/spark.entry.mjs <<'JS'
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
export { THREE, OrbitControls, SparkRenderer, SplatMesh };
JS
npx esbuild build/spark.entry.mjs --bundle --format=esm --minify \
  --outfile=extension/vendor/spark.esm.js

echo "vendored: marked.min.js, three3d.esm.js, hyparquet.esm.js, plotly.esm.js, spark.esm.js"
