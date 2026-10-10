#!/usr/bin/env bash
#
# One-command TestFlight release for Finny.
#
#   ./release.sh
#
# Bumps the build number, regenerates the Xcode project, archives, exports a
# distribution-signed .ipa, and uploads it to App Store Connect / TestFlight.
#
# Requirements (one-time):
#   - App Store Connect API key .p8 in ~/private_keys/AuthKey_<KEY_ID>.p8
#   - ASC_ISSUER_ID exported (App Store Connect → Users and Access → Integrations)
#   - Xcode signed in to team 9U72AVU3KH (Settings → Accounts)
#
set -euo pipefail
cd "$(dirname "$0")"

KEY_ID="${ASC_KEY_ID:-U3K949UW4G}"
ISSUER_ID="${ASC_ISSUER_ID:?export ASC_ISSUER_ID first}"
# Signing uses the Apple ID signed in to Xcode (the API key lacks cloud-signing rights);
# the API key is only used for the upload.

# --- bump build number ---
CURRENT=$(grep -m1 'CURRENT_PROJECT_VERSION:' project.yml | sed 's/[^0-9]//g')
NEXT=$((CURRENT + 1))
sed -i '' "s/CURRENT_PROJECT_VERSION: \"${CURRENT}\"/CURRENT_PROJECT_VERSION: \"${NEXT}\"/" project.yml
echo "==> build ${CURRENT} -> ${NEXT}"

# --- generate, archive, export, upload ---
rm -rf build/Finny.xcarchive build/export
xcodegen generate

echo "==> archiving..."
xcodebuild -project Finny.xcodeproj -scheme Finny -configuration Release \
  -destination 'generic/platform=iOS' -archivePath build/Finny.xcarchive -allowProvisioningUpdates archive

echo "==> exporting..."
xcodebuild -exportArchive -archivePath build/Finny.xcarchive \
  -exportOptionsPlist ExportOptions.plist -exportPath build/export -allowProvisioningUpdates

echo "==> uploading to TestFlight..."
xcrun altool --upload-app -f build/export/Finny.ipa -t ios --apiKey "$KEY_ID" --apiIssuer "$ISSUER_ID"

echo "==> done. Build ${NEXT} uploaded; it appears in TestFlight after processing (~5-15 min)."
