# Watch Together - one-time setup of automatic updates (Windows).
#
#   Friend's laptop (fresh install), in PowerShell:
#     irm https://raw.githubusercontent.com/srv883/Watch-Movies-Together/main/tools/install-watch-together.ps1 | iex
#   then Chrome -> chrome://extensions -> Developer mode -> Load unpacked ->
#   the folder it prints. Done once; every later version installs itself.
#
#   An existing install: pass the folder Chrome already loads it from:
#     .\install-watch-together.ps1 -InstallDir "C:\path\to\the\extension\folder"
#
# What it sets up: the extension files in -InstallDir, the updater script in
# %LOCALAPPDATA%\WatchTogether, and a hidden updater that starts at logon
# (a shortcut in your Startup folder, "Watch Together updater") and checks
# GitHub every 10 minutes. (Startup folder, not Task Scheduler: some managed
# Windows PCs silently block user scheduled tasks.)
# Remove it any time: delete the shortcut
#   %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Watch Together updater.lnk
param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "WatchTogether\extension")
)
$ErrorActionPreference = "Stop"
$Repo = "srv883/Watch-Movies-Together"
$home2 = Join-Path $env:LOCALAPPDATA "WatchTogether"
New-Item -ItemType Directory -Force $home2 | Out-Null
$updater = Join-Path $home2 "wt-updater.ps1"
$launcher = Join-Path $home2 "wt-updater.vbs"

# 1) the updater script (next to this file, or straight from the repo)
$local = if ($PSScriptRoot) { Join-Path $PSScriptRoot "wt-updater.ps1" } else { "" }
if ($local -and (Test-Path $local)) { Copy-Item $local $updater -Force }
else {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri "https://raw.githubusercontent.com/$Repo/main/tools/wt-updater.ps1" -OutFile $updater -UseBasicParsing
}

# 2) install / update the extension files right now
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $updater -InstallDir $InstallDir
$ver = "?"
try { $ver = (Get-Content (Join-Path $InstallDir "manifest.json") -Raw | ConvertFrom-Json).version } catch {}

# 3) the hidden background updater: Startup-folder shortcut, started now as well
$psArgs = '-NoProfile -ExecutionPolicy Bypass -File "' + $updater + '" -InstallDir "' + $InstallDir + '" -Quiet -Loop'
$headless = $false
try { $headless = [int](Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion").CurrentBuildNumber -ge 22000 } catch {}
if ($headless) { $exe = "conhost.exe"; $args2 = "--headless powershell.exe " + $psArgs }
else {
  # older Windows: a tiny VBScript runs PowerShell with no window
  @('Set sh = CreateObject("WScript.Shell")', ('sh.Run "powershell.exe ' + $psArgs.Replace('"', '""') + '", 0, False')) | Set-Content -Path $launcher -Encoding ASCII
  $exe = "wscript.exe"; $args2 = '"' + $launcher + '"'
}
$startup = [Environment]::GetFolderPath("Startup")
$lnk = Join-Path $startup "Watch Together updater.lnk"
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($lnk)
$s.TargetPath = (Get-Command $exe).Source
$s.Arguments = $args2
$s.WindowStyle = 7
$s.Description = "Installs new Watch Together versions from github.com/$Repo"
$s.Save()
# an earlier version of this installer used a scheduled task - remove it
try { Unregister-ScheduledTask -TaskName "Watch Together updater" -Confirm:$false -ErrorAction Stop } catch {}
Start-Process -FilePath (Get-Command $exe).Source -ArgumentList $args2 -WindowStyle Hidden

Write-Host ""
Write-Host "Watch Together $ver is in: $InstallDir" -ForegroundColor Green
Write-Host "Automatic updates: on (checks GitHub every 10 minutes, starts with Windows)."
Write-Host "First time only: Chrome -> chrome://extensions -> Developer mode -> Load unpacked -> pick the folder above."
