@echo off
:: =====================================================================
:: Antigravity Companion Daemon Launcher
:: =====================================================================
title Antigravity Companion Daemon Server
color 0B

echo.
echo   =============================================================
echo       ___          __  _                     __  _            
echo      / _ \___ ___ / /_/ /____ ___ _  ___ ___/ /_(_)______ ____
echo     / _  / _ `(_-^</ __/ __/ _ `/ _ \/ _ `/ _  / / / __/ _ `/ _ \
echo    /_//_/\_,_/___/\__/\__/\_,_/_//_/\_,_/\_,_/_/_/\__/\_,_/_//_/
echo                                                               
echo                - COMPANION DAEMON BACKEND LAUNCHER -
echo   =============================================================
echo.

:: Navigate to the directory containing this script
cd /d "%~dp0"

:: Check if .NET SDK is installed and available
where dotnet >nul 2>nul
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] .NET SDK nao foi encontrado no seu sistema!
    echo Por favor, instale o .NET SDK 8.0 para executar o backend.
    echo Download: https://dotnet.microsoft.com/download/dotnet/8.0
    echo.
    pause
    exit /b 1
)

echo [INFO] A iniciar o servidor daemon C# .NET...
echo [INFO] Servidor disponivel localmente em http://localhost:5117
echo [INFO] Pressione [Ctrl + C] a qualquer momento para desligar o servidor.
echo.
echo -------------------------------------------------------------

:: Run the daemon API project
dotnet run --project daemon\AntigravityDaemon.Api\AntigravityDaemon.Api.csproj

echo.
echo -------------------------------------------------------------
echo [INFO] Servidor desligado.
pause
