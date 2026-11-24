# Installs a new version of the app while it runs as a service.
#
#   1. Unzip the new version over D:\sgfd-nexus\app (replace files).
#   2. In PowerShell as Administrator:
#        cd D:\sgfd-nexus\app
#        powershell -ExecutionPolicy Bypass -File .\scripts\update.ps1
#
# It stops the service, installs any new packages, builds, starts the service
# again (applying database updates), and shows the log if anything goes wrong.
# The app is unavailable for about a minute.

$ErrorActionPreference = "Stop"
$ServiceName = "SGFDApp"
$AppDir  = Split-Path -Parent $PSScriptRoot
$SgfdDir = Split-Path -Parent $AppDir
$Nssm    = Join-Path $SgfdDir "tools\nssm\nssm.exe"
$Log     = Join-Path $SgfdDir "logs\sgfd-app.log"

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host "`n$text" -ForegroundColor Red; exit 1 }

# Stops the service; if it hangs, ends its processes so the update can go on.
function Stop-App {
  $svc = Get-Service -Name $ServiceName
  if ($svc.Status -eq "Stopped") { Write-Host "Already stopped."; return }
  $old = $ErrorActionPreference; $ErrorActionPreference = "Continue"
  & sc.exe stop $ServiceName 2>&1 | Out-Null
  for ($i = 0; $i -lt 40; $i++) {
    if ((Get-Service -Name $ServiceName).Status -eq "Stopped") { $ErrorActionPreference = $old; Write-Host "Stopped."; return }
    Start-Sleep -Milliseconds 500
  }
  Write-Host "The service didn't stop on its own after 20 seconds. Ending it..." -ForegroundColor Yellow
  $wmi = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'"
  if ($wmi -and $wmi.ProcessId) { & taskkill.exe /PID $wmi.ProcessId /T /F 2>&1 | Out-Null }
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like "*server\index.js*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  for ($i = 0; $i -lt 20; $i++) {
    if ((Get-Service -Name $ServiceName).Status -eq "Stopped") { $ErrorActionPreference = $old; Write-Host "Stopped."; return }
    Start-Sleep -Milliseconds 500
  }
  $ErrorActionPreference = $old
  Fail "The service is still stopping. Restart the computer, then run this script again."
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Fail "Run this from PowerShell opened with 'Run as administrator'." }
if (-not (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) { Fail "The SGFD App service isn't installed. Run scripts\install-service.ps1 first." }

Step "Stopping the app"
Stop-App

# Make future stops quick (older installs waited longer than needed)
if (Test-Path $Nssm) {
  # Optional; some NSSM builds don't know every setting, so a refusal here isn't an error
  $old = $ErrorActionPreference; $ErrorActionPreference = "Continue"
  foreach ($m in "AppStopMethodConsole", "AppStopMethodWindow", "AppStopMethodThreads") { & $Nssm set $ServiceName $m 1500 2>&1 | Out-Null }
  & $Nssm set $ServiceName AppKillProcessTree 1 2>&1 | Out-Null
  $ErrorActionPreference = $old
}

# npm: on PATH, or next to node (the updater runs this as SYSTEM, whose PATH can differ)
$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) {
  $npm = @((Join-Path $SgfdDir "nodejs\npm.cmd"), (Join-Path $env:ProgramFiles "nodejs\npm.cmd")) | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $npm) { Start-Service -Name $ServiceName; Fail "npm wasn't found (looked on PATH, $SgfdDir\nodejs and Program Files\nodejs). Nothing was changed; the app was started again." }

Push-Location $AppDir
try {
  # New or changed packages?
  $pkg = Get-Item "package.json"
  $mods = Get-Item "node_modules" -ErrorAction SilentlyContinue
  if (-not $mods -or $pkg.LastWriteTime -gt $mods.LastWriteTime) {
    Step "Installing packages"
    & $npm install
    if ($LASTEXITCODE) { Start-Service -Name $ServiceName; Fail "npm install failed. The previous version was started again." }
  }

  Step "Building"
  & $npm run build
  if ($LASTEXITCODE) { Fail "The build failed (see above). The app is stopped; fix the problem and run update again." }
} finally { Pop-Location }

Step "Starting the app"
$mark = (Get-Item $Log -ErrorAction SilentlyContinue).Length
Start-Service -Name $ServiceName
Start-Sleep -Seconds 6
$svc = Get-Service -Name $ServiceName
if ($svc.Status -ne "Running") { Fail "The service didn't start. Check $Log" }

# Show what the server printed while starting (database updates, errors)
if (Test-Path $Log) {
  $text = Get-Content $Log -Raw
  if ($mark -and $text.Length -gt $mark) { $text = $text.Substring([int]$mark) }
  $lines = ($text -split "`r?`n") | Where-Object { $_ -match "Database updated|running at|Error|error|Can't" } | Select-Object -Last 15
  if ($lines) { $lines | ForEach-Object { Write-Host "  $_" } }
}

Write-Host "`nUpdated and running." -ForegroundColor Green
Write-Host "Save this version:  git add .  then  git commit -m `"Update`""
