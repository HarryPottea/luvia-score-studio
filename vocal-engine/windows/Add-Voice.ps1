$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName Microsoft.VisualBasic
$root=Join-Path $env:LOCALAPPDATA 'J-WOO Vocal Engine\v1'
$f=New-Object Windows.Forms.OpenFileDialog
$f.Filter='DiffSinger ZIP (*.zip)|*.zip'
if($f.ShowDialog() -ne 'OK'){exit}
$male=[Windows.Forms.MessageBox]::Show('Is this an independently trained male Korean DiffSinger model? Choose No for female.', 'Voice type','YesNoCancel','Question')
if($male -eq 'Cancel'){exit}
$gender=if($male -eq 'Yes'){[string][char]0xB0A8+[char]0xC131}else{[string][char]0xC5EC+[char]0xC131}
$credit=[Microsoft.VisualBasic.Interaction]::InputBox('Official voice credit','J-WOO')
$terms=[Microsoft.VisualBasic.Interaction]::InputBox('Official HTTPS terms URL','J-WOO','https://')
if($terms -notmatch '^https://[^ ]+$'){throw 'Invalid terms URL'}
Start-Process $terms
if([Windows.Forms.MessageBox]::Show('Confirm official model archive, Korean support, and permission for your intended use, including commercial or religious use where applicable.','Model rights','YesNo','Question') -ne 'Yes'){exit}
& "$root\runtime\node.exe" "$root\voice-import.mjs" $f.FileName $gender $credit $terms I_HAVE_RIGHTS
if($LASTEXITCODE -ne 0){throw 'Model import failed'}
