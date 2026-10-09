#!/bin/bash
# Builds build/AATCE Kiosk.app and build/AATCE-Kiosk.zip from this Swift package.
#
#   ./scripts/build-app.sh                         # app without the face model
#   ./scripts/build-app.sh path/to/FaceNet.mlpackage  # app with the model bundled
#
# The app is ad-hoc signed. On the lab iMac: unzip, move to /Applications,
# right-click → Open the first time (it is not notarized).
set -euo pipefail
cd "$(dirname "$0")/.."

swift build -c release --product AATCEKiosk
BIN="$(swift build -c release --show-bin-path)/AATCEKiosk"
APP="build/AATCE Kiosk.app"

rm -rf "$APP" build/AATCE-Kiosk.zip
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/AATCEKiosk"
cp AppBundle/Info.plist "$APP/Contents/Info.plist"

if [ $# -ge 1 ]; then
  xcrun coremlcompiler compile "$1" "$APP/Contents/Resources/"
fi

codesign --force --deep --sign - "$APP"
(cd build && ditto -c -k --keepParent "AATCE Kiosk.app" AATCE-Kiosk.zip)
echo "Built $APP"
