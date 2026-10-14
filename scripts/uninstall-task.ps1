<#
.SYNOPSIS
    Unregisters the JobPilot Windows Scheduled Task.
#>
param (
    [string]$TaskName = "JobPilot"
)

$ErrorActionPreference = "Stop"

Write-Host "[JobPilot] Removing Windows Scheduled Task: '$TaskName'..." -ForegroundColor Cyan

try {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "[JobPilot] Successfully uninstalled scheduled task '$TaskName'." -ForegroundColor Green
} catch {
    Write-Error "Failed to unregister scheduled task '$TaskName': $_"
    exit 1
}
