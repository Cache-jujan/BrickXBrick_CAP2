$Email    = Read-Host "Enter your test email (e.g. testadmin@gmail.com)"
$Attempts = Read-Host "How many wrong-password attempts? (must be 1-4 to avoid triggering lockout reset)"

if (-not ($Attempts -as [int]) -or [int]$Attempts -lt 1 -or [int]$Attempts -gt 4) {
    Write-Host "Enter a number from 1 to 4. (5 triggers the lockout, which resets the counter to 0.)" -ForegroundColor Red
    exit 1
}

function Invoke-LoginTest {
    param([string]$Email, [string]$Password)
    $bodyJson = @{ email = $Email; password = $Password } | ConvertTo-Json
    try {
        $response = Invoke-RestMethod -Uri "http://localhost:3000/api/auth/login" `
                                       -Method Post -ContentType "application/json" -Body $bodyJson
        Write-Host ($response | ConvertTo-Json -Depth 5)
    }
    catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        $errorBody = $null
        if ($_.Exception.Response) {
            try {
                $stream = $_.Exception.Response.GetResponseStream()
                $reader = New-Object System.IO.StreamReader($stream)
                $errorBody = $reader.ReadToEnd()
            } catch { $errorBody = "(could not read error body)" }
        }
        Write-Host "HTTP $statusCode - $errorBody" -ForegroundColor Yellow
    }
}

function Get-AttemptCount {
    param([string]$Email)
    $nodeScript = @"
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query('SELECT failedloginattempts, lockoutuntil FROM "Users" WHERE email = `$1', ['$Email'])
  .then(r => {
    if (r.rowCount === 0) { console.log('No user found for that email.'); }
    else { console.log('failedloginattempts:', r.rows[0].failedloginattempts, '| lockoutuntil:', r.rows[0].lockoutuntil); }
    pool.end();
  })
  .catch(e => { console.error(e.message); pool.end(); });
"@
    # Written INSIDE backend (PSScriptRoot), not TEMP, so require('pg') can find node_modules.
    $tmpFile = Join-Path $PSScriptRoot "_check_attempts_tmp.js"
    Set-Content -Path $tmpFile -Value $nodeScript
    node $tmpFile
    Remove-Item $tmpFile
}

function Reset-LockoutState {
    param([string]$Email)
    $nodeScript = @"
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query('UPDATE "Users" SET failedloginattempts = 0, lockoutuntil = NULL WHERE email = `$1', ['$Email'])
  .then(r => { console.log('Reset rows affected:', r.rowCount); pool.end(); })
  .catch(e => { console.error(e.message); pool.end(); });
"@
    $tmpFile = Join-Path $PSScriptRoot "_reset_attempts_tmp.js"
    Set-Content -Path $tmpFile -Value $nodeScript
    node $tmpFile
    Remove-Item $tmpFile
}

Write-Host ""
Write-Host "Forcing a clean slate: clearing any existing lockout/attempts in Neon..." -ForegroundColor Yellow
Reset-LockoutState -Email $Email
Get-AttemptCount -Email $Email

Write-Host ""
Write-Host "Running $Attempts wrong-password attempt(s)..." -ForegroundColor Yellow
for ($i = 1; $i -le [int]$Attempts; $i++) {
    Write-Host ""
    Write-Host "Attempt $i of $Attempts (wrong password):"
    Invoke-LoginTest -Email $Email -Password "definitely-wrong-password"
    Write-Host "Current DB state:"
    Get-AttemptCount -Email $Email
}

Write-Host ""
Write-Host "Done. failedloginattempts should now read $Attempts, with lockoutuntil still NULL." -ForegroundColor Cyan
