<#
.SYNOPSIS
    Performs a database backup using pg_dump into DATA_DIR/backups.
#>
param (
    [string]$DatabaseUrl,
    [string]$BackupDir = "data/backups"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
Set-Location $RepoRoot

# Load DATABASE_URL from .env if not passed
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

$FullBackupDir = Join-Path $RepoRoot $BackupDir
if (-not (Test-Path $FullBackupDir)) {
    New-Item -ItemType Directory -Path $FullBackupDir -Force | Out-Null
}

$Timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$BackupFile = Join-Path $FullBackupDir "backup-$Timestamp.sql"

Write-Host "[JobPilot] Backing up PostgreSQL database..." -ForegroundColor Cyan
Write-Host "Target: $BackupFile"

if (Get-Command pg_dump -ErrorAction SilentlyContinue) {
    try {
        & pg_dump --dbname="$DatabaseUrl" -f "$BackupFile"
        $Size = (Get-Item $BackupFile).Length
        Write-Host "[JobPilot] Backup succeeded! File size: $Size bytes" -ForegroundColor Green
    } catch {
        Write-Error "pg_dump failed: $_"
        exit 1
    }
} else {
    Write-Warning "pg_dump command not found on PATH. Calling backend API backup endpoint..."
    try {
        $Token = ""
        if (Test-Path ".env") {
            Get-Content ".env" | ForEach-Object {
                if ($_ -match "^\s*API_TOKEN\s*=\s*['""]?(.*?)['""]?\s*$") {
                    $Token = $matches[1]
                }
            }
        }
        $Headers = @{ "x-jobpilot-token" = $Token }
        $Res = Invoke-RestMethod -Uri "http://127.0.0.1:4000/api/v1/admin/backup" -Method Post -Headers $Headers
        Write-Host "[JobPilot] Backup completed via API: $($Res.data.path)" -ForegroundColor Green
        $BackupFile = $Res.data.path
    } catch {
        Write-Error "pg_dump is required to perform offline database backups. Install PostgreSQL or add pg_dump to PATH."
        exit 1
    }
}

Write-Host "`nTo restore into a scratch DB, run:" -ForegroundColor Yellow
Write-Host "  .\scripts\restore.ps1 -BackupFile `"$BackupFile`" -DatabaseUrl `"postgresql://postgres:postgres@127.0.0.1:5432/jobpilot_scratch`""
