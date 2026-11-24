# Backs up the SGFD app: the database (pg_dump) and uploaded files.
#
#   Run once now:            powershell -ExecutionPolicy Bypass -File .\scripts\backup.ps1
#   Schedule nightly (2:15): powershell -ExecutionPolicy Bypass -File .\scripts\backup.ps1 -Register
#   Every 4 hours instead:   powershell -ExecutionPolicy Bypass -File .\scripts\backup.ps1 -Register -EveryHours 4
#   Different folder:        ... -Destination "\\fileserver\sgfd-backups"
#
# Backups go to D:\sgfd-nexus\backups by default (the folder above the app). Every backup from the last 2 days is kept;
# older than that, one per day is kept (the last of the day) until -KeepDays (30). The database is dumped every run;
# uploaded files (attachments, recordings) are zipped once a day, since they're large and change slowly.
#
# The encryption key (secrets\forms.key) is NOT copied next to the backups on purpose:
# a backup plus its key would let anyone read SSNs and other encrypted answers. Keep one
# copy of the key somewhere separate and safe (a locked USB drive, a password manager, or
# a restricted share). Without it, encrypted answers in a restored backup can't be read.

param(
  [string]$Destination = "",
  [int]$KeepDays = 30,
  [int]$EveryHours = 0,          # with -Register: run every N hours (starting 2:15 AM) instead of once a night
  [switch]$Register
)
$ErrorActionPreference = "Stop"
$AppDir  = Split-Path -Parent $PSScriptRoot
$SgfdDir = Split-Path -Parent $AppDir
if (-not $Destination) { $Destination = Join-Path $SgfdDir "backups" }

if ($Register) {
  $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $isAdmin) { Write-Host "Run this from PowerShell opened with 'Run as administrator'." -ForegroundColor Red; exit 1 }
  $taskArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Destination `"$Destination`" -KeepDays $KeepDays"
  $action  = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $taskArgs
  if ($EveryHours -gt 0) {
    if ($EveryHours -gt 24) { Write-Host "-EveryHours must be 1 to 24." -ForegroundColor Red; exit 1 }
    $trigger = New-ScheduledTaskTrigger -Once -At 2:15am -RepetitionInterval (New-TimeSpan -Hours $EveryHours) -RepetitionDuration (New-TimeSpan -Days 3650)
    $when = "every $EveryHours hours (from 2:15 AM)"
  } else {
    $trigger = New-ScheduledTaskTrigger -Daily -At 2:15am
    $when = "every night at 2:15 AM"
  }
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)
  $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
  Register-ScheduledTask -TaskName "SGFD App backup" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
  Write-Host "Scheduled: SGFD App backup, $when, to $Destination" -ForegroundColor Green
  exit 0
}

# Database settings from .env
$envFile = Join-Path $AppDir ".env"
$cfg = @{}
if (Test-Path $envFile) {
  foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*([A-Z_]+)\s*=\s*(.*)\s*$') { $cfg[$Matches[1]] = $Matches[2].Trim('"') }
  }
}
$pgHost = if ($cfg.PGHOST) { $cfg.PGHOST } else { "localhost" }
$pgPort = if ($cfg.PGPORT) { $cfg.PGPORT } else { "5432" }
$pgDb   = if ($cfg.PGDATABASE) { $cfg.PGDATABASE } else { "sgfd" }
$pgUser = if ($cfg.PGUSER) { $cfg.PGUSER } else { "sgfd_app" }

$pgDump = Get-ChildItem "$SgfdDir\postgresql\*\bin\pg_dump.exe", "$env:ProgramFiles\PostgreSQL\*\bin\pg_dump.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $pgDump) { Write-Host "pg_dump.exe wasn't found under $SgfdDir\postgresql or $env:ProgramFiles\PostgreSQL." -ForegroundColor Red; exit 1 }

New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmm"
$dbFile = Join-Path $Destination "sgfd-db-$stamp.dump"

$env:PGPASSWORD = $cfg.PGPASSWORD
try {
  & $pgDump.FullName -h $pgHost -p $pgPort -U $pgUser -d $pgDb -Fc -f $dbFile
  if ($LASTEXITCODE) { throw "pg_dump failed (exit $LASTEXITCODE)" }
} finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
Write-Host "Database:  $dbFile"

# Uploaded files (attachments, recordings): once a day is enough
$uploads = if ($cfg.UPLOAD_DIR) { $cfg.UPLOAD_DIR } else { "uploads" }
if (-not [System.IO.Path]::IsPathRooted($uploads)) { $uploads = Join-Path $AppDir $uploads }
$recentZip = Get-ChildItem $Destination -Filter "sgfd-uploads-*.zip" -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -gt (Get-Date).AddHours(-20) }
if ($recentZip) { Write-Host "Uploads:   already zipped in the last 20 hours ($($recentZip[0].Name))" }
elseif (Test-Path $uploads) {
  $zip = Join-Path $Destination "sgfd-uploads-$stamp.zip"
  Compress-Archive -Path (Join-Path $uploads "*") -DestinationPath $zip -Force
  Write-Host "Uploads:   $zip"
}

# Branding (Branding page) and the license, from the folder above the app: small, every run
$setDirs = @("branding", "license") | ForEach-Object { Join-Path (Split-Path -Parent $AppDir) $_ } | Where-Object { Test-Path $_ }
if ($setDirs) {
  $setZip = Join-Path $Destination "sgfd-settings-$stamp.zip"
  Compress-Archive -Path $setDirs -DestinationPath $setZip -Force
  Write-Host "Branding/license: $setZip"
}

# Keep everything from the last 2 days; older than that, the last backup of each day; nothing older than $KeepDays days
$all = Get-ChildItem $Destination -File | Where-Object { $_.Name -like "sgfd-*" }
$all | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) } | Remove-Item -Force
foreach ($kind in "sgfd-db-", "sgfd-uploads-", "sgfd-settings-") {
  $all | Where-Object { $_.Name -like "$kind*" -and $_.LastWriteTime -lt (Get-Date).AddDays(-2) -and $_.LastWriteTime -ge (Get-Date).AddDays(-$KeepDays) } |
    Group-Object { $_.LastWriteTime.Date } | ForEach-Object { $_.Group | Sort-Object LastWriteTime -Descending | Select-Object -Skip 1 | Remove-Item -Force }
}
Write-Host "Done. Kept every backup from the last 2 days and one a day back to $KeepDays days." -ForegroundColor Green
Write-Host "To restore: pg_restore -h $pgHost -U $pgUser -d $pgDb --clean `"$dbFile`""
