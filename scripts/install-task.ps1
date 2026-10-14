<#
.SYNOPSIS
    Registers a Windows Scheduled Task to run JobPilot AI unattended at user logon.
    Requirements: Register-ScheduledTask, At log on, StartWhenAvailable.
#>
param (
    [string]$TaskName = "JobPilot"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$StartScript = Join-Path $ScriptDir "start.ps1"

if (-not (Test-Path $StartScript)) {
    Write-Error "start.ps1 could not be found at: $StartScript"
    exit 1
}

Write-Host "[JobPilot] Configuring Windows Scheduled Task: '$TaskName'..." -ForegroundColor Cyan

# 1. Action: run powershell.exe with start.ps1 in hidden window
$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$StartScript`""

# 2. Trigger: at user log on
$Trigger = New-ScheduledTaskTrigger -AtLogOn

# 3. Settings: start when available if laptop was sleeping/off, allow on battery
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

# 4. Register Scheduled Task
try {
    Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description "JobPilot AI unattended daily job search and notification worker" -Force
    Write-Host "[JobPilot] Successfully installed scheduled task '$TaskName'." -ForegroundColor Green
    Write-Host "Trigger: At Log On"
    Write-Host "Settings: StartWhenAvailable, AllowStartIfOnBatteries"
} catch {
    Write-Error "Failed to register scheduled task: $_"
    exit 1
}
