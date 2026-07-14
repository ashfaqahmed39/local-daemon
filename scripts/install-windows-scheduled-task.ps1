$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DaemonDir = (Resolve-Path (Join-Path $ScriptDir '..')).Path
$TaskName = 'PixelPerfectLocalDaemon'
$NodeBin = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
$AdbBin = (Get-Command adb.exe -ErrorAction SilentlyContinue).Source

if (-not $AdbBin) {
  $AdbCandidates = @()
  if ($env:LOCALAPPDATA) {
    $AdbCandidates += Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
  }
  if ($env:ANDROID_HOME) {
    $AdbCandidates += Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe'
  }
  if ($env:ANDROID_SDK_ROOT) {
    $AdbCandidates += Join-Path $env:ANDROID_SDK_ROOT 'platform-tools\adb.exe'
  }

  $AdbBin = $AdbCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}

if (-not $NodeBin) {
  Write-Error 'node.exe was not found on PATH. Install Node.js first, then rerun this script.'
}

if (-not $AdbBin) {
  Write-Error @'
adb.exe was not found.

Install Android Studio platform tools or add platform-tools to PATH.

Common path:
%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe

Then rerun:
npm run helper:install:windows
'@
}

Push-Location $DaemonDir
try {
  if (Test-Path 'package-lock.json') {
    npm ci
  } else {
    npm install
  }
  npm run appium:install-driver
} finally {
  Pop-Location
}

$ServerPath = Join-Path $DaemonDir 'src\server.js'
$EscapedAdbBin = $AdbBin.Replace("'", "''")
$EscapedNodeBin = $NodeBin.Replace("'", "''")
$EscapedServerPath = $ServerPath.Replace("'", "''")
$AllowedOriginsCommand = ''
if ($env:PIXEL_PERFECT_ALLOWED_ORIGINS) {
  $EscapedAllowedOrigins = $env:PIXEL_PERFECT_ALLOWED_ORIGINS.Replace("'", "''")
  $AllowedOriginsCommand = " `$env:PIXEL_PERFECT_ALLOWED_ORIGINS = '$EscapedAllowedOrigins';"
}
$StartupCommand = "`$env:ADB_PATH = '$EscapedAdbBin'; `$env:PIXEL_PERFECT_APPIUM_HOME = Join-Path `$env:USERPROFILE '.pixel-perfect-appium'; `$env:PIXEL_PERFECT_DAEMON_HOST = '0.0.0.0'; `$env:PIXEL_PERFECT_DAEMON_PORT = '8765';$AllowedOriginsCommand & '$EscapedNodeBin' '$EscapedServerPath'"
$Argument = "-NoProfile -ExecutionPolicy Bypass -Command `$ErrorActionPreference = 'Stop'; $StartupCommand"
$Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $Argument -WorkingDirectory $DaemonDir
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$Task = New-ScheduledTask -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $TaskName -InputObject $Task | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host 'Pixel Perfect Local Device Helper installed.'
Write-Host "ADB path: $AdbBin"
if ($env:PIXEL_PERFECT_ALLOWED_ORIGINS) {
  Write-Host "Allowed origins: $env:PIXEL_PERFECT_ALLOWED_ORIGINS"
}
Write-Host 'Health check: http://127.0.0.1:8765/health'
Write-Host "Task: $TaskName"
