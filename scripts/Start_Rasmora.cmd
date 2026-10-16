@echo off
title Rasmora Studio
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required to use this launcher.
  echo You can also serve this folder with another static web server.
  pause
  exit /b 1
)
echo Open http://127.0.0.1:8787 in Edge or Chrome after the server starts.
echo Keep this window open. Press Ctrl+C to stop the server.
echo Offline drawing works without an API key.
node ai-bridge.cjs
pause
