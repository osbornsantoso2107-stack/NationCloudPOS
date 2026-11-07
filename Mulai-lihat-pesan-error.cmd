@echo off
chcp 65001 >nul
title nationcloudPOS (mode jendela hitam - untuk melihat pesan error)
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js belum terpasang.
  echo Unduh "LTS" dari https://nodejs.org lalu pasang, kemudian jalankan file ini lagi.
  pause
  exit /b 1
)

rem Buka browser bawaan komputer (Chrome / Edge / Firefox, mana pun yang jadi default)
start "" /min cmd /c "timeout /t 2 >nul & start "" http://localhost:8780"

echo nationcloudPOS - jangan tutup jendela ini selama toko buka.
echo Jika browser tidak terbuka sendiri, buka browser lalu ketik:  localhost:8780
echo.
node --disable-warning=ExperimentalWarning server.js
echo.
echo Server berhenti. Jika ada pesan kesalahan di atas, foto/salin dan tunjukkan ke Claude.
pause
