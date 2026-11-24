#!/bin/bash
# Installs the YouTube Import extension for After Effects (current user).
set -e
cd "$(dirname "$0")"

SRC="extension"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/com.zeph.youtubeimport"

if [ ! -f "$SRC/CSXS/manifest.xml" ]; then
  echo "Can't find the 'extension' folder next to this file."
  exit 1
fi

echo "Copying extension to:"
echo "  $DEST"
rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
cp -R "$SRC" "$DEST"
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

# The extension isn't signed, so let After Effects load unsigned extensions.
for v in 9 10 11 12 13; do
  defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1
done
killall cfprefsd 2>/dev/null || true

echo
echo "Done. Restart After Effects, then open Window > Extensions > YouTube Import."
