@echo off
setlocal
cd /d "%~dp0"
title Pasang Antigravity Assistant

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js belum terpasang. Pasang dulu dari https://nodejs.org lalu jalankan file ini lagi.
  pause
  exit /b 1
)

if not exist node_modules\electron (
  echo Memasang dependensi, tunggu sebentar...
  call npm install
  if errorlevel 1 (
    echo npm install gagal. Cek koneksi internet lalu coba lagi.
    pause
    exit /b 1
  )
)

if not exist .env (
  copy /y .env.example .env >nul
  echo.
  echo File .env dibuat.
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-windows.ps1"
if errorlevel 1 (
  pause
  exit /b 1
)

echo.
echo Selesai! Tekan Win+R, ketik: aero (atau antigravity) lalu Enter.
echo Menjalankan Antigravity Assistant sekarang...
start "" wscript.exe //nologo "%~dp0antigravity-launcher.vbs"
timeout /t 2 >nul
