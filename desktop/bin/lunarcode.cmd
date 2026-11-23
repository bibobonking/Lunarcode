@echo off
setlocal
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0..\..\..\Lunarcode.exe" "%~dp0..\server\cli.mjs" %*
exit /b %errorlevel%
