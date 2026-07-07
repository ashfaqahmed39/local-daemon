$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DaemonDir = Resolve-Path (Join-Path $ScriptDir '..')
$TaskName = 'PixelPerfectLocalDaemon'
$NodeBin = (Get-Command node.exe -ErrorAction SilentlyContinue).Source

if (-not $NodeBin) {
  Write-Error 'node.exe was not found on PATH. Install Node.js first, then rerun this script.'
}

Push-Location $DaemonDir
try {
  if (Test-Path 'package-lock.json') {
    npm ci
  } else {
    npm install
  }
} finally {
  Pop-Location
}

$ServerPath = Join-Path $DaemonDir 'src\server.js'
$Argument = "`"$ServerPath`""
$Action = New-ScheduledTaskAction -Execute $NodeBin -Argument $Argument -WorkingDirectory $DaemonDir
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$Task = New-ScheduledTask -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $TaskName -InputObject $Task | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host 'Pixel Perfect Local Device Helper installed.'
Write-Host 'Health check: http://127.0.0.1:8765/health'
Write-Host "Task: $TaskName"
