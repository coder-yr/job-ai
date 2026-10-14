<#
.SYNOPSIS
    Starts JobPilot AI services (API and Worker) from the repository root.
#>
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir

Set-Location $RepoRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js executable is not available in PATH."
    exit 1
}

Write-Host "[JobPilot] Starting JobPilot backend services (API + Worker)..." -ForegroundColor Cyan
& npm run start
