@echo off
chcp 65001 >nul
"%~dp0runtime\node.exe" "%~dp0start-beta.mjs" --add-voice
if errorlevel 1 pause
