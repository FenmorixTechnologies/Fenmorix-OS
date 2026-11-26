# Does what Nexus > User Management > System asked for (updates\pending.json): install | restart | rollback | backup.
# Runs as SYSTEM from the "SGFD Nexus Update" task that scripts\install-updater.ps1 makes. You don't run this by hand.
#
# install:  database backup -> keep a copy of the current app (updates\previous\app) -> copy the new files over
#           (never .env, secrets, node_modules) -> update.ps1. If that fails, the previous app is put back and started.
# rollback: put updates\previous\app back and run update.ps1.
# Result: updates\last-result.json (Nexus shows it) and logs\update-<time>-<action>.log.
param([string]$SgfdDir = "")
$ErrorActionPreference = "Stop"
if (-not $SgfdDir) { $SgfdDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot) }
$AppDir      = Join-Path $SgfdDir "app"
$Upd         = Join-Path $SgfdDir "updates"
$Logs        = Join-Path $SgfdDir "logs"
$Previous    = Join-Path $Upd "previous\app"
$ServiceName = "SGFDApp"
New-Item -ItemType Directory -Force -Path $Upd, $Logs | Out-Null

$pendingFile = Join-Path $Upd "pending.json"
if (-not (Test-Path $pendingFile)) { exit 0 }
$job   = Get-Content $pendingFile -Raw | ConvertFrom-Json
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logName = "update-$stamp-$($job.action).log"
Start-Transcript -Path (Join-Path $Logs $logName) | Out-Null
Write-Host "SGFD Nexus updater: $($job.action), asked for by $($job.by) at $($job.at)"

# The task runs as SYSTEM, whose PATH and profile aren't an administrator's: find node / npm ourselves and give npm a folder to use
$machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
$nodeDir = @((Join-Path $SgfdDir "nodejs"), (Join-Path $env:ProgramFiles "nodejs"), "C:\Program Files\nodejs") |
  Where-Object { $_ -and (Test-Path (Join-Path $_ "npm.cmd")) } | Select-Object -First 1
if ($nodeDir) { $env:Path = "$nodeDir;$machinePath;$env:Path" } else { $env:Path = "$machinePath;$env:Path" }
$npmHome = Join-Path $SgfdDir "tools\npm"
New-Item -ItemType Directory -Force -Path (Join-Path $npmHome "cache"), (Join-Path $npmHome "prefix") | Out-Null
$env:npm_config_cache = Join-Path $npmHome "cache"
$env:npm_config_prefix = Join-Path $npmHome "prefix"
$env:npm_config_update_notifier = "false"; $env:npm_config_fund = "false"; $env:npm_config_audit = "false"
$ErrorActionPreference = "Continue"
try { Write-Host "Running as: $(whoami) · node $(& node.exe -v 2>$null) · npm $(& npm.cmd -v 2>$null) · node folder: $nodeDir" }
catch { Write-Host "node / npm not found for SYSTEM (looked in $SgfdDir\nodejs and Program Files\nodejs): $($_.Exception.Message)" }
$ErrorActionPreference = "Stop"

# Whatever happens, never leave Nexus stopped: start it again if it isn't running (an older build beats no Nexus)
function Ensure-Running {
  $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if (-not $svc -or $svc.Status -eq "Running") { return "" }
  Write-Host "`nThe service isn't running; starting it again."
  try { Start-Service -Name $ServiceName -ErrorAction Stop; Start-Sleep -Seconds 8 } catch { Write-Host $_.Exception.Message }
  if ((Get-Service -Name $ServiceName).Status -eq "Running") { return " The app was started again." }
  return " The app is NOT running: remote in and run scripts\update.ps1."
}

function Finish([bool]$ok, [string]$message) {
  if ($job.action -ne "backup") { $message += (Ensure-Running) }
  $r = [ordered]@{ id = $job.id; action = $job.action; ok = $ok; message = $message; at = (Get-Date).ToString("o"); by = $job.by; version = $job.version; log = $logName }
  [IO.File]::WriteAllText((Join-Path $Upd "last-result.json"), ($r | ConvertTo-Json))   # UTF-8 without a byte-order mark
  Remove-Item $pendingFile, (Join-Path $Upd "progress.json") -Force -ErrorAction SilentlyContinue
  Write-Host "`n$message"
  Stop-Transcript | Out-Null
  if ($ok) { exit 0 } else { exit 1 }
}
function Step($text) { Write-Host "`n== $text" }
# What Nexus' progress bar shows: step n of total (updates\progress.json)
$script:started = (Get-Date).ToString("o")
function Progress([int]$n, [int]$total, [string]$label) {
  Step $label
  [ordered]@{ id = $job.id; action = $job.action; step = $n; total = $total; label = $label; at = (Get-Date).ToString("o"); started = $script:started } |
    ConvertTo-Json | ForEach-Object { [IO.File]::WriteAllText((Join-Path $Upd "progress.json"), $_) }
}
# robocopy: exit codes under 8 mean success. Never touched: .env, secrets, node_modules, uploads (files people attached), logs.
$Keep = @("node_modules", ".git", "secrets", "uploads", "tmp", "logs")
function Robo([string[]]$robo) {
  & robocopy.exe @robo /XF .env *.log /R:2 /W:2 /NFL /NDL /NJH /NP | Out-Host
  if ($LASTEXITCODE -ge 8) { throw "Copying files failed (robocopy $LASTEXITCODE)." }
}
# New files over the app (like unzipping over it by hand)
function Copy-Over([string]$from, [string]$to) { Robo (@($from, $to, "/E", "/XD") + $Keep) }
# A snapshot of the app's code (no uploads etc.) into the rollback folder
function Save-Snapshot([string]$from, [string]$to) { Robo (@($from, $to, "/MIR", "/XD") + $Keep + @("dist")) }
# Put a snapshot back: top-level files, then each code folder mirrored (so files a failed release added go away)
function Restore-Snapshot([string]$from, [string]$to) {
  Robo @($from, $to)
  foreach ($d in "src", "server", "db", "scripts", "public", "docs") {
    if (Test-Path (Join-Path $from $d)) { Robo @((Join-Path $from $d), (Join-Path $to $d), "/MIR") }
  }
}
# PowerShell 5.1 turns anything a program writes to stderr (npm's warnings!) into an error when it's redirected, and with
# ErrorActionPreference = Stop that error ends the whole updater mid-update. So: Continue while child scripts run, lines as text,
# and only the exit code decides.
function Run-Script([string]$name) {
  $ErrorActionPreference = "Continue"
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $AppDir "scripts\$name") 2>&1 | ForEach-Object { "$_" } | Out-Host
  return $LASTEXITCODE
}
function Run-Update { return (Run-Script "update.ps1") }
function Run-Backup { return (Run-Script "backup.ps1") }

try {
  switch ($job.action) {
    "restart" {
      Progress 1 1 "Restarting the service"
      Restart-Service -Name $ServiceName -Force
      Start-Sleep -Seconds 8
      if ((Get-Service -Name $ServiceName).Status -ne "Running") { Finish $false "The service didn't come back after the restart. Check logs\sgfd-app.log." }
      Finish $true "Restarted."
    }
    "backup" {
      Progress 1 1 "Backing up the database and uploads"
      if ((Run-Backup) -ne 0) { Finish $false "The backup didn't finish (see the log)." }
      Finish $true "Backup finished."
    }
    "rollback" {
      if (-not (Test-Path (Join-Path $Previous "package.json"))) { Finish $false "There's no earlier version kept." }
      Progress 1 2 "Putting the previous version back"
      Restore-Snapshot $Previous $AppDir
      Progress 2 2 "Building and starting (the app is down for about a minute)"
      if ((Run-Update) -ne 0) { Finish $false "The previous version was copied back but didn't start. Remote in and run scripts\update.ps1." }
      Finish $true "Rolled back to the previous version."
    }
    "install" {
      Progress 1 6 "Checking the uploaded zip"
      $zip = [string]$job.zip
      if (-not (Test-Path $zip)) { Finish $false "The uploaded zip is gone. Upload it again." }
      if ((Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLower() -ne ([string]$job.sha256).ToLower()) { Finish $false "The uploaded zip doesn't match what was checked. Upload it again." }

      Progress 2 6 "Backing up the database first"
      if ((Run-Backup) -ne 0) { Finish $false "The backup didn't finish, so nothing was changed." }

      Progress 3 6 "Unpacking the new version"
      $staging = Join-Path $Upd "staging"
      if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
      Expand-Archive -Path $zip -DestinationPath $staging -Force
      $newApp = Join-Path $staging "app"
      if (-not (Test-Path (Join-Path $newApp "package.json"))) { Finish $false "The zip has no app folder; nothing was changed." }

      Progress 4 6 "Keeping a copy of the current version (for rollback)"
      New-Item -ItemType Directory -Force -Path $Previous | Out-Null
      Save-Snapshot $AppDir $Previous

      Progress 5 6 "Copying the new version over"
      Copy-Over $newApp $AppDir

      Progress 6 6 "Building and starting (the app is down for about a minute)"
      $code = Run-Update
      if ($code -ne 0) {
        Progress 6 6 "The new version didn't start. Putting the previous version back"
        Restore-Snapshot $Previous $AppDir
        $code2 = Run-Update
        if ($code2 -ne 0) { Finish $false "The update failed AND the previous version didn't start again. Remote in and run scripts\update.ps1 (log: $logName)." }
        Finish $false "The update failed, so the previous version was put back and is running. The log says why."
      }

      # Keep this updater current: the copy the task runs lives in tools\updater
      $tools = Join-Path $SgfdDir "tools\updater"
      if (Test-Path (Join-Path $AppDir "scripts\apply-update.ps1")) { New-Item -ItemType Directory -Force -Path $tools | Out-Null; Copy-Item (Join-Path $AppDir "scripts\apply-update.ps1") $tools -Force }
      $kept = Join-Path $Upd "installed"
      New-Item -ItemType Directory -Force -Path $kept | Out-Null
      Move-Item $zip (Join-Path $kept "release-$stamp.zip") -Force
      Remove-Item (Join-Path $Upd "incoming") -Recurse -Force -ErrorAction SilentlyContinue
      Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
      # Only the last 5 installed zips are kept
      Get-ChildItem $kept -Filter "release-*.zip" | Sort-Object Name -Descending | Select-Object -Skip 5 | Remove-Item -Force -ErrorAction SilentlyContinue
      Finish $true "Installed $($job.version) and running."
    }
    default { Finish $false "Unknown action: $($job.action)" }
  }
} catch {
  Write-Host $_.Exception.Message
  if ($job.action -eq "install" -and (Test-Path (Join-Path $Previous "package.json")) -and (Get-Service -Name $ServiceName).Status -ne "Running") {
    try { Restore-Snapshot $Previous $AppDir; [void](Run-Update) } catch { Write-Host "Rollback also failed: $($_.Exception.Message)" }
  }
  Finish $false "Stopped with an error: $($_.Exception.Message)"
}
