$ErrorActionPreference = 'Stop'

$TaskName = 'PixelPerfectLocalDaemon'

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

Write-Host 'Pixel Perfect Local Device Helper uninstalled.'
