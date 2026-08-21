# test_admin_crud_rbac.ps1
# Tests F1: admin can create/assign/deactivate users, and that requireAuth/
# requireRole actually gate the admin routes. Run this from the backend/
# folder with the server already running (node src/server.js in another
# terminal).
#
# Steps:
#   1. Login as an existing System Administrator -> get admin JWT
#   2. GET /api/admin/users with NO token -> expect 401 (requireAuth works)
#   3. GET /api/admin/users with admin token -> expect 200 + array
#   4. POST /api/admin/users (create a throwaway Purchaser) -> expect 201
#   5. Login as that new Purchaser -> get non-admin JWT
#   6. GET /api/admin/users with the Purchaser token -> expect 403 (requireRole works)
#   7. PATCH the new user's role -> expect 200, role changed
#   8. POST .../deactivate -> expect 200, status Inactive
#   9. Try logging in as the deactivated user -> expect 403 "deactivated"
#  10. POST .../unlock -> expect 200 (smoke test only, doesn't assume it was locked)

$AdminEmail    = Read-Host "Existing System Administrator email"
$AdminPassword = Read-Host "Existing System Administrator password"

$BaseUrl = "http://localhost:3000"

function Invoke-Api {
    param(
        [string]$Method,
        [string]$Path,
        [string]$Token = $null,
        $Body = $null
    )
    $headers = @{}
    if ($Token) { $headers["Authorization"] = "Bearer $Token" }

    $params = @{
        Uri     = "$BaseUrl$Path"
        Method  = $Method
        Headers = $headers
    }
    if ($Body) {
        $params["ContentType"] = "application/json"
        $params["Body"] = ($Body | ConvertTo-Json)
    }

    try {
        $response = Invoke-RestMethod @params
        return @{ Status = 200; Body = $response }
    }
    catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        $errorBody = $null
        if ($_.Exception.Response) {
            try {
                $stream = $_.Exception.Response.GetResponseStream()
                $reader = New-Object System.IO.StreamReader($stream)
                $errorBody = $reader.ReadToEnd() | ConvertFrom-Json
            } catch { $errorBody = $null }
        }
        return @{ Status = $statusCode; Body = $errorBody }
    }
}

function Show-Result {
    param([string]$Label, [string]$Expected, $Result)
    $actual = $Result.Status
    $mark = if ("$actual" -eq "$Expected") { "PASS" } else { "CHECK ME" }
    $color = if ("$actual" -eq "$Expected") { "Green" } else { "Red" }
    Write-Host "[$mark] $Label -> HTTP $actual (expected $Expected)" -ForegroundColor $color
    if ($Result.Body) { Write-Host ($Result.Body | ConvertTo-Json -Depth 5) }
    Write-Host ""
}

# --- 1. Login as admin ---
Write-Host "=== Step 1: Login as admin ===" -ForegroundColor Cyan
$loginResult = Invoke-Api -Method Post -Path "/api/auth/login" -Body @{ email = $AdminEmail; password = $AdminPassword }
Show-Result -Label "Admin login" -Expected 200 -Result $loginResult
if ($loginResult.Status -ne 200) {
    Write-Host "Can't continue without a valid admin token. Stopping." -ForegroundColor Red
    exit 1
}
$adminToken = $loginResult.Body.token

# --- 2. LIST with no token ---
Write-Host "=== Step 2: LIST users with NO token (should be blocked) ===" -ForegroundColor Cyan
$result = Invoke-Api -Method Get -Path "/api/admin/users"
Show-Result -Label "GET /api/admin/users (no token)" -Expected 401 -Result $result

# --- 3. LIST with admin token ---
Write-Host "=== Step 3: LIST users as admin ===" -ForegroundColor Cyan
$result = Invoke-Api -Method Get -Path "/api/admin/users" -Token $adminToken
Show-Result -Label "GET /api/admin/users (admin token)" -Expected 200 -Result $result

# --- 4. CREATE a throwaway Purchaser ---
Write-Host "=== Step 4: CREATE a test Purchaser user ===" -ForegroundColor Cyan
$stamp = Get-Date -Format "yyyyMMddHHmmss"
$newEmail = "rbactest_$stamp@example.com"
$newPassword = "TestPass123!"
$createResult = Invoke-Api -Method Post -Path "/api/admin/users" -Token $adminToken -Body @{
    name = "RBAC Test User"; email = $newEmail; role = "Purchaser"; tempPassword = $newPassword
}
Show-Result -Label "POST /api/admin/users (create Purchaser)" -Expected 201 -Result $createResult
if ($createResult.Status -ne 201) {
    Write-Host "Create failed, can't continue with dependent steps. Stopping." -ForegroundColor Red
    exit 1
}
$newUserId = $createResult.Body.userid

# --- 5. Login as the new Purchaser ---
Write-Host "=== Step 5: Login as the new Purchaser ===" -ForegroundColor Cyan
$purchaserLogin = Invoke-Api -Method Post -Path "/api/auth/login" -Body @{ email = $newEmail; password = $newPassword }
Show-Result -Label "Purchaser login" -Expected 200 -Result $purchaserLogin
$purchaserToken = $purchaserLogin.Body.token

# --- 6. Purchaser tries to LIST users (should be forbidden) ---
Write-Host "=== Step 6: Purchaser tries admin route (should be 403) ===" -ForegroundColor Cyan
$result = Invoke-Api -Method Get -Path "/api/admin/users" -Token $purchaserToken
Show-Result -Label "GET /api/admin/users (Purchaser token)" -Expected 403 -Result $result

# --- 7. Admin modifies the new user's role ---
Write-Host "=== Step 7: Admin changes new user's role to Site Manager ===" -ForegroundColor Cyan
$result = Invoke-Api -Method Patch -Path "/api/admin/users/$newUserId" -Token $adminToken -Body @{ role = "Site Manager" }
Show-Result -Label "PATCH /api/admin/users/:id (role change)" -Expected 200 -Result $result

# --- 8. Admin deactivates the new user ---
Write-Host "=== Step 8: Admin deactivates the new user ===" -ForegroundColor Cyan
$result = Invoke-Api -Method Post -Path "/api/admin/users/$newUserId/deactivate" -Token $adminToken
Show-Result -Label "POST /api/admin/users/:id/deactivate" -Expected 200 -Result $result

# --- 9. Deactivated user tries to log in ---
Write-Host "=== Step 9: Deactivated user tries to log in (should be 403) ===" -ForegroundColor Cyan
$result = Invoke-Api -Method Post -Path "/api/auth/login" -Body @{ email = $newEmail; password = $newPassword }
Show-Result -Label "Login as deactivated user" -Expected 403 -Result $result

# --- 10. Admin unlocks the user (smoke test) ---
Write-Host "=== Step 10: Admin calls unlock (smoke test) ===" -ForegroundColor Cyan
$result = Invoke-Api -Method Post -Path "/api/admin/users/$newUserId/unlock" -Token $adminToken
Show-Result -Label "POST /api/admin/users/:id/unlock" -Expected 200 -Result $result

Write-Host ""
Write-Host "Done. Review any [CHECK ME] lines above -- those didn't match the expected status." -ForegroundColor Cyan
Write-Host "Test user created: $newEmail (id: $newUserId) -- currently deactivated, safe to leave or delete manually." -ForegroundColor Cyan
