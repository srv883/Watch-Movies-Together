# Watch Together - updater.
# Checks the project's GitHub repo for a newer build and installs it into the
# folder Chrome loads the extension from. The extension (v1.33+) notices the
# new files and reloads itself - never in the middle of a party.
#   one check:   wt-updater.ps1 -InstallDir <folder>
#   keep going:  wt-updater.ps1 -InstallDir <folder> -Loop   (started hidden at logon)
param(
  [Parameter(Mandatory = $true)][string]$InstallDir,
  [switch]$Quiet,
  [switch]$Loop,
  [int]$EveryMinutes = 30
)
$ErrorActionPreference = "Stop"
$Repo = "srv883/Watch-Movies-Together"
$logDir = Join-Path $env:LOCALAPPDATA "WatchTogether"
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir "updater.log"
function Log([string]$m) {
  try {
    if ((Test-Path $log) -and (Get-Item $log).Length -gt 200KB) { Move-Item $log ($log + ".old") -Force }
    ("{0}  {1}" -f (Get-Date -Format s), $m) | Out-File -FilePath $log -Append -Encoding utf8
  } catch {}
}

function Update-Once {
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $latest = Invoke-RestMethod -Uri "https://raw.githubusercontent.com/$Repo/main/latest.json?t=$stamp" -UseBasicParsing -TimeoutSec 30
    $want = [string]$latest.version
    if ($want -notmatch '^\d+\.\d+\.\d+$') { throw "latest.json has no valid version" }
    $zipUrl = [string]$latest.zip
    # only ever install builds from this project's own repo
    if ($zipUrl -notmatch "^https://(github\.com|raw\.githubusercontent\.com)/$([regex]::Escape($Repo))/[\w./-]+\.zip$") { throw "download link is not in the project repo: $zipUrl" }

    $mf = Join-Path $InstallDir "manifest.json"
    $have = "0.0.0"
    if (Test-Path $mf) { $have = [string](Get-Content $mf -Raw | ConvertFrom-Json).version }
    if ([version]$want -le [version]$have) { if (-not $Quiet) { Log "up to date ($have)" }; return 0 }

    $tmp = Join-Path $env:TEMP ("wt-upd-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory $tmp | Out-Null
    try {
      $zip = Join-Path $tmp "wt.zip"
      Invoke-WebRequest -Uri $zipUrl -OutFile $zip -UseBasicParsing -TimeoutSec 180
      $x = Join-Path $tmp "x"
      Expand-Archive -Path $zip -DestinationPath $x -Force
      $newMf = Get-Content (Join-Path $x "manifest.json") -Raw | ConvertFrom-Json
      if ([string]$newMf.version -ne $want -or [string]$newMf.name -ne "Watch Together") { throw "the download is not Watch Together $want" }

      New-Item -ItemType Directory -Force $InstallDir | Out-Null
      # every file except manifest.json first...
      Get-ChildItem $x -Recurse -File | ForEach-Object {
        $rel = $_.FullName.Substring($x.Length).TrimStart('\', '/')
        if ($rel -eq "manifest.json") { return }
        $dest = Join-Path $InstallDir $rel
        New-Item -ItemType Directory -Force (Split-Path $dest -Parent) | Out-Null
        Copy-Item $_.FullName $dest -Force
      }
      # ...then the manifest: the extension only sees the new version once everything is in place
      Copy-Item (Join-Path $x "manifest.json") $mf -Force
      Log "updated $have -> $want in $InstallDir"
    } finally {
      Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
    return 0
  } catch {
    Log ("update check failed: " + $_.Exception.Message)
    return 1
  }
}

if (-not $Loop) { exit (Update-Once) }

# loop mode: one copy per user, check now and then every $EveryMinutes minutes
$created = $false
$mutex = New-Object System.Threading.Mutex($true, "Local\WatchTogetherUpdater", [ref]$created)
if (-not $created) { exit 0 }
Log ("updater running (every " + $EveryMinutes + " min) for " + $InstallDir)
while ($true) {
  [void](Update-Once)
  Start-Sleep -Seconds ([Math]::Max(1, $EveryMinutes) * 60)
}
