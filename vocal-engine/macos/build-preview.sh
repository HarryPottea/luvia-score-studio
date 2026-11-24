#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/artifacts/vocal-mac"
WORK="$(mktemp -d)"
WORK="$(cd "$WORK" && pwd -P)"
ROOT="$(cd "$ROOT" && pwd -P)"
trap 'rm -rf "$WORK"' EXIT
[[ "$(uname -s)" = Darwin ]] || { echo "macOS build host required"; exit 1; }
case "$(uname -m)" in arm64) RID=osx-arm64;; x86_64) RID=osx-x64;; *) exit 1;; esac
UPSTREAM=08222cb7c48c4ab47faa34a6efc34e2c00898a1e
git init -q "$WORK/OpenUtau"
git -C "$WORK/OpenUtau" remote add origin https://github.com/openutau/OpenUtau.git
git -C "$WORK/OpenUtau" fetch --depth 1 origin "$UPSTREAM"
git -C "$WORK/OpenUtau" checkout --detach FETCH_HEAD
[[ "$(git -C "$WORK/OpenUtau" rev-parse HEAD)" = "$UPSTREAM" ]]
# Patch ONLY the isolated build copy; do not use existing ~/Library/OpenUtau.
python3 "$ROOT/vocal-engine/native/prepare-upstream.py" "$WORK/OpenUtau"
STAGE="$WORK/stage"
mkdir -p "$STAGE/engine" "$STAGE/src" "$STAGE/runtime" "$STAGE/licenses" "$STAGE/vocal-engine" "$OUT"
SDK="$(dotnet --list-sdks | awk '$1 ~ /^10\.0\.[0-9]+$/ {v=$1} END {print v}')"
[[ -n "$SDK" ]]
printf '{"sdk":{"version":"%s","rollForward":"disable"}}\n' "$SDK" > "$WORK/global.json"
PROJECT="$ROOT/vocal-engine/native/JwooRender.csproj"
(
 cd "$WORK"
 dotnet --version
 dotnet restore "$PROJECT" -r "$RID" -p:OpenUtauRoot="$WORK/OpenUtau" --disable-parallel -m:1
 dotnet publish "$PROJECT" -c Release -r "$RID" --self-contained true --no-restore -p:OpenUtauRoot="$WORK/OpenUtau" -m:1 -o "$STAGE/engine"
)
# Vendor the exact runtime supplied by the CI toolchain; keep distribution notices.
NODE="$(command -v node)"
cp "$NODE" "$STAGE/runtime/node"
NODE_ROOT="$(cd "$(dirname "$NODE")/.." && pwd)"
[[ -f "$NODE_ROOT/LICENSE" ]] || { echo "Node license missing"; exit 1; }
cp "$NODE_ROOT/LICENSE" "$STAGE/licenses/Node-LICENSE.txt"
cp "$WORK/OpenUtau/LICENSE.txt" "$STAGE/licenses/OpenUtau-LICENSE.txt"
# Preserve native dependency license/notice files available from restored packages.
find "$HOME/.nuget/packages" -type f \( -iname 'license*' -o -iname 'notice*' \) -size -2M -print0 | while IFS= read -r -d '' f; do rel="${f#"$HOME/.nuget/packages/"}"; mkdir -p "$STAGE/licenses/nuget/$(dirname "$rel")"; cp "$f" "$STAGE/licenses/nuget/$rel"; done
cp "$ROOT/src/vocal-core.js" "$STAGE/src/"
cp "$ROOT/vocal-engine/server.mjs" "$STAGE/vocal-engine/"
printf '{"type":"module"}\n' > "$STAGE/package.json"
"$STAGE/runtime/node" --check "$STAGE/vocal-engine/server.mjs"
cp "$ROOT/vocal-engine/macos/setup.mjs" "$STAGE/"
cp "$ROOT/vocal-engine/voice-import.mjs" "$STAGE/"
cp "$ROOT/vocal-engine/macos/Add-Voice.command" "$STAGE/"
chmod +x "$STAGE/Add-Voice.command"
cp "$ROOT/vocal-engine/macos/Install.command" "$STAGE/"
chmod +x "$STAGE/Install.command" "$STAGE/runtime/node" "$STAGE/engine/JwooRender"
# Native discovery must run against a clean temporary isolated profile, never a real user's data.
JWOO_ENGINE_DATA="$WORK/smoke" "$STAGE/engine/JwooRender" list > "$WORK/list.json"
"$STAGE/runtime/node" -e 'const a=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(!Array.isArray(a)||a.length)process.exit(1)' "$WORK/list.json"
# Unsigned internal test artifact, NOT public release or automatic installation.
hdiutil create -quiet -ov -volname "J-WOO Vocal Engine Preview" -srcfolder "$STAGE" -format UDZO "$OUT/J-WOO-Vocal-Engine-$RID-preview.dmg"
shasum -a 256 "$OUT/J-WOO-Vocal-Engine-$RID-preview.dmg" > "$OUT/J-WOO-Vocal-Engine-$RID-preview.dmg.sha256"
