# Removes the "SGFD App" Windows service. Your data, settings and files are not touched;
# you can still run the app by hand with  npm start .
#
#   powershell -ExecutionPolicy Bypass -File .\scripts\uninstall-service.ps1   (as Administrator)

$ErrorActionPreference = "Stop"
$ServiceName = "SGFDApp"
$Nssm = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) "tools\nssm\nssm.exe"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Write-Host "Run this from PowerShell opened with 'Run as administrator'." -ForegroundColor Red; exit 1 }

if (-not (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) { Write-Host "The SGFD App service isn't installed."; exit 0 }
Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
if (Test-Path $Nssm) { & $Nssm remove $ServiceName confirm | Out-Null } else { sc.exe delete $ServiceName | Out-Null }
Write-Host "The SGFD App service was removed." -ForegroundColor Green
