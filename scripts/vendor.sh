#!/usr/bin/env bash
# Vendor the two self-contained libs the renderers use (Phase 1b/1c).
# Re-run to refresh. Kept in git so the extension is self-contained.
set -euo pipefail
cd "$(dirname "$0")/.."

cp /Users/afromero/Code/splattie/packages/splattie-widget/dist/splattie-widget.cdn.js \
  extension/vendor/splattie-widget.cdn.js
curl -fsSL https://cdn.jsdelivr.net/npm/marked/marked.min.js \
  -o extension/vendor/marked.min.js

echo "vendored: splattie-widget.cdn.js ($(du -h extension/vendor/splattie-widget.cdn.js | cut -f1)), marked.min.js"
