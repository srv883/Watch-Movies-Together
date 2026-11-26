# Watch Together - updater.
# Checks the project's GitHub repo for a newer build and installs it into the
# folder Chrome loads the extension from. The extension (v1.33+) notices the
# new files and reloads itself - never in the middle of a party.
# In loop mode it also keeps itself up to date (tools/wt-updater.ps1 in the repo).
#   one check:   wt-updater.ps1 -InstallDir <folder>
#   keep going:  wt-updater.ps1 -InstallDir <folder> -Loop   (started hidden at logon)
# updater-version: 2
param(
  [Parameter(Mandatory = $true)][string]$InstallDir,
  [switch]$Quiet,
  [switch]$Loop,
  [int]$EveryMinutes = 10
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

$script:have = "?"
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
    $script:have = $have
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
      $script:have = $want
    } finally {
      Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
    return 0
  } catch {
    Log ("update check failed: " + $_.Exception.Message)
    return 1
  }
}

# keep this updater itself current: returns $true when a newer copy was saved
function Update-Self {
  try {
    $me = $PSCommandPath
    if (-not $me -or -not (Test-Path $me)) { return $false }
    $stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $new = (Invoke-WebRequest -Uri "https://raw.githubusercontent.com/$Repo/main/tools/wt-updater.ps1?t=$stamp" -UseBasicParsing -TimeoutSec 30).Content
    if ($new -is [byte[]]) { $new = [Text.Encoding]::UTF8.GetString($new) }
    $new = [string]$new
    if (-not $new.StartsWith("# Watch Together - updater.")) { return $false }
    $old = [string](Get-Content $me -Raw)
    # only ever move to a higher updater-version (never back to an older, cached copy)
    $vNew = 0; $vOld = 0
    if ($new -match '(?m)^# updater-version: (\d+)') { $vNew = [int]$Matches[1] }
    if ($old -match '(?m)^# updater-version: (\d+)') { $vOld = [int]$Matches[1] }
    if ($vNew -le $vOld) { return $false }
    $errs = $null
    [void][System.Management.Automation.Language.Parser]::ParseInput($new, [ref]$null, [ref]$errs)
    if ($errs -and $errs.Count) { Log "updater update skipped: the new copy does not parse"; return $false }
    Set-Content -Path $me -Value $new -Encoding UTF8
    Log "updater itself updated"
    return $true
  } catch { return $false }
}

if (-not $Loop) { exit (Update-Once) }

# loop mode: one copy per user, check now and then every $EveryMinutes minutes
$created = $false
$mutex = New-Object System.Threading.Mutex($true, "Local\WatchTogetherUpdater", [ref]$created)
if (-not $created) { exit 0 }
Log ("updater running (every " + $EveryMinutes + " min) for " + $InstallDir)
$lastBeat = [DateTime]::MinValue; $lastSelf = [DateTime]::MinValue
while ($true) {
  [void](Update-Once)
  # a line a day, so the log shows it is alive
  if (((Get-Date) - $lastBeat).TotalHours -ge 24) { Log ("alive - installed version " + $script:have); $lastBeat = Get-Date }
  # a newer updater: save it and start it in place of this one
  if (((Get-Date) - $lastSelf).TotalHours -ge 6) {
    $lastSelf = Get-Date
    if (Update-Self) {
      try { $mutex.ReleaseMutex(); $mutex.Dispose() } catch {}
      $psArgs = '-NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -InstallDir "' + $InstallDir + '" -Quiet -Loop'
      $win11 = $false
      try { $win11 = [int](Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion").CurrentBuildNumber -ge 22000 } catch {}
      if ($win11) { Start-Process -FilePath "conhost.exe" -ArgumentList ("--headless powershell.exe " + $psArgs) -WindowStyle Hidden }
      else { Start-Process -FilePath "powershell.exe" -ArgumentList $psArgs -WindowStyle Hidden }
      exit 0
    }
  }
  Start-Sleep -Seconds ([Math]::Max(1, $EveryMinutes) * 60)
}
