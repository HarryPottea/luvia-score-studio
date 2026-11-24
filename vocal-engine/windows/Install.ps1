$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$yes=[System.Windows.Forms.MessageBox]::Show('Install J-WOO for this Windows account? The official Chiaki voice (~451 MB) will be downloaded and the engine will run at login. No subscription.', 'J-WOO Vocal Engine', 'OKCancel', 'Information')
if($yes -ne 'OK'){exit}
Start-Process 'https://chiaki.ch/en/character/chiaki'
$yes=[System.Windows.Forms.MessageBox]::Show('Confirm you have read and accept the Chiaki terms, including Vocal: Chiaki credit. Install now?', 'Model terms', 'YesNo', 'Question')
if($yes -ne 'Yes'){exit}
& "$PSScriptRoot\runtime\node.exe" "$PSScriptRoot\setup.mjs" "$PSScriptRoot"
if($LASTEXITCODE -ne 0){throw 'Installation failed'}
Start-Process 'https://harrypottea.github.io/luvia-score-studio/'
[System.Windows.Forms.MessageBox]::Show('Installed. Approve the connection in Vocal Studio. To register a licensed male Korean voice, run Add-Voice.cmd.', 'J-WOO') | Out-Null
