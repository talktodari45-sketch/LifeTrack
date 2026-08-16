@echo off
title LifeTrack MongoDB sync server
cd /d "%~dp0"
echo Starting LifeTrack sync server...
echo Make sure .env (MONGO_URL) is configured - see readme.md.
echo.
call npm start
echo.
echo Server stopped. Close this window.
pause
