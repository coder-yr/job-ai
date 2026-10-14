<#
.SYNOPSIS
    Windows Hardening Checklist from Blueprint Section 12.5.
    Prints the security commands; does NOT run administrator commands silently.
.DESCRIPTION
    1. BitLocker / Device Encryption status verification
    2. PostgreSQL localhost bind verification (listen_addresses = 'localhost')
    3. Windows Defender Firewall rule to block inbound access to app ports (4000, 5173, 11434, 5432)
    4. ACL restriction on local app data directory ($env:LOCALAPPDATA\JobPilot)
    5. Supply-chain hygiene check (npm audit --omit=dev)
#>
param (
    [switch]$Apply
)

$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   JobPilot AI - Windows Security Hardening (Section 12.5)  " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Blueprint 12.5 specifies the following 5 hardening controls:`n"

# Step 1: BitLocker / Device Encryption
Write-Host "[1] Verify BitLocker or Device Encryption status" -ForegroundColor Yellow
Write-Host "Command:" -ForegroundColor Gray
Write-Host "  manage-bde -status C:`n" -ForegroundColor White

# Step 2: PostgreSQL localhost bind
Write-Host "[2] PostgreSQL listen_addresses and pg_hba.conf loopback restriction" -ForegroundColor Yellow
Write-Host "Configuration rules in postgresql.conf and pg_hba.conf:" -ForegroundColor Gray
Write-Host "  listen_addresses = 'localhost'" -ForegroundColor White
Write-Host "  host all all 127.0.0.1/32 scram-sha-256" -ForegroundColor White
Write-Host "  host all all ::1/128 scram-sha-256`n" -ForegroundColor White

# Step 3: Windows Firewall inbound block
Write-Host "[3] Block inbound access to JobPilot ports from local network (4000, 5173, 11434, 5432)" -ForegroundColor Yellow
Write-Host "Command (requires Administrator):" -ForegroundColor Gray
$FirewallCmd = 'New-NetFirewallRule -DisplayName "JobPilot block inbound" -Direction Inbound -Action Block -Protocol TCP -LocalPort 4000,5173,11434,5432 -Profile Any'
Write-Host "  $FirewallCmd`n" -ForegroundColor White

# Step 4: Restrict data folder ACLs
Write-Host "[4] Restrict data directory access to current user account only" -ForegroundColor Yellow
Write-Host "Command:" -ForegroundColor Gray
$AclCmd = 'icacls "$env:LOCALAPPDATA\JobPilot" /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F"'
Write-Host "  $AclCmd`n" -ForegroundColor White

# Step 5: Supply chain hygiene
Write-Host "[5] Supply-chain hygiene verification" -ForegroundColor Yellow
Write-Host "Commands:" -ForegroundColor Gray
Write-Host "  npm ci" -ForegroundColor White
Write-Host "  npm audit --omit=dev`n" -ForegroundColor White

if (-not $Apply) {
    Write-Host "----------------------------------------------------------" -ForegroundColor Yellow
    Write-Host "Notice: In accordance with Blueprint 12.5 and safety guidelines," -ForegroundColor Yellow
    Write-Host "this script prints the commands and does NOT run admin commands silently." -ForegroundColor Yellow
    Write-Host "To execute these commands, run an elevated PowerShell (Run as Administrator)" -ForegroundColor Yellow
    Write-Host "or run: .\scripts\harden-windows.ps1 -Apply" -ForegroundColor Yellow
    Write-Host "----------------------------------------------------------" -ForegroundColor Yellow
    exit 0
}

# If -Apply was explicitly supplied:
Write-Host "[Apply] Applying non-destructive hardening steps..." -ForegroundColor Green

# Check admin privileges
$IsAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $IsAdmin) {
    Write-Warning "Administrator privileges required to apply firewall rules. Please re-run in an elevated PowerShell."
} else {
    Write-Host "Applying Windows Firewall rule..." -ForegroundColor Cyan
    try {
        New-NetFirewallRule -DisplayName "JobPilot block inbound" -Direction Inbound -Action Block -Protocol TCP -LocalPort 4000,5173,11434,5432 -Profile Any -ErrorAction Stop | Out-Null
        Write-Host "Firewall rule created successfully." -ForegroundColor Green
    } catch {
        Write-Warning "Could not apply firewall rule: $_"
    }
}

# Apply ACL restriction to local data dir if it exists
$DataPath = Join-Path $env:LOCALAPPDATA "JobPilot"
if (Test-Path $DataPath) {
    Write-Host "Restricting folder ACL for: $DataPath" -ForegroundColor Cyan
    & icacls "$DataPath" /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F"
}

Write-Host "`nHardening commands review complete." -ForegroundColor Green
