# Prepares a new Windows server for SGFD Nexus: installs everything the app needs and
# sets it up to run at https://SERVER-NAME (port 443).
#
# Run once on the new server, in PowerShell opened with "Run as administrator":
#   1. Unzip the app so it's at D:\sgfd-nexus\app
#   2. cd D:\sgfd-nexus\app
#      powershell -ExecutionPolicy Bypass -File .\scripts\install-prereqs.ps1
#
# Everything goes in the folder above the app (D:\sgfd-nexus): nodejs, postgresql (programs AND
# database files), git, tools\nssm, certs, logs, backups, installers.
#
# What it does (each step is skipped if it's already done, so it's safe to run again):
#   - Node.js (current LTS)                   - PostgreSQL 18 + pgAdmin
#   - Git for Windows                         - NSSM (runs the app as a Windows service)
#   - creates the sgfd database and the sgfd_app login with a random password
#   - writes .env: port 443, open to the network, http -> https redirect on port 80
#   - HTTPS certificate: yours (-PfxFile or -CertThumbprint), or a temporary self-signed one
#   - Windows Firewall rules for 443 and 80 (domain/private networks only)
#   - locks .env, the certificate folder and the encryption-key folder to Administrators/SYSTEM
#   - installs the app's packages (npm install)
#
# Options:
#   -PfxFile C:\path\sgfd.pfx      certificate from IT as a .pfx (asks for its password)
#   -CertThumbprint ABC123...      certificate IT already installed in the computer's certificate store
#   -InstallerDir D:\installers    use installers from this folder instead of downloading
#                                  (node-v*-x64.msi, postgresql-18*-windows-x64.exe,
#                                   Git-*-64-bit.exe, nssm*.zip). For servers without internet.
#   -AllowFrom 10.10.0.0/16        only allow these addresses through the firewall (default: any
#                                  address on domain/private networks)
#   -SkipGit                       don't install Git
#
# Afterwards: (if you're moving data from the old PC) scripts\restore.ps1, then
#             scripts\install-service.ps1

param(
  [string]$PfxFile = "",
  [string]$CertThumbprint = "",
  [string]$InstallerDir = "",
  [string]$AllowFrom = "",
  [int]$PgMajor = 18,
  [int]$PgPort = 5432,
  [switch]$SkipGit
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"          # downloads are many times faster without the progress bar
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$AppDir   = Split-Path -Parent $PSScriptRoot
$SgfdDir  = Split-Path -Parent $AppDir
$CertDir  = Join-Path $SgfdDir "certs"
$LogDir   = Join-Path $SgfdDir "logs"
$ToolsDir = Join-Path $SgfdDir "tools"
$Download = Join-Path $SgfdDir "installers"
$EnvFile  = Join-Path $AppDir ".env"
if (-not $InstallerDir) { $InstallerDir = $Download }

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Ok($text)   { Write-Host "   $text" -ForegroundColor Green }
function Note($text) { Write-Host "   $text" -ForegroundColor Yellow }
function Fail($text) { Write-Host "`n$text" -ForegroundColor Red; try { Stop-Transcript | Out-Null } catch {}; exit 1 }
$summary = [System.Collections.Generic.List[string]]::new()

# ---------------------------------------------------------------- checks
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Fail "Run this from PowerShell opened with 'Run as administrator'." }
if (-not (Test-Path (Join-Path $AppDir "server\index.js"))) { Fail "Can't find the app in $AppDir. Unzip it to D:\sgfd-nexus\app and run this from there." }
if (-not [Environment]::Is64BitOperatingSystem) { Fail "This needs 64-bit Windows." }
$os = [Environment]::OSVersion.Version
if ($os.Build -lt 14393) { Fail "This needs Windows Server 2016 or newer (or Windows 10/11)." }

foreach ($d in $CertDir, $LogDir, $ToolsDir, $Download) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
# Files unzipped from a download are marked "from the internet"; clear that so the scripts run cleanly
Get-ChildItem $AppDir -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue
Start-Transcript -Path (Join-Path $LogDir ("install-prereqs-" + (Get-Date -Format "yyyyMMdd-HHmm") + ".log")) | Out-Null
Write-Host "SGFD Nexus server setup on $env:COMPUTERNAME ($((Get-CimInstance Win32_OperatingSystem).Caption))"
Write-Host "Everything goes in $SgfdDir"
if ($SgfdDir -ne "D:\sgfd-nexus") {
  Write-Host "Note: the app is in $AppDir, so everything will go in $SgfdDir (expected D:\sgfd-nexus)." -ForegroundColor Yellow
  if ((Read-Host "Continue anyway? (Y/N)") -notmatch '^[Yy]') { Stop-Transcript | Out-Null; exit 1 }
}

# ---------------------------------------------------------------- helpers
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}
function Get-File($url, $name) {
  $out = Join-Path $Download $name
  if (Test-Path $out) { return $out }
  Write-Host "   Downloading $url"
  try { Invoke-WebRequest -Uri $url -OutFile "$out.part" -UseBasicParsing -TimeoutSec 900 }
  catch { Remove-Item "$out.part" -ErrorAction SilentlyContinue; throw }
  Move-Item "$out.part" $out -Force
  return $out
}
function Find-Offline($pattern) {
  if (-not (Test-Path $InstallerDir)) { return $null }
  Get-ChildItem $InstallerDir -Filter $pattern -File -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty FullName
}
function Test-Hash($file, $expected) {
  $actual = (Get-FileHash $file -Algorithm SHA256).Hash
  if ($actual -ne $expected.ToUpper()) { Remove-Item $file -Force; Fail "The download of $(Split-Path $file -Leaf) didn't match its published checksum, so it was deleted. Run this again." }
  Ok "Checksum verified."
}
function Run-Installer($file, $arguments, $what) {
  Write-Host "   Installing $what (this can take a few minutes)..."
  $p = Start-Process -FilePath $file -ArgumentList $arguments -Wait -PassThru
  if ($p.ExitCode -notin 0, 3010) { Fail "$what didn't install (exit code $($p.ExitCode))." }
  if ($p.ExitCode -eq 3010) { Note "$what asks for a restart. Finish this script first, then restart." }
}
function New-Secret([int]$length = 32) {
  $chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
  $bytes = New-Object byte[] $length
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create(); $rng.GetBytes($bytes); $rng.Dispose()
  -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}
function Read-Secret($prompt) {
  $s = Read-Host $prompt -AsSecureString
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}
# .env: read one value / set one value (uncomments "# KEY=" lines, otherwise appends)
function Get-EnvValue($key) {
  if (-not (Test-Path $EnvFile)) { return "" }
  $line = Get-Content $EnvFile | Where-Object { $_ -match "^\s*$key\s*=" } | Select-Object -First 1
  if (-not $line) { return "" }
  ($line -replace "^\s*$key\s*=\s*", "").Trim().Trim("'").Trim('"')
}
function Set-EnvValue($key, $value) {
  $v = "$value"
  if ($v -match "[\s#'`"]") { $v = if ($v -notmatch "'") { "'$v'" } else { '"' + $v + '"' } }
  $lines = [System.Collections.Generic.List[string]]@(Get-Content $EnvFile)
  $i = -1
  for ($n = 0; $n -lt $lines.Count; $n++) { if ($lines[$n] -match "^\s*$key\s*=") { $i = $n; break } }
  if ($i -lt 0) { for ($n = 0; $n -lt $lines.Count; $n++) { if ($lines[$n] -match "^\s*#\s*$key\s*=") { $i = $n; break } } }
  if ($i -ge 0) { $lines[$i] = "$key=$v" } else { $lines.Add("$key=$v") }
  Set-Content -Path $EnvFile -Value $lines -Encoding ASCII
}
function Lock-Down($path) {
  # Only Administrators (S-1-5-32-544) and SYSTEM (S-1-5-18); names by SID so it works in any language
  if (-not (Test-Path $path)) { return }
  $isDir = (Get-Item $path).PSIsContainer
  $grant = if ($isDir) { "(OI)(CI)F" } else { "F" }
  & icacls.exe $path /inheritance:r /grant:r "*S-1-5-32-544:$grant" "*S-1-5-18:$grant" /T /Q | Out-Null
}

# ================================================================ 1. Node.js
Step "Node.js"
Refresh-Path
$nodeExe = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
$nodeOk = $false
if ($nodeExe) {
  $v = (& $nodeExe -v).Trim().TrimStart("v")
  if ([version]$v -ge [version]"20.12.0") { $nodeOk = $true; Ok "Already installed: Node $v" }
  else { Note "Node $v is too old; installing the current LTS." }
}
if (-not $nodeOk) {
  $msi = Find-Offline "node-v*-x64.msi"
  if ($msi) { Write-Host "   Using $msi" }
  else {
    try {
      $rel = Invoke-RestMethod "https://nodejs.org/dist/index.json" -TimeoutSec 60 |
        Where-Object { $_.lts -and $_.files -contains "win-x64-msi" } | Select-Object -First 1
    } catch { Fail "Can't reach nodejs.org. Download the Windows 64-bit LTS installer (.msi) from https://nodejs.org on another PC, put it in $InstallerDir, and run this again." }
    $name = "node-$($rel.version)-x64.msi"
    $msi = Get-File "https://nodejs.org/dist/$($rel.version)/$name" $name
    $sums = (Invoke-WebRequest "https://nodejs.org/dist/$($rel.version)/SHASUMS256.txt" -UseBasicParsing -TimeoutSec 60).Content
    if ($sums -is [byte[]]) { $sums = [Text.Encoding]::ASCII.GetString($sums) }
    $line = ($sums -split "`n") | Where-Object { $_ -match "\s$([regex]::Escape($name))\s*$" } | Select-Object -First 1
    if ($line) { Test-Hash $msi ($line -split "\s+")[0] } else { Note "Couldn't find the published checksum; continuing." }
  }
  Run-Installer "msiexec.exe" "/i `"$msi`" /qn /norestart INSTALLDIR=`"$SgfdDir\nodejs`"" "Node.js"
  Refresh-Path
  $nodeExe = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
  if (-not $nodeExe) { $nodeExe = "$SgfdDir\nodejs\node.exe" }
  if (-not (Test-Path $nodeExe)) { Fail "Node.js installed but node.exe wasn't found. Restart PowerShell and run this again." }
  Ok "Installed: Node $(& $nodeExe -v)"
}
$summary.Add("Node.js        $(& $nodeExe -v)")

# ================================================================ 2. PostgreSQL
Step "PostgreSQL $PgMajor"
$PgHome = Join-Path $SgfdDir "postgresql\$PgMajor"     # programs and database files
$pgSvc = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
$pgBin = $null
$superPw = $null
if ($pgSvc) {
  $svcPath = (Get-CimInstance Win32_Service -Filter "Name='$($pgSvc.Name)'").PathName
  if ($svcPath -match '"?([A-Za-z]:\\[^"]+?\\bin)\\pg_ctl\.exe') { $pgBin = $Matches[1] }
  Ok "Already installed: $($pgSvc.DisplayName) ($($pgSvc.Status))"
  if ($pgSvc.Status -ne "Running") { Start-Service $pgSvc.Name; Ok "Started it." }
} else {
  $exe = Find-Offline "postgresql-$PgMajor*-windows-x64.exe"
  if ($exe) { Write-Host "   Using $exe" }
  else {
    # The EnterpriseDB installer (the one postgresql.org links to). Find the newest minor version.
    Write-Host "   Finding the newest PostgreSQL $PgMajor installer..."
    for ($m = 20; $m -ge 0 -and -not $exe; $m--) {
      $name = "postgresql-$PgMajor.$m-1-windows-x64.exe"
      $url = "https://get.enterprisedb.com/postgresql/$name"
      try { $exe = Get-File $url $name } catch { }      # a version that doesn't exist yet fails fast (404)
    }
    if (-not $exe) {
      Fail ("Couldn't download PostgreSQL. On a PC with internet, download the Windows x86-64 installer for version $PgMajor " +
            "from https://www.postgresql.org/download/windows/ , put it in $InstallerDir, and run this again.")
    }
  }
  Write-Host ""
  Write-Host "   Choose a password for the PostgreSQL superuser account 'postgres'." -ForegroundColor White
  Write-Host "   Keep it in your password manager: you need it for database maintenance and restores." -ForegroundColor White
  do {
    $superPw = Read-Secret "   postgres password"
    $again   = Read-Secret "   Type it again"
    if ($superPw -ne $again) { Note "They didn't match." } elseif ($superPw.Length -lt 12) { Note "Use at least 12 characters." }
  } while ($superPw -ne $again -or $superPw.Length -lt 12)

  # Options go in a temporary file (not on the command line, where other programs could see the password)
  $optFile = Join-Path $env:TEMP ("pg-" + [guid]::NewGuid().ToString("N") + ".txt")
  @(
    "mode=unattended", "unattendedmodeui=none", "superaccount=postgres", "superpassword=$superPw",
    "serverport=$PgPort", "disable-components=stackbuilder",
    "prefix=$PgHome", "datadir=$PgHome\data"
  ) | Set-Content $optFile -Encoding ASCII
  try { Run-Installer $exe "--optionfile `"$optFile`"" "PostgreSQL $PgMajor" }
  finally { Remove-Item $optFile -Force -ErrorAction SilentlyContinue }

  $pgSvc = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
  if (-not $pgSvc) { Fail "PostgreSQL installed but its service wasn't found. Check the installer log in $env:TEMP (install-postgresql.log)." }
  $pgBin = "$PgHome\bin"
  Ok "Installed: $($pgSvc.DisplayName)"
}
if (-not $pgBin -or -not (Test-Path (Join-Path $pgBin "psql.exe"))) {
  $pgBin = Get-ChildItem "$SgfdDir\postgresql\*\bin\psql.exe", "$env:ProgramFiles\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1 | ForEach-Object { $_.DirectoryName }
}
if (-not $pgBin) { Fail "Can't find psql.exe under $SgfdDir\postgresql." }
$psql = Join-Path $pgBin "psql.exe"
# Put the PostgreSQL tools on the PATH (pg_dump for backups, psql)
$machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
if ($machinePath -notlike "*$pgBin*") { [Environment]::SetEnvironmentVariable("Path", "$machinePath;$pgBin", "Machine"); Refresh-Path }
$summary.Add("PostgreSQL     $($pgSvc.DisplayName), port $PgPort")

# ================================================================ 3. Database + app login
Step "The sgfd database"
if (-not (Test-Path $EnvFile)) {
  Copy-Item (Join-Path $AppDir ".env.example") $EnvFile
  Ok "Created .env from .env.example"
}
$appPw = Get-EnvValue "PGPASSWORD"
$needPw = (-not $appPw) -or ($appPw -eq "put-the-sgfd_app-password-here")

function Invoke-Psql($sql) {
  $env:PGPASSWORD = $superPw
  $ErrorActionPreference = "Continue"     # psql's messages on stderr aren't PowerShell errors
  try {
    $out = & $psql -w -h localhost -p $PgPort -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc $sql 2>&1
    if ($LASTEXITCODE) { throw ($out | Out-String) }
    return ($out | Out-String).Trim()
  } finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
}
# Does the app login already work?
$appWorks = $false
if (-not $needPw) {
  $env:PGPASSWORD = $appPw
  $ErrorActionPreference = "Continue"
  & $psql -w -h localhost -p $PgPort -U sgfd_app -d sgfd -Atc "SELECT 1" 2>&1 | Out-Null
  $appWorks = ($LASTEXITCODE -eq 0)
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  $ErrorActionPreference = "Stop"
}
if ($appWorks) { Ok "The sgfd database and sgfd_app login already work." }
else {
  if (-not $superPw) {
    for ($try = 0; $try -lt 3; $try++) {
      $superPw = Read-Secret "   Password for the PostgreSQL 'postgres' account"
      try { Invoke-Psql "SELECT 1" | Out-Null; break } catch { Note "That didn't work."; $superPw = $null }
    }
    if (-not $superPw) { Fail "Couldn't sign in to PostgreSQL as postgres." }
  }
  if ($needPw) { $appPw = New-Secret 32 }
  $roleExists = (Invoke-Psql "SELECT 1 FROM pg_roles WHERE rolname = 'sgfd_app'") -eq "1"
  if ($roleExists) { Invoke-Psql "ALTER ROLE sgfd_app WITH LOGIN PASSWORD '$appPw'" | Out-Null; Ok "Set a new password for sgfd_app." }
  else { Invoke-Psql "CREATE ROLE sgfd_app WITH LOGIN PASSWORD '$appPw'" | Out-Null; Ok "Created the sgfd_app login." }
  $dbExists = (Invoke-Psql "SELECT 1 FROM pg_database WHERE datname = 'sgfd'") -eq "1"
  if ($dbExists) { Ok "The sgfd database already exists." }
  else { Invoke-Psql "CREATE DATABASE sgfd OWNER sgfd_app ENCODING 'UTF8' TEMPLATE template0" | Out-Null; Ok "Created the sgfd database." }
  Invoke-Psql "REVOKE ALL ON DATABASE sgfd FROM PUBLIC" | Out-Null
  Set-EnvValue "PGHOST" "localhost"; Set-EnvValue "PGPORT" $PgPort; Set-EnvValue "PGDATABASE" "sgfd"
  Set-EnvValue "PGUSER" "sgfd_app";  Set-EnvValue "PGPASSWORD" $appPw
  Ok "Saved the sgfd_app password in .env (you don't need to know it)."
}
$superPw = $null
$summary.Add("Database       sgfd (login sgfd_app, password in .env)")

# ================================================================ 4. Git
if (-not $SkipGit) {
  Step "Git"
  Refresh-Path
  $git = (Get-Command git.exe -ErrorAction SilentlyContinue).Source
  if ($git) { Ok "Already installed: $(& $git --version)" }
  else {
    $exe = Find-Offline "Git-*-64-bit.exe"
    if (-not $exe) {
      try {
        $rel = Invoke-RestMethod "https://api.github.com/repos/git-for-windows/git/releases/latest" -TimeoutSec 60 -Headers @{ "User-Agent" = "sgfd-nexus-setup" }
        $asset = $rel.assets | Where-Object { $_.name -match '^Git-[\d.]+-64-bit\.exe$' } | Select-Object -First 1
        $exe = Get-File $asset.browser_download_url $asset.name
        if ($asset.digest -match '^sha256:([0-9a-f]{64})$') { Test-Hash $exe $Matches[1] }
      } catch { Note "Couldn't download Git ($($_.Exception.Message)). Skipping; the app doesn't need it to run." }
    }
    if ($exe) {
      Run-Installer $exe "/VERYSILENT /NORESTART /NOCANCEL /SP- /SUPPRESSMSGBOXES /DIR=`"$SgfdDir\git`"" "Git"
      Refresh-Path
      Ok "Installed Git."
      $summary.Add("Git            installed")
    }
  }
}

# ================================================================ 5. NSSM (service manager)
Step "NSSM"
$NssmDir = Join-Path $ToolsDir "nssm"
$Nssm = Join-Path $NssmDir "nssm.exe"
if (Test-Path $Nssm) { Ok "Already here: $Nssm" }
else {
  New-Item -ItemType Directory -Force -Path $NssmDir | Out-Null
  $zip = Find-Offline "nssm*.zip"
  if (-not $zip) {
    foreach ($url in "https://nssm.cc/ci/nssm-2.24-101-g897c7ad.zip", "https://nssm.cc/release/nssm-2.24.zip") {
      try { $zip = Get-File $url (Split-Path $url -Leaf); break } catch { Note "Didn't work: $url" }
    }
  }
  if ($zip) {
    $unpack = Join-Path $env:TEMP "nssm-unpack"
    if (Test-Path $unpack) { Remove-Item $unpack -Recurse -Force }
    Expand-Archive -Path $zip -DestinationPath $unpack -Force
    $found = Get-ChildItem $unpack -Recurse -Filter nssm.exe | Where-Object { $_.FullName -match "win64" } | Select-Object -First 1
    if ($found) { Copy-Item $found.FullName $Nssm -Force }
  }
  if (Test-Path $Nssm) { Ok "Saved to $Nssm" }
  else { Note "Couldn't get NSSM. install-service.ps1 will try again, or copy win64\nssm.exe from https://nssm.cc/download to $Nssm" }
}

# ================================================================ 6. Port 443 / 80 free?
Step "Ports 443 and 80"
function Show-PortOwner($port) {
  $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $c) { Ok "Port $port is free."; return $true }
  $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
  $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)" -ErrorAction SilentlyContinue).CommandLine
  if ($cmd -like "*server\index.js*") { Ok "Port $port is used by SGFD Nexus itself."; return $true }
  if ($c.OwningProcess -eq 4) {
    Note "Port $port is held by Windows' web server component (HTTP.sys). Usually IIS; also WSUS, SSRS, ADFS or Work Folders."
  } else { Note "Port $port is used by $($proc.ProcessName) (process $($c.OwningProcess))." }
  return $false
}
$free443 = Show-PortOwner 443
$free80  = Show-PortOwner 80
$iis = Get-Service W3SVC -ErrorAction SilentlyContinue
if ((-not $free443 -or -not $free80) -and $iis -and $iis.Status -eq "Running") {
  $a = Read-Host "   IIS (World Wide Web Publishing Service) is running. Stop it and keep it off so SGFD Nexus can use 443/80? Only say Y if nothing else on this server uses IIS. (Y/N)"
  if ($a -match '^[Yy]') {
    Stop-Service W3SVC -Force; Set-Service W3SVC -StartupType Disabled
    Ok "IIS stopped and disabled."
    $free443 = Show-PortOwner 443; $free80 = Show-PortOwner 80
  }
}
if (-not $free443) { Note "Port 443 must be freed before the app can start. (Or set a different PORT in .env.)" }

# ================================================================ 7. HTTPS certificate
Step "HTTPS certificate"
$fqdn = $env:COMPUTERNAME
$cs = Get-CimInstance Win32_ComputerSystem
if ($cs.PartOfDomain) { $fqdn = "$env:COMPUTERNAME.$($cs.Domain)".ToLower() }
$pfxOut = Join-Path $CertDir "sgfd.pfx"

function Use-Pfx($path, $pass, $label) {
  try { $c = New-Object Security.Cryptography.X509Certificates.X509Certificate2($path, $pass) }
  catch { Fail "That certificate file couldn't be opened (wrong password?)." }
  if (-not $c.HasPrivateKey) { Fail "That certificate doesn't include its private key. Ask IT for a .pfx that includes the key." }
  $names = @($c.DnsNameList | ForEach-Object { $_.Unicode })
  Write-Host "   $label : $($c.Subject)"
  Write-Host "   Names: $($names -join ', ')"
  Write-Host "   Valid until: $($c.NotAfter.ToString('yyyy-MM-dd'))"
  if ($c.NotAfter -lt (Get-Date).AddDays(30)) { Note "It expires within 30 days." }
  if (-not ($names | Where-Object { $_ -ieq $fqdn -or $_ -ieq $env:COMPUTERNAME -or ($_ -like "*.*" -and $_ -match '^\*\.' -and $fqdn -like $_) })) {
    Note "It doesn't list this server's name ($fqdn). Browsers will warn unless people use one of the names above (and DNS points it here)."
  }
  Set-EnvValue "HTTPS_PFX_FILE" $path
  Set-EnvValue "HTTPS_PFX_PASSPHRASE" $pass
  # A .pfx replaces any .crt/.key pair
  $lines = Get-Content $EnvFile | ForEach-Object { if ($_ -match '^\s*HTTPS_(CERT|KEY)_FILE\s*=') { "# $_" } else { $_ } }
  Set-Content $EnvFile $lines -Encoding ASCII
}

if ($PfxFile) {
  if (-not (Test-Path $PfxFile)) { Fail "Can't find $PfxFile" }
  $pass = Read-Secret "   Password for $(Split-Path $PfxFile -Leaf)"
  Copy-Item $PfxFile $pfxOut -Force
  Use-Pfx $pfxOut $pass "Certificate"
  $certNote = "from IT ($pfxOut)"
}
elseif ($CertThumbprint) {
  $tp = ($CertThumbprint -replace '[^0-9A-Fa-f]', '').ToUpper()
  $c = Get-Item "Cert:\LocalMachine\My\$tp" -ErrorAction SilentlyContinue
  if (-not $c) { Fail "No certificate with thumbprint $tp in the computer's Personal store (certlm.msc)." }
  $pass = New-Secret 24
  $sec = ConvertTo-SecureString $pass -AsPlainText -Force
  try {
    $opt = @{}; if ((Get-Command Export-PfxCertificate).Parameters.ContainsKey("CryptoAlgorithmOption")) { $opt.CryptoAlgorithmOption = "AES256_SHA256" }
    Export-PfxCertificate -Cert $c -FilePath $pfxOut -Password $sec -Force @opt | Out-Null
  } catch { Fail "That certificate's private key can't be exported. Ask IT to issue it with an exportable key, or to give you a .pfx file (then use -PfxFile)." }
  Use-Pfx $pfxOut $pass "Certificate"
  $certNote = "from the certificate store ($tp)"
}
else {
  $current = Get-EnvValue "HTTPS_PFX_FILE"; if (-not $current) { $current = Get-EnvValue "HTTPS_CERT_FILE" }
  if ($current -and (Test-Path $current)) {
    Ok "Keeping the certificate already set in .env: $current"
    $certNote = "already set ($current)"
  } else {
    # Temporary self-signed certificate so HTTPS works now. Browsers show a warning until it's replaced.
    $names = @($fqdn, $env:COMPUTERNAME, "localhost") | Select-Object -Unique
    $c = New-SelfSignedCertificate -DnsName $names -CertStoreLocation "Cert:\LocalMachine\My" -FriendlyName "SGFD Nexus (temporary)" `
      -NotAfter (Get-Date).AddYears(1) -KeyExportPolicy Exportable -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256
    $pass = New-Secret 24
    $sec = ConvertTo-SecureString $pass -AsPlainText -Force
    $opt = @{}; if ((Get-Command Export-PfxCertificate).Parameters.ContainsKey("CryptoAlgorithmOption")) { $opt.CryptoAlgorithmOption = "AES256_SHA256" }
    $tmp = Join-Path $CertDir "sgfd-temporary.pfx"
    Export-PfxCertificate -Cert $c -FilePath $tmp -Password $sec -Force @opt | Out-Null
    Remove-Item "Cert:\LocalMachine\My\$($c.Thumbprint)" -Force
    Use-Pfx $tmp $pass "Temporary certificate"
    Note "This is a TEMPORARY self-signed certificate: browsers will warn until it's replaced with IT's."
    Note "When IT's certificate arrives:  .\scripts\install-prereqs.ps1 -PfxFile <file>   then  Restart-Service SGFDApp"
    $certNote = "TEMPORARY self-signed (replace with IT's)"
  }
}
$summary.Add("Certificate    $certNote")

# ================================================================ 8. .env for the network on 443
Step "Settings (.env)"
Set-EnvValue "PORT" 443
Set-EnvValue "HOST" "0.0.0.0"
Set-EnvValue "HTTP_REDIRECT_PORT" 80
Ok "PORT=443, HOST=0.0.0.0 (other computers can connect), http on port 80 redirects to https."

# ================================================================ 9. Firewall
Step "Windows Firewall"
foreach ($p in 443, 80) {
  $name = "SGFD Nexus (TCP $p)"
  Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  $args2 = @{ DisplayName = $name; Direction = "Inbound"; Protocol = "TCP"; LocalPort = $p; Action = "Allow"; Profile = "Domain,Private" }
  if ($AllowFrom) { $args2.RemoteAddress = ($AllowFrom -split "\s*,\s*") }
  New-NetFirewallRule @args2 | Out-Null
  Ok "Allowed TCP $p in (domain/private networks$(if ($AllowFrom) { ", from $AllowFrom" }))."
}
$old = Get-NetFirewallRule -DisplayName "SGFD App" -ErrorAction SilentlyContinue
if ($old) { $old | Remove-NetFirewallRule; Ok "Removed the old port 3000 rule." }
$netCategory = (Get-NetConnectionProfile -ErrorAction SilentlyContinue | Select-Object -First 1).NetworkCategory
if ("$netCategory" -eq "Public") { Note "This server's network is marked Public, so these rules don't apply yet. Join the domain or set it to Private." }
$summary.Add("Firewall       TCP 443 and 80 allowed (domain/private)")

# ================================================================ 10. Lock down secrets
Step "Locking down passwords and keys"
Lock-Down $EnvFile
Lock-Down $CertDir
$secrets = Join-Path $AppDir "secrets"
New-Item -ItemType Directory -Force -Path $secrets | Out-Null
Lock-Down $secrets
Ok ".env, $CertDir and secrets\ are readable only by Administrators and SYSTEM."

# ================================================================ 11. Power
Step "Power settings"
& powercfg.exe /change standby-timeout-ac 0 | Out-Null
& powercfg.exe /change hibernate-timeout-ac 0 | Out-Null
Ok "Sleep and hibernate are off."

# ================================================================ 12. App packages
Step "App packages (npm install)"
$npm = Join-Path (Split-Path $nodeExe) "npm.cmd"
Push-Location $AppDir
try {
  & $npm install --no-fund --no-audit
  if ($LASTEXITCODE) {
    Note "npm install failed. It needs to reach registry.npmjs.org (allow it through the proxy/firewall,"
    Note "or set a proxy with: npm config set proxy http://PROXY:PORT). Then run this script again."
    $summary.Add("App packages   NOT installed (see above)")
  } else { Ok "Installed."; $summary.Add("App packages   installed") }
} finally { Pop-Location }

# ================================================================ done
Write-Host "`n================ Summary ================" -ForegroundColor Cyan
$summary | ForEach-Object { Write-Host "  $_" }
Write-Host "`nNext:" -ForegroundColor Cyan
Write-Host "  1. Moving data from the old PC?  Run scripts\restore.ps1 now (before step 2). See README: 'Moving to a new server'."
Write-Host "  2. powershell -ExecutionPolicy Bypass -File .\scripts\install-service.ps1"
Write-Host "  3. Open  https://$fqdn  (on this server you can also use https://localhost)"
Write-Host "     Ask IT to add a DNS name for this server (for example nexus.$(if ($cs.PartOfDomain) { $cs.Domain } else { 'yourdomain' })) if you want a friendlier address;"
Write-Host "     the certificate must include that name."
Write-Host "`nLog of this setup: $LogDir" -ForegroundColor DarkGray
Stop-Transcript | Out-Null
