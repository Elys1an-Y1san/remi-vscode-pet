#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p native/build
xcrun swiftc native/PetCore.swift test/PetCoreTests.swift -o native/build/core-tests
native/build/core-tests
