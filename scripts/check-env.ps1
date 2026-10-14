# scripts/check-env.ps1 - verifies node >= 22.12, ollama reachable with models, and psql can connect
$ErrorActionPreference = "Continue"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

# Load .env if present
$envFile = Join-Path $projectRoot ".env"
$ollamaHost = "http://127.0.0.1:11434"
$chatModel = "qwen2.5:7b-instruct"
$embedModel = "nomic-embed-text"
$dbUrl = ""

if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#")) {
            $parts = $line.Split("=", 2)
            if ($parts.Length -eq 2) {
                $k = $parts[0].Trim()
                $v = $parts[1].Trim().Trim('"').Trim("'")
                if ($k -eq "OLLAMA_HOST" -and $v) { $ollamaHost = $v }
                if ($k -eq "OLLAMA_CHAT_MODEL" -and $v) { $chatModel = $v }
                if ($k -eq "OLLAMA_EMBED_MODEL" -and $v) { $embedModel = $v }
                if ($k -eq "DATABASE_URL" -and $v) { $dbUrl = $v }
            }
        }
    }
}

$failed = 0

# 1. Check Node.js >= 22.12
try {
    $nodeCmd = Get-Command "node" -ErrorAction Stop
    $rawVer = (& node -v).Trim()
    $cleanVer = $rawVer.TrimStart("v")
    $verParts = $cleanVer.Split(".")
    $major = [int]$verParts[0]
    $minor = [int]$verParts[1]
    if ($major -gt 22 -or ($major -eq 22 -and $minor -ge 12)) {
        Write-Host "PASS  Node >= 22.12 ($rawVer)" -ForegroundColor Green
    } else {
        Write-Host "FAIL  Node >= 22.12 (found $rawVer) - upgrade: winget install --id OpenJS.NodeJS.LTS -e" -ForegroundColor Red
        $failed++
    }
} catch {
    Write-Host "FAIL  Node >= 22.12 (node not found on PATH)" -ForegroundColor Red
    $failed++
}

# 2. Check Ollama reachable at $ollamaHost/api/tags with both models present
try {
    $res = Invoke-RestMethod -Uri "$ollamaHost/api/tags" -Method Get -TimeoutSec 3 -ErrorAction Stop
    $have = @()
    if ($res.models) {
        $have = @($res.models | ForEach-Object { $_.name })
    }
    $need = @($chatModel, $embedModel)
    $missing = @()
    foreach ($n in $need) {
        $matched = $have | Where-Object { $_ -eq $n -or $_.StartsWith("$n`:") }
        if (-not $matched) {
            $missing += $n
        }
    }
    if ($missing.Count -eq 0) {
        Write-Host "PASS  Ollama reachable at $ollamaHost/api/tags with required models ($($need -join ', '))" -ForegroundColor Green
    } else {
        Write-Host "FAIL  Ollama missing model(s): $($missing -join ', ') - run: ollama pull <model>" -ForegroundColor Red
        $failed++
    }
} catch {
    Write-Host "FAIL  Ollama reachable at $ollamaHost/api/tags ($($_.Exception.Message)) - start Ollama from Start Menu or run 'ollama serve'" -ForegroundColor Red
    $failed++
}

# 3. Check database connection
$dbConnected = $false
try {
    $psqlCmd = Get-Command "psql" -ErrorAction SilentlyContinue
    if ($psqlCmd) {
        $null = if ($dbUrl) { & psql "$dbUrl" -c "SELECT 1" 2>&1 } else { & psql -c "SELECT 1" 2>&1 }
        if ($LASTEXITCODE -eq 0) { $dbConnected = $true }
    }
} catch {}

if (-not $dbConnected -and $dbUrl) {
    try {
        $script = "process.env.NODE_TLS_REJECT_UNAUTHORIZED='0'; const pg=require('pg'); const isRemote=process.env.DATABASE_URL.includes('supabase')||process.env.DATABASE_URL.includes('sslmode='); const c=new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: isRemote?{rejectUnauthorized:false}:undefined }); c.connect().then(()=>c.query('SELECT 1')).then(()=>{console.log('OK');process.exit(0);}).catch(()=>process.exit(1));"
        $res = & node --env-file=.env -e $script 2>&1
        if ($LASTEXITCODE -eq 0) { $dbConnected = $true }
    } catch {}
}

if ($dbConnected) {
    Write-Host "PASS  Database connection (SELECT 1) verified" -ForegroundColor Green
} else {
    Write-Host "FAIL  Database connection failed - verify DATABASE_URL and ensure service is running" -ForegroundColor Red
    $failed++
}

if ($failed -eq 0) {
    Write-Host "`nAll checks passed." -ForegroundColor Green
    exit 0
} else {
    Write-Host "`n$failed check(s) failed." -ForegroundColor Red
    exit 1
}
