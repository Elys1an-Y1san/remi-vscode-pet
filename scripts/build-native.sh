#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p native/build/RemiOverlay.app/Contents/MacOS native/build/RemiOverlay.app/Contents/Resources
xcrun swiftc -O -target arm64-apple-macosx13.0 native/PetCore.swift native/main.swift -o native/build/RemiOverlay.app/Contents/MacOS/RemiOverlay -framework AppKit -framework QuartzCore
cp native/Info.plist native/build/RemiOverlay.app/Contents/Info.plist
codesign --force --sign - native/build/RemiOverlay.app
