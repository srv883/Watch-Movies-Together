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
# %LOCALAPPDATA%\WatchTogether, and a scheduled task for the current user
# ("Watch Together updater", at logon + every 30 min). Remove it any time with
#   Unregister-ScheduledTask -TaskName "Watch Together updater" -Confirm:$false
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

# 2) a hidden launcher, so no PowerShell window flashes every 30 minutes
$cmd = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + $updater + '" -InstallDir "' + $InstallDir + '" -Quiet'
@(
  'Set sh = CreateObject("WScript.Shell")',
  ('sh.Run "' + $cmd.Replace('"', '""') + '", 0, False')
) | Set-Content -Path $launcher -Encoding ASCII

# 3) install / update the extension files right now
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $updater -InstallDir $InstallDir
$ver = "?"
try { $ver = (Get-Content (Join-Path $InstallDir "manifest.json") -Raw | ConvertFrom-Json).version } catch {}

# 4) the scheduled task (current user, no admin needed)
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument ('"' + $launcher + '"')
$every = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes 30) -RepetitionDuration (New-TimeSpan -Days 3650)
$logon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName "Watch Together updater" -Action $action -Trigger @($every, $logon) -Settings $settings `
  -Description "Installs new Watch Together versions from github.com/$Repo" -Force | Out-Null

Write-Host ""
Write-Host "Watch Together $ver is in: $InstallDir" -ForegroundColor Green
Write-Host "Automatic updates: on (every 30 minutes and at logon)."
Write-Host "First time only: Chrome -> chrome://extensions -> Developer mode -> Load unpacked -> pick the folder above."
