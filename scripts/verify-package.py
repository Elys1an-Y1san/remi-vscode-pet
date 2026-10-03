"""Verify packaged bytes without publishing account IDs or local filesystem paths."""
import hashlib
import json
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent.parent
package = root / "remi-companion.vsix"
asset = root / "assets/remi.png"
with zipfile.ZipFile(package) as archive:
    for relative in ["assets/remi.png", "src/extension.js", "src/activity.js", "src/codex.js", "src/attachments.js",
                     "native/build/RemiOverlay.app/Contents/MacOS/RemiOverlay"]:
        assert archive.read("extension/" + relative) == (root / relative).read_bytes(), relative
    assert not any("node_modules/" in name or "evidence/" in name for name in archive.namelist())
    manifest = json.loads(archive.read("extension/package.json"))
report = {
    "version": manifest["version"],
    "assetSHA256": hashlib.sha256(asset.read_bytes()).hexdigest(),
    "packageSHA256": hashlib.sha256(package.read_bytes()).hexdigest(),
    "packageBytes": package.stat().st_size,
    "originalAssetUnchanged": hashlib.sha256(asset.read_bytes()).hexdigest() == "d76b1beca002be412ce372aef78a592b27b238bea56e4412fb3e4c6f5efc9d8f",
    "sourceAndBinaryMatchPackage": True,
    "target": "darwin-arm64",
    "runtimeDependencies": len(manifest.get("dependencies", {})),
}
assert report["originalAssetUnchanged"]
(root / "evidence/package-verification.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
