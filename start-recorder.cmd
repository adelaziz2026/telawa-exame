@echo off
rem Starts the app so the phone app can send surah recordings over the home Wi-Fi.
rem Windows may ask to allow Node.js: allow it for private networks only.
chcp 65001 >nul
cd /d "%~dp0"
set HOST=0.0.0.0
set RECORD_LAN=1
echo.
echo Write one of these addresses in the phone app (computer address):
node -e "const o=require('os').networkInterfaces();for(const n of Object.values(o).flat())if(n.family==='IPv4'&&!n.internal)console.log('   '+n.address+':8787')"
echo.
start "" http://localhost:8787/recordings.html
node server.cjs
pause
