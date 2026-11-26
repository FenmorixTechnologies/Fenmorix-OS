# One time, on the server, in PowerShell opened with "Run as administrator":
#   cd D:\sgfd-nexus\app
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-updater.ps1
#
# Makes the "SGFD Nexus Update" scheduled task (runs as SYSTEM, only when Nexus starts it; no schedule). After this, a master
# admin can install updates, restart the service, roll back and run a backup from Nexus: User Management > System.
# The task runs a copy of apply-update.ps1 kept in D:\sgfd-nexus\tools\updater (refreshed after each successful update).
$ErrorActionPreference = "Stop"
$AppDir  = Split-Path -Parent $PSScriptRoot
$SgfdDir = Split-Path -Parent $AppDir
$TaskName = "SGFD Nexus Update"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Write-Host "Run this from PowerShell opened with 'Run as administrator'." -ForegroundColor Red; exit 1 }
if (-not (Get-Service -Name "SGFDApp" -ErrorAction SilentlyContinue)) { Write-Host "The SGFD App service isn't installed (scripts\install-service.ps1)." -ForegroundColor Red; exit 1 }

$tools = Join-Path $SgfdDir "tools\updater"
New-Item -ItemType Directory -Force -Path $tools, (Join-Path $SgfdDir "updates") | Out-Null
Copy-Item (Join-Path $PSScriptRoot "apply-update.ps1") $tools -Force
# Only administrators and SYSTEM may change what the task runs, or the update folder
& icacls.exe $tools /inheritance:r /grant:r "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" | Out-Null
& icacls.exe (Join-Path $SgfdDir "updates") /inheritance:r /grant:r "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" | Out-Null

$script = Join-Path $tools "apply-update.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`" -SgfdDir `"$SgfdDir`""
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
Register-ScheduledTask -TaskName $TaskName -Action $action -Settings $settings -Principal $principal -Force | Out-Null

Write-Host "Made the '$TaskName' task." -ForegroundColor Green
Write-Host "In the app: User Management > System. Installing, restarting and rolling back there need a code from your authenticator."
