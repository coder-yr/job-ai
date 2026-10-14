<#
.SYNOPSIS
    Restores a database backup from a .sql file into a target PostgreSQL database.
#>
param (
    [string]$BackupFile,
    [string]$DatabaseUrl
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
Set-Location $RepoRoot

# Find latest backup if not specified
if (-not $BackupFile) {
    $Backups = Get-ChildItem "data/backups/*.sql" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
    if ($Backups.Count -gt 0) {
        $BackupFile = $Backups[0].FullName
        Write-Host "[JobPilot] Using latest backup: $BackupFile" -ForegroundColor Cyan
    } else {
        Write-Error "No backup file specified and no .sql files found in data/backups."
        exit 1
    }
}

if (-not (Test-Path $BackupFile)) {
    Write-Error "Backup file not found: $BackupFile"
    exit 1
}

if (-not $DatabaseUrl) {
    if (Test-Path ".env") {
        Get-Content ".env" | ForEach-Object {
            if ($_ -match "^\s*DATABASE_URL\s*=\s*['""]?(.*?)['""]?\s*$") {
                $DatabaseUrl = $matches[1]
            }
        }
    }
}

if (-not $DatabaseUrl) {
    $DatabaseUrl = "postgresql://postgres:postgres@127.0.0.1:5432/jobpilot"
}

Write-Host "[JobPilot] Restoring database from: $BackupFile" -ForegroundColor Cyan
Write-Host "Target DB: $DatabaseUrl"

if (Get-Command psql -ErrorAction SilentlyContinue) {
    try {
        & psql "$DatabaseUrl" -f "$BackupFile"
        Write-Host "[JobPilot] Database restored successfully!" -ForegroundColor Green
    } catch {
        Write-Error "psql restore failed: $_"
        exit 1
    }
} else {
    Write-Error "psql executable was not found in PATH. Please install PostgreSQL client tools or add psql to PATH."
    exit 1
}
