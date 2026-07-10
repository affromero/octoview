#!/bin/bash
# Regenerate the Safari app wrapper from extension/ and archive it for the Mac
# App Store. Safari/ is converter output — gitignored and disposable — so team
# and signing settings live HERE, not in the generated pbxproj.
set -euo pipefail
cd "$(dirname "$0")/.."

TEAM_ID=2HVQQ4W769
# Version comes from the manifest (single source of truth); the build number is
# the git commit count, which always increases so App Store accepts each upload.
VERSION="$(node -p "require('./extension/manifest.json').version")"
BUILD="$(git rev-list --count HEAD)"

xcrun safari-web-extension-converter extension/ \
  --macos-only --bundle-identifier co.afromero.octoview \
  --project-location ./Safari --no-open --force

# The converter leaves the app-icon slots empty, which App Store review rejects.
# Fill them from assets/logo.svg (Safari/ is regenerated, so this runs each time).
ICONSET="$(find Safari -type d -name AppIcon.appiconset | head -1)"
node scripts/appicon.mjs "$ICONSET"

xcodebuild -project Safari/octoview/octoview.xcodeproj \
  -scheme octoview -configuration Release \
  -archivePath build/octoview.xcarchive \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  MARKETING_VERSION="$VERSION" CURRENT_PROJECT_VERSION="$BUILD" \
  INFOPLIST_KEY_LSApplicationCategoryType=public.app-category.developer-tools \
  -allowProvisioningUpdates archive

echo "built version $VERSION (build $BUILD)"

echo "archive at build/octoview.xcarchive — open in Xcode Organizer to upload,"
echo "or: xcodebuild -exportArchive -archivePath build/octoview.xcarchive \\"
echo "      -exportOptionsPlist scripts/export-appstore.plist -exportPath build/"
