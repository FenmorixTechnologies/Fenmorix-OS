# Restores SGFD Nexus data from a backup made by scripts\backup.ps1. Use it to move
# everything from the old PC to the new server (or to recover from a backup).
#
# In PowerShell as Administrator, from D:\sgfd-nexus\app:
#   powershell -ExecutionPolicy Bypass -File .\scripts\restore.ps1 `
#     -DatabaseFile D:\move\sgfd-db-20261103-0900.dump `
#     -UploadsZip   D:\move\sgfd-uploads-20261103-0900.zip `
#     -FormsKey     D:\move\forms.key
#
# -DatabaseFile is required. -UploadsZip and -FormsKey are optional but you almost always
# want them: uploads = attachments, receipts and recordings; forms.key = the key that
# unlocks encrypted form answers (SSNs etc.). Without the same key those answers can't be read.
#
# This REPLACES everything in this server's sgfd database.

param(
  [Parameter(Mandatory = $true)][string]$DatabaseFile,
  [string]$UploadsZip = "",
  [string]$FormsKey = ""
)
$ErrorActionPreference = "Stop"
$ServiceName = "SGFDApp"
$AppDir = Split-Path -Parent $PSScriptRoot
$SgfdDir = Split-Path -Parent $AppDir
function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host "`n$text" -ForegroundColor Red; exit 1 }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Fail "Run this from PowerShell opened with 'Run as administrator'." }
foreach ($f in @($DatabaseFile, $UploadsZip, $FormsKey) | Where-Object { $_ }) { if (-not (Test-Path $f)) { Fail "Can't find $f" } }

# Settings from .env (same as backup.ps1)
$envFile = Join-Path $AppDir ".env"
if (-not (Test-Path $envFile)) { Fail "No .env yet. Run scripts\install-prereqs.ps1 first." }
$cfg = @{}
foreach ($line in Get-Content $envFile) {
  if ($line -match '^\s*([A-Z_]+)\s*=\s*(.*)\s*$') { $cfg[$Matches[1]] = $Matches[2].Trim().Trim("'").Trim('"') }
}
$pgHost = if ($cfg.PGHOST) { $cfg.PGHOST } else { "localhost" }
$pgPort = if ($cfg.PGPORT) { $cfg.PGPORT } else { "5432" }
$pgDb   = if ($cfg.PGDATABASE) { $cfg.PGDATABASE } else { "sgfd" }
$pgUser = if ($cfg.PGUSER) { $cfg.PGUSER } else { "sgfd_app" }
$bin = Get-ChildItem "$SgfdDir\postgresql\*\bin\pg_restore.exe", "$env:ProgramFiles\PostgreSQL\*\bin\pg_restore.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $bin) { Fail "pg_restore.exe wasn't found under $SgfdDir\postgresql." }
$psql = Join-Path $bin.DirectoryName "psql.exe"

# The app must not be running while its database is replaced
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
$wasRunning = $svc -and $svc.Status -eq "Running"
if ($wasRunning) { Step "Stopping the app"; Stop-Service $ServiceName -Force; Write-Host "Stopped." }

$env:PGPASSWORD = $cfg.PGPASSWORD
$ErrorActionPreference = "Continue"
try {
  $tables = (& $psql -w -h $pgHost -p $pgPort -U $pgUser -d $pgDb -Atc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'" 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE) { Fail "Can't connect to the $pgDb database as $pgUser`: $tables" }
  if ([int]$tables -gt 0) {
    Write-Host "`nThe $pgDb database on this server already has data ($tables tables)." -ForegroundColor Yellow
    if ((Read-Host "Type REPLACE to replace it with the backup") -cne "REPLACE") { Fail "Nothing was changed." }
  }

  Step "Restoring the database"
  & $bin.FullName -w -h $pgHost -p $pgPort -U $pgUser -d $pgDb --clean --if-exists --no-owner --no-privileges --single-transaction $DatabaseFile
  if ($LASTEXITCODE) { Fail "The restore stopped with an error (above). The database was left as it was before." }
  $users = (& $psql -w -h $pgHost -p $pgPort -U $pgUser -d $pgDb -Atc "SELECT count(*) FROM users" 2>&1 | Out-String).Trim()
  Write-Host "Restored. $users people on the roster." -ForegroundColor Green
} finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue; $ErrorActionPreference = "Stop" }

if ($UploadsZip) {
  Step "Restoring uploaded files"
  $uploads = if ($cfg.UPLOAD_DIR) { $cfg.UPLOAD_DIR } else { "uploads" }
  if (-not [System.IO.Path]::IsPathRooted($uploads)) { $uploads = Join-Path $AppDir $uploads }
  New-Item -ItemType Directory -Force -Path $uploads | Out-Null
  Expand-Archive -Path $UploadsZip -DestinationPath $uploads -Force
  Write-Host "Files restored to $uploads" -ForegroundColor Green
}

if ($FormsKey) {
  Step "Restoring the encryption key"
  $keyFile = if ($cfg.FORMS_KEY_FILE) { $cfg.FORMS_KEY_FILE } else { "secrets\forms.key" }
  if (-not [System.IO.Path]::IsPathRooted($keyFile)) { $keyFile = Join-Path $AppDir $keyFile }
  New-Item -ItemType Directory -Force -Path (Split-Path $keyFile) | Out-Null
  if ((Test-Path $keyFile) -and ((Get-FileHash $keyFile).Hash -ne (Get-FileHash $FormsKey).Hash)) {
    $old = "$keyFile.replaced-" + (Get-Date -Format "yyyyMMdd-HHmm")
    Move-Item $keyFile $old
    Write-Host "This server had a different key; it was kept as $old" -ForegroundColor Yellow
  }
  Copy-Item $FormsKey $keyFile -Force
  Write-Host "Key restored to $keyFile" -ForegroundColor Green
} elseif ($cfg.FORMS_KEY) {
  Write-Host "`nNote: FORMS_KEY is set in .env; make sure it's the same value as on the old PC." -ForegroundColor Yellow
} else {
  Write-Host "`nNo -FormsKey given: encrypted form answers (SSNs etc.) from the backup can't be read until" -ForegroundColor Yellow
  Write-Host "the old PC's secrets\forms.key is copied to $AppDir\secrets\forms.key." -ForegroundColor Yellow
}

if ($wasRunning) { Step "Starting the app"; Start-Service $ServiceName; Write-Host "Started." }
Write-Host "`nDone." -ForegroundColor Green
if (-not $svc) { Write-Host "Next: powershell -ExecutionPolicy Bypass -File .\scripts\install-service.ps1" }
