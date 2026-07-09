#!/usr/bin/env bash
# Rebuild the vendored, self-contained libs the viewer loads. Re-run to refresh.
# The outputs are committed so the extension is self-contained; this script just
# regenerates them. Needs devDeps installed (npm install) for the three.js bundle.
set -euo pipefail
cd "$(dirname "$0")/.."

# marked: markdown -> HTML (used by the markdown and notebook renderers)
curl -fsSL https://cdn.jsdelivr.net/npm/marked/marked.min.js \
  -o extension/vendor/marked.min.js

# splattie-widget: Gaussian splats (used by the 3D splat phase)
cp /Users/afromero/Code/splattie/packages/splattie-widget/dist/splattie-widget.cdn.js \
  extension/vendor/splattie-widget.cdn.js

# three.js mesh + point-cloud loaders, bundled into one classic script (window.OV3D)
mkdir -p build
cat > build/three3d.entry.mjs <<'JS'
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { PCDLoader } from 'three/examples/jsm/loaders/PCDLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ViewHelper } from 'three/examples/jsm/helpers/ViewHelper.js';
window.OV3D = { THREE, GLTFLoader, OBJLoader, PLYLoader, PCDLoader, OrbitControls, ViewHelper };
JS
npx esbuild build/three3d.entry.mjs --bundle --format=iife --minify \
  --outfile=extension/vendor/three3d.js

echo "vendored: marked.min.js, splattie-widget.cdn.js, three3d.js"
