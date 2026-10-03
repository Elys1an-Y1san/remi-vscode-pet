#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
test_root="$(mktemp -d "${TMPDIR:-/tmp}/remi-host-test.XXXXXX")"
code_bin="${REMI_CODE_BIN:-/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code}"
REMI_TEST_REPORT="$test_root/report.json" "$code_bin" --wait --extensionDevelopmentPath="$PWD" --extensionTestsPath="$PWD/test/host.js" \
  --user-data-dir="$test_root/user" --extensions-dir="$test_root/extensions" \
  --skip-welcome --skip-release-notes --disable-workspace-trust "$PWD"
test -f "$test_root/report.json"
cp "$test_root/report.json" evidence/extension-host.json
