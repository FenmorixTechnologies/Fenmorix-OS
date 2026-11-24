# Runs the SGFD app as a Windows service ("SGFD App") using NSSM.
#
# Run once, in PowerShell as Administrator, from the app folder:
#   cd D:\sgfd-nexus\app
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-service.ps1
#
# The service starts with Windows (after PostgreSQL), keeps running when you
# log out or lock the PC, restarts itself if it stops, and logs to D:\sgfd-nexus\logs.
# Running this again reinstalls the service with the same settings.

$ErrorActionPreference = "Stop"
$ServiceName = "SGFDApp"
$AppDir   = Split-Path -Parent $PSScriptRoot
$SgfdDir  = Split-Path -Parent $AppDir
$ToolsDir = Join-Path $SgfdDir "tools\nssm"
$Nssm     = Join-Path $ToolsDir "nssm.exe"
$LogDir   = Join-Path $SgfdDir "logs"

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host "`n$text" -ForegroundColor Red; exit 1 }

# --- Administrator?
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Fail "Run this from PowerShell opened with 'Run as administrator'." }

if (-not (Test-Path (Join-Path $AppDir "server\index.js"))) { Fail "Can't find the app in $AppDir. Run this from the app folder (D:\sgfd-nexus\app)." }
if (-not (Test-Path (Join-Path $AppDir ".env"))) { Fail "No .env file in $AppDir. Set up the app first (see README)." }

# --- Node
Step "Finding Node.js"
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) { Fail "Node.js isn't installed (or isn't on the PATH)." }
Write-Host "Node: $node ($(& $node -v))"

# --- NSSM (kept in D:\sgfd-nexus\tools\nssm, because the service runs from there)
Step "Getting NSSM"
if (-not (Test-Path $Nssm)) {
  New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null
  $zip = Join-Path $env:TEMP "nssm.zip"
  $urls = @("https://nssm.cc/ci/nssm-2.24-101-g897c7ad.zip", "https://nssm.cc/release/nssm-2.24.zip")
  foreach ($url in $urls) {
    try {
      Write-Host "Downloading $url"
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing -TimeoutSec 60
      $unpack = Join-Path $env:TEMP "nssm-unpack"
      if (Test-Path $unpack) { Remove-Item $unpack -Recurse -Force }
      Expand-Archive -Path $zip -DestinationPath $unpack -Force
      $exe = Get-ChildItem $unpack -Recurse -Filter nssm.exe | Where-Object { $_.FullName -match "win64" } | Select-Object -First 1
      if ($exe) { Copy-Item $exe.FullName $Nssm -Force; break }
    } catch { Write-Host "  didn't work: $($_.Exception.Message)" -ForegroundColor Yellow }
  }
  if (-not (Test-Path $Nssm)) {
    Write-Host "Trying winget instead..."
    try {
      winget install --id NSSM.NSSM -e --accept-source-agreements --accept-package-agreements | Out-Host
      $found = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages", "$env:ProgramFiles\WinGet\Packages" -Recurse -Filter nssm.exe -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match "win64" } | Select-Object -First 1
      if ($found) { Copy-Item $found.FullName $Nssm -Force }
    } catch { }
  }
  if (-not (Test-Path $Nssm)) {
    Fail ("Couldn't download NSSM. Download it from https://nssm.cc/download, open the zip, and copy " +
          "win64\nssm.exe to $Nssm. Then run this script again.")
  }
}
Write-Host "NSSM: $Nssm"

# --- PostgreSQL service (start the app after it)
$pg = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($pg) { Write-Host "Database service: $($pg.Name)" } else { Write-Host "No PostgreSQL service found on this PC; the app will start without waiting for it." -ForegroundColor Yellow }

# --- Build the app
Step "Building the app"
Push-Location $AppDir
try {
  if (-not (Test-Path "node_modules")) { & npm.cmd install; if ($LASTEXITCODE) { Fail "npm install failed." } }
  & npm.cmd run build
  if ($LASTEXITCODE) { Fail "The build failed (see above)." }
} finally { Pop-Location }

# --- Anything still using the port? (e.g. npm start left running in VS Code)
$port = 3000
$envLine = Select-String -Path (Join-Path $AppDir ".env") -Pattern '^\s*PORT\s*=\s*(\d+)' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($envLine) { $port = [int]$envLine.Matches[0].Groups[1].Value }

# --- (Re)install the service
Step "Installing the service"
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Replacing the existing service..."
  & sc.exe stop $ServiceName 2>&1 | Out-Null
  Start-Sleep -Seconds 5
  $wmi = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'"
  if ($wmi -and $wmi.ProcessId) { & taskkill.exe /PID $wmi.ProcessId /T /F 2>&1 | Out-Null }
  & $Nssm remove $ServiceName confirm | Out-Null
  Start-Sleep -Seconds 2
}
$inUse = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($inUse) {
  Fail ("Something is already using port $port (probably 'npm start' or 'npm run dev' in VS Code or PowerShell). " +
        "Stop it with Ctrl + C, then run this script again.")
}
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

& $Nssm install $ServiceName $node "server\index.js --production" | Out-Null
& $Nssm set $ServiceName AppDirectory $AppDir | Out-Null
& $Nssm set $ServiceName DisplayName "SGFD App" | Out-Null
& $Nssm set $ServiceName Description "St. George Fire Protection District management system (web app on port $port)." | Out-Null
& $Nssm set $ServiceName Start SERVICE_DELAYED_AUTO_START | Out-Null
& $Nssm set $ServiceName AppStdout (Join-Path $LogDir "sgfd-app.log") | Out-Null
& $Nssm set $ServiceName AppStderr (Join-Path $LogDir "sgfd-app.log") | Out-Null
& $Nssm set $ServiceName AppRotateFiles 1 | Out-Null
& $Nssm set $ServiceName AppRotateOnline 1 | Out-Null
& $Nssm set $ServiceName AppRotateBytes 10485760 | Out-Null
& $Nssm set $ServiceName AppExit Default Restart | Out-Null
& $Nssm set $ServiceName AppRestartDelay 5000 | Out-Null
foreach ($m in "AppStopMethodConsole", "AppStopMethodWindow", "AppStopMethodThreads") { & $Nssm set $ServiceName $m 1500 | Out-Null }
$old = $ErrorActionPreference; $ErrorActionPreference = "Continue"
& $Nssm set $ServiceName AppKillProcessTree 1 2>&1 | Out-Null    # optional; not in every NSSM build
$ErrorActionPreference = $old
if ($pg) { & $Nssm set $ServiceName DependOnService $pg.Name | Out-Null }

# --- Start it and check it answers
Step "Starting"
& $Nssm start $ServiceName | Out-Null
$ok = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Seconds 1
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { $ok = $true; break }
}
if (-not $ok) {
  Write-Host "The service didn't start listening on port $port. Last lines of the log:" -ForegroundColor Red
  Get-Content (Join-Path $LogDir "sgfd-app.log") -Tail 25 -ErrorAction SilentlyContinue
  exit 1
}

$https = Select-String -Path (Join-Path $AppDir ".env") -Pattern '^\s*HTTPS_(PFX|CERT)_FILE\s*=' -Quiet
$scheme = if ($https) { "https" } else { "http" }
$portPart = if (($https -and $port -eq 443) -or (-not $https -and $port -eq 80)) { "" } else { ":$port" }
Write-Host "`nThe SGFD App service is running on port $port." -ForegroundColor Green
Write-Host "Open it at:  ${scheme}://$($env:COMPUTERNAME.ToLower())$portPart" -ForegroundColor Green
Write-Host "It starts with Windows and keeps running when you log out or lock the PC."
Write-Host "Logs:    $LogDir\sgfd-app.log"
Write-Host "Updates: unzip the new version, then run  powershell -ExecutionPolicy Bypass -File .\scripts\update.ps1"

# --- Sleep would stop the app
$answer = Read-Host "`nKeep this PC from going to sleep while plugged in, so the app stays reachable overnight? (Y/N)"
if ($answer -match '^[Yy]') {
  powercfg /change standby-timeout-ac 0
  powercfg /change hibernate-timeout-ac 0
  Write-Host "Sleep and hibernate are off when plugged in. (The screen can still turn off and the PC can still lock.)"
}
