# Installs speech-to-text for Working Fire transcripts (whisper.cpp + a Whisper model).
# Runs entirely on this server: no audio is sent anywhere.
#
#   cd D:\sgfd-nexus\app
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-whisper.ps1            # small.en model (recommended)
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-whisper.ps1 -Model base.en   # faster, less accurate
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-whisper.ps1 -Model medium.en # slower, most accurate
#
# Puts whisper-cli.exe and ggml-<model>.bin in D:\sgfd-nexus\tools\whisper (Nexus finds them there;
# no .env change and no restart needed). Downloads from github.com (whisper.cpp releases) and
# huggingface.co (the model): if the server can't reach them, download on another computer:
#   https://github.com/ggml-org/whisper.cpp/releases  ->  the newest release that has a Windows x64 CPU zip
#   (whisper-bin-x64.zip, or a name like whisper-bNNNN-bin-win-cpu-x64.zip; the numbered "bNNNN" builds carry the
#   Windows programs, the vX.Y.Z releases may only have source code) - unzip into tools\whisper
#   https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin  (into tools\whisper)
# and run this script with -Offline to check the files.
#
# Rough speed on an 8-core server, small.en: a 20-minute working fire (~150 transmissions) in 3-6 minutes.

param(
  [ValidateSet("base.en", "small.en", "medium.en")] [string]$Model = "small.en",
  [string]$Url = "",       # a whisper.cpp Windows zip to use instead of looking one up
  [switch]$Offline
)
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$AppDir  = Split-Path -Parent $PSScriptRoot
$SgfdDir = Split-Path -Parent $AppDir
$Dir     = Join-Path $SgfdDir "tools\whisper"
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
function Step($t) { Write-Host "`n== $t" -ForegroundColor Cyan }

$Exe = Get-ChildItem -Path $Dir -Recurse -Filter "whisper-cli.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $Exe -and -not $Offline) {
  if ($Url) {
    $dl = $Url; $tag = "(given link)"; $name = Split-Path $Url -Leaf
  } else {
    Step "Looking for the newest whisper.cpp Windows x64 (CPU) build"
    # The vX.Y.Z releases may hold only source code; the numbered bNNNN builds carry the Windows programs.
    # Take the newest release with a plain x64 CPU zip (not CUDA / Vulkan / BLAS / OpenVINO / ARM).
    $rels = Invoke-RestMethod -Uri "https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=40" -Headers @{ "User-Agent" = "SGFD-Nexus" }
    $skip = "cuda|cublas|vulkan|blas|openvino|arm|sycl|hip|rocm|win32|x86\.zip|metal|xcframework|java|jar"
    $pick = $null
    foreach ($rel in $rels) {
      $a = $rel.assets | Where-Object { $_.name -eq "whisper-bin-x64.zip" } | Select-Object -First 1
      if (-not $a) { $a = $rel.assets | Where-Object { $_.name -match "\.zip$" -and $_.name -match "x64" -and $_.name -match "bin" -and $_.name -notmatch $skip } | Select-Object -First 1 }
      if ($a) { $pick = @{ rel = $rel; asset = $a }; break }
    }
    if (-not $pick) {
      $names = ($rels | Select-Object -First 5 | ForEach-Object { "$($_.tag_name): " + (($_.assets | ForEach-Object { $_.name }) -join ", ") }) -join "`n  "
      throw "Couldn't find a Windows x64 CPU zip in the recent whisper.cpp releases. Recent releases and their files:`n  $names`nPick the Windows x64 CPU zip and run again with -Url <its download link>, or download it by hand (see the top of this script)."
    }
    $dl = $pick.asset.browser_download_url; $tag = $pick.rel.tag_name; $name = $pick.asset.name
  }
  Step "Downloading $name ($tag)"
  $zip = Join-Path $env:TEMP $name
  Invoke-WebRequest -Uri $dl -OutFile $zip -UseBasicParsing
  Expand-Archive -Path $zip -DestinationPath $Dir -Force
  Remove-Item $zip
  Write-Host "Installed whisper.cpp $tag ($name)"
  $Exe = Get-ChildItem -Path $Dir -Recurse -Filter "whisper-cli.exe" | Select-Object -First 1
}
if (-not $Exe) { throw "whisper-cli.exe isn't in $Dir. Unzip whisper-bin-x64.zip there." }
# Nexus looks in tools\whisper itself: move the program and its DLLs up if the zip had a subfolder
if ($Exe.DirectoryName -ne $Dir) {
  Get-ChildItem -Path $Exe.DirectoryName -File | Copy-Item -Destination $Dir -Force
  Write-Host "Copied the program from $($Exe.DirectoryName) to $Dir"
}

$ModelFile = Join-Path $Dir "ggml-$Model.bin"
if (-not (Test-Path $ModelFile) -and -not $Offline) {
  Step "Downloading the $Model model (this is the big part: base ~140 MB, small ~460 MB, medium ~1.5 GB)"
  $part = "$ModelFile.part"
  $src = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$Model.bin"
  # Hugging Face sends the file from its download servers (cdn-lfs.hf.co / *.xethub.hf.co) by redirect.
  # Try Windows' curl.exe first (follows redirects, resumes, newer TLS), then BITS, then PowerShell.
  $ok = $false
  $curl = Join-Path $env:SystemRoot "System32\curl.exe"
  if (Test-Path $curl) {
    Write-Host "Trying curl.exe..."
    & $curl -L --fail --retry 5 --retry-delay 5 -C - -o $part $src
    if ($LASTEXITCODE -eq 0 -and (Test-Path $part) -and (Get-Item $part).Length -gt 50MB) { $ok = $true }
    else { Write-Host "curl.exe didn't finish (exit $LASTEXITCODE)." -ForegroundColor Yellow }
  }
  if (-not $ok) {
    try {
      Write-Host "Trying BITS..."
      Remove-Item $part -ErrorAction SilentlyContinue
      Start-BitsTransfer -Source $src -Destination $part -ErrorAction Stop
      if ((Get-Item $part).Length -gt 50MB) { $ok = $true }
    } catch { Write-Host "BITS didn't work: $($_.Exception.Message)" -ForegroundColor Yellow }
  }
  if (-not $ok) {
    try {
      Write-Host "Trying PowerShell download..."
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls11
      Invoke-WebRequest -Uri $src -OutFile $part -UseBasicParsing -ErrorAction Stop
      if ((Get-Item $part).Length -gt 50MB) { $ok = $true }
    } catch { Write-Host "PowerShell download didn't work: $($_.Exception.Message)" -ForegroundColor Yellow }
  }
  if (-not $ok) {
    Remove-Item $part -ErrorAction SilentlyContinue
    Write-Host ""
    Write-Host "This server couldn't download the model. Usually the firewall or web filter blocks Hugging Face's download servers." -ForegroundColor Red
    Write-Host "Either:"
    Write-Host "  1. Ask for outbound HTTPS to huggingface.co, cdn-lfs.huggingface.co, cdn-lfs.hf.co and *.xethub.hf.co, then run this again; or"
    Write-Host "  2. On any other computer, open this link (it downloads the file):"
    Write-Host "       $src" -ForegroundColor Cyan
    Write-Host "     copy ggml-$Model.bin to $Dir on this server, then run:"
    Write-Host "       powershell -ExecutionPolicy Bypass -File .\scripts\install-whisper.ps1 -Offline" -ForegroundColor Cyan
    exit 1
  }
  Move-Item $part $ModelFile -Force
}
if (-not (Test-Path $ModelFile)) { throw "The model file $ModelFile is missing. Copy ggml-$Model.bin into $Dir (see the top of this script)." }
if ((Get-Item $ModelFile).Length -lt 50MB) { Remove-Item $ModelFile; throw "The model file was incomplete and was removed. Run this again." }
# The official SHA-1 of each model (whisper.cpp models/README.md): a copied or mirrored file must match exactly
$Sha = @{ "base.en" = "137c40403d78fd54d454da0f9bd998f78703390c"; "small.en" = "db8a495a91d927739e50b3fc1cc4c6b8f6c2d022"; "medium.en" = "8c30f0e44ce9560643ebd10bbe50cd20eafd3723" }
Step "Checking the model file is genuine and complete"
$got = (Get-FileHash -Path $ModelFile -Algorithm SHA1).Hash.ToLower()
if ($got -ne $Sha[$Model]) {
  throw "ggml-$Model.bin doesn't match the official file (SHA-1 $got, expected $($Sha[$Model])). It's damaged, incomplete or a different file. Delete it and download it again."
}
Write-Host "Model checks out."

Step "Checking it runs"
$out = & (Join-Path $Dir "whisper-cli.exe") --help 2>&1 | Out-String
if ($out -notmatch "output-txt") { throw "whisper-cli.exe didn't start properly. If it mentions a missing DLL, install the Microsoft Visual C++ Redistributable (x64) and run this again." }
icacls $Dir /inheritance:e | Out-Null
Write-Host "`nTranscription is ready: $ModelFile" -ForegroundColor Green
Write-Host "Open a Working Fire recording in Nexus and click 'Transcribe Working Fire Audio'."
if ($Model -ne "small.en") { Write-Host "Using $Model. Nexus picks small.en first if it's also there (or set WHISPER_MODEL in .env)." }
