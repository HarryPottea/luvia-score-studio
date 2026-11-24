$ErrorActionPreference = 'Stop'
$root = (Resolve-Path "$PSScriptRoot\..\..").Path
$work = Join-Path ([IO.Path]::GetTempPath()) ("jwoo-build-"+[guid]::NewGuid())
$stage = Join-Path $work stage
$out = Join-Path $root 'artifacts\vocal-windows'
$upstream = '08222cb7c48c4ab47faa34a6efc34e2c00898a1e'
function Check { if ($LASTEXITCODE -ne 0) { throw "Native command failed: $LASTEXITCODE" } }
New-Item -ItemType Directory -Force $work,$stage,$out | Out-Null
try {
  git init -q "$work\OpenUtau"; Check
  git -C "$work\OpenUtau" remote add origin https://github.com/openutau/OpenUtau.git; Check
  git -C "$work\OpenUtau" fetch --depth 1 origin $upstream; Check
  git -C "$work\OpenUtau" checkout --detach FETCH_HEAD; Check
  if ((git -C "$work\OpenUtau" rev-parse HEAD).Trim() -ne $upstream) { throw 'Upstream mismatch' }
  python "$root\vocal-engine\native\prepare-upstream.py" "$work\OpenUtau"; Check
  foreach ($d in 'engine','src','runtime','licenses','vocal-engine') { New-Item -ItemType Directory "$stage\$d" | Out-Null }
  dotnet publish "$root\vocal-engine\native\JwooRender.csproj" -c Release -r win-x64 --self-contained true "-p:OpenUtauRoot=$work\OpenUtau" -o "$stage\engine"; Check
  $node = (Get-Command node.exe).Source
  Copy-Item $node "$stage\runtime\node.exe"
  $license = Join-Path (Split-Path $node) 'LICENSE'
  if (!(Test-Path $license)) { throw 'Node license missing' }
  Copy-Item $license "$stage\licenses\Node-LICENSE.txt"
  Copy-Item "$work\OpenUtau\LICENSE.txt" "$stage\licenses\OpenUtau-LICENSE.txt"
  Copy-Item "$root\src\vocal-core.js" "$stage\src\"
  Copy-Item "$root\vocal-engine\server.mjs" "$stage\vocal-engine\"
  Copy-Item "$root\vocal-engine\windows\setup.mjs","$root\vocal-engine\windows\Install.ps1","$root\vocal-engine\windows\Install.cmd","$root\vocal-engine\windows\Add-Voice.ps1","$root\vocal-engine\windows\Add-Voice.cmd","$root\vocal-engine\voice-import.mjs" "$stage\"
  '{"type":"module"}' | Set-Content "$stage\package.json" -Encoding ascii
  $env:JWOO_ENGINE_DATA = "$work\smoke"
  $result = & "$stage\engine\JwooRender.exe" list; Check
  if (($result | ConvertFrom-Json).Count -ne 0) { throw 'Unexpected singers in fresh profile' }
  Compress-Archive -Path "$stage\*" -DestinationPath "$out\J-WOO-Vocal-Engine-win-x64-preview.zip" -Force
  (Get-FileHash "$out\J-WOO-Vocal-Engine-win-x64-preview.zip" -Algorithm SHA256).Hash | Set-Content "$out\J-WOO-Vocal-Engine-win-x64-preview.zip.sha256"
} finally { Remove-Item $work -Recurse -Force }
