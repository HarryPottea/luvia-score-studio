@echo off
powershell.exe -NoProfile -File "%~dp0Add-Voice.ps1"
if errorlevel 1 pause
