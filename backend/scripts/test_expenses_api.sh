#!/usr/bin/env bash
# test_expenses_api.sh — F6 expense API test sequence (17 scenarios).
# Mirrors the manual test plan for POST /api/expenses, GET /api/expenses/mine,
# GET /api/expenses/:id.
#
# Fill in the CONFIG block below before running, then:
#   chmod +x test_expenses_api.sh
#   ./test_expenses_api.sh
#
# Each test prints: [PASS/FAIL] description -> expected vs actual status.

set -uo pipefail

# ─── CONFIG — fill these in ──────────────────────────────────────────────
BASE_URL="http://127.0.0.1:3000"          # use 127.0.0.1, not "localhost" — on Windows/
                                           # Git Bash, "localhost" can resolve to IPv6 (::1)
                                           # first and silently fail to connect (curl 000)
                                           # even when the server is up. Use your LAN IP
                                           # instead if testing from a phone/another device.

# Test account credentials — must be seeded, Active, and NOT already
# lockoutuntil-locked before you run this (5 failed logins = 15 min lock).
# Test account credentials — must be seeded, Active, and NOT already
# lockoutuntil-locked before you run this (5 failed logins = 15 min lock).
EMAIL_PURCHASER_A="testpurchaser@gmail.com"; PASSWORD_PURCHASER_A="TestPurch123!"
EMAIL_PURCHASER_B="testpurchaser2@gmail.com"; PASSWORD_PURCHASER_B="TestPurch2123!"
EMAIL_SITE_MANAGER="testsm@gmail.com"      ; PASSWORD_SITE_MANAGER="TestSm123!"

PROJECT_ID="ef403363-8377-46ee-902f-54634c558356"
TICKET_PENDING="17cb7b95-8b0f-41e9-bf95-4909090b98a6"
TICKET_ACKNOWLEDGED="b1d700b9-ef1e-42cf-801a-c008cfd1df32"
TICKET_RESOLVED_A="e88ef001-b333-4973-b697-bca903aa2c23"
TICKET_RESOLVED_B="d56bb2b6-9558-4fff-8948-7ed431582222"                  # ticket Resolved, assigned to Purchaser B
# ──────────────────────────────────────────────────────────────────────────

PASS=0
FAIL=0
LAST_EXPENSE_ID=""

# login <email> <password> -> prints the token, or empty string on failure.
# Diagnostic messages go to stderr directly (that's fine, stderr isn't
# captured by command substitution). But any variable assignment INSIDE this
# function, when called as $(login ...), happens in a subshell and is lost
# once that subshell exits — so failure tracking must happen in the caller,
# by checking whether the printed token came back empty.
login() {
    local email="$1"
    local password="$2"
    local raw
    raw=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"email\": \"$email\", \"password\": \"$password\"}")

    local http_code
    http_code=$(echo "$raw" | tail -n1)
    local body
    body=$(echo "$raw" | sed '$d')

    local token
    token=$(echo "$body" | grep -o '"token":"[^"]*"' | head -1 | sed -E 's/"token":"(.*)"/\1/')

    if [ -z "$token" ]; then
        if [ "$http_code" == "000" ]; then
            echo "!! Could not connect to $BASE_URL for $email — is the backend running?" >&2
        else
            echo "!! Login failed for $email — HTTP $http_code, response: $body" >&2
        fi
        echo ""
        return
    fi
    echo "$token"
}

echo "Logging in test accounts..."
TOKEN_PURCHASER_A=$(login "$EMAIL_PURCHASER_A" "$PASSWORD_PURCHASER_A")
TOKEN_PURCHASER_B=$(login "$EMAIL_PURCHASER_B" "$PASSWORD_PURCHASER_B")
TOKEN_SITE_MANAGER=$(login "$EMAIL_SITE_MANAGER" "$PASSWORD_SITE_MANAGER")

# Check tokens HERE, in the main shell — not via a flag set inside login().
LOGIN_FAILED=0
[ -z "$TOKEN_PURCHASER_A" ] && LOGIN_FAILED=1
[ -z "$TOKEN_PURCHASER_B" ] && LOGIN_FAILED=1
[ -z "$TOKEN_SITE_MANAGER" ] && LOGIN_FAILED=1

if [ "$LOGIN_FAILED" == "1" ]; then
    echo ""
    echo "One or more logins failed — fix the issue above before running the test scenarios." >&2
    exit 1
fi
echo "All accounts logged in."
echo ""

# run_test <description> <expected_status> <curl_args...>
run_test() {
    local desc="$1"
    local expected="$2"
    shift 2

    local response
    response=$(curl -s -o /tmp/expense_test_body.json -w "%{http_code}" "$@")

    if [ "$response" == "$expected" ]; then
        echo "[PASS] $desc -> $response"
        PASS=$((PASS + 1))
    else
        echo "[FAIL] $desc -> expected $expected, got $response"
        echo "        body: $(cat /tmp/expense_test_body.json)"
        FAIL=$((FAIL + 1))
    fi
}

json_field() {
    # tiny helper, avoids requiring jq — grabs "field":"value" or "field":value
    grep -o "\"$1\":[^,}]*" /tmp/expense_test_body.json | head -1 | sed -E 's/.*: *"?([^"]*)"?/\1/'
}

echo "=== F6 Expense API test run ==="
echo "Base URL: $BASE_URL"
echo ""

# 1. Submit against a Resolved ticket assigned to self -> 201
run_test "1. Resolved ticket assigned to A" 201 \
    -X POST "$BASE_URL/api/expenses" \
    -H "Authorization: Bearer $TOKEN_PURCHASER_A" \
    -H "Content-Type: application/json" \
    -d "{
        \"ticketID\": \"$TICKET_RESOLVED_A\",
        \"vendorName\": \"Ace Hardware\",
        \"amount\": 1250.00,
        \"receiptDate\": \"2026-09-10\",
        \"category\": \"Materials\",
        \"birValidationStatus\": \"Formal-Tax-Deductible\",
        \"receiptImageURL\": \"https://r2.example.com/receipt1.jpg\",
        \"quantity\": 3
    }"
LAST_EXPENSE_ID=$(json_field expenseid)

# 2. Submit against a Resolved ticket assigned to a different Purchaser -> 403
run_test "2. Resolved ticket assigned to B (called by A)" 403 \
    -X POST "$BASE_URL/api/expenses" \
    -H "Authorization: Bearer $TOKEN_PURCHASER_A" \
    -H "Content-Type: application/json" \
    -d "{
        \"ticketID\": \"$TICKET_RESOLVED_B\",
        \"vendorName\": \"Ace Hardware\",
        \"amount\": 500.00,
        \"receiptDate\": \"2026-09-10\",
        \"category\": \"Materials\",
        \"birValidationStatus\": \"Formal-Tax-Deductible\",
        \"receiptImageURL\": \"https://r2.example.com/receipt2.jpg\",
        \"quantity\": 1
    }"

# 3. Submit against a Pending ticket (unassigned) -> 403
# Pending tickets always have assignedTo = NULL (assigned only at PM
# acknowledge-time, per migration 005), so the assignment check in
# expenses.js fires before the status check ever runs. 403 is the
# intended behavior here, not a bug — see PR notes.
run_test "3. Pending ticket (unassigned, so 403 not 409)" 403 \
    -X POST "$BASE_URL/api/expenses" \
    -H "Authorization: Bearer $TOKEN_PURCHASER_A" \
    -H "Content-Type: application/json" \
    -d "{
        \"ticketID\": \"$TICKET_PENDING\",
        \"vendorName\": \"Ace Hardware\",
        \"amount\": 500.00,
        \"receiptDate\": \"2026-09-10\",
        \"category\": \"Materials\",
        \"birValidationStatus\": \"Formal-Tax-Deductible\",
        \"receiptImageURL\": \"https://r2.example.com/receipt3.jpg\",
        \"quantity\": 1
    }"

# 4. Submit against an Acknowledged ticket -> 409
run_test "4. Acknowledged ticket" 409 \
    -X POST "$BASE_URL/api/expenses" \
    -H "Authorization: Bearer $TOKEN_PURCHASER_A" \
    -H "Content-Type: application/json" \
    -d "{
        \"ticketID\": \"$TICKET_ACKNOWLEDGED\",
        \"vendorName\": \"Ace Hardware\",
        \"amount\": 500.00,
        \"receiptDate\": \"2026-09-10\",
        \"category\": \"Materials\",
        \"birValidationStatus\": \"Formal-Tax-Deductible\",
        \"receiptImageURL\": \"https://r2.example.com/receipt4.jpg\",
        \"quantity\": 1
    }"

# 5. No ticketID, valid projectID instead -> 201
run_test "5. No ticket, valid projectID" 201 \
    -X POST "$BASE_URL/api/expenses" \
    -H "Authorization: Bearer $TOKEN_PURCHASER_A" \
    -H "Content-Type: application/json" \
    -d "{
        \"projectID\": \"$PROJECT_ID\",
        \"vendorName\": \"Random Hardware Store\",
        \"amount\": 300.00,
        \"receiptDate\": \"2026-09-10\",
        \"category\": \"Equipment\",
        \"birValidationStatus\": \"Informal\",
        \"receiptImageURL\": \"https://r2.example.com/receipt5.jpg\",
        \"quantity\": 2
    }"

# 6. No ticketID and no projectID -> 400
run_test "6. No ticket, no projectID" 400 \
    -X POST "$BASE_URL/api/expenses" \
    -H "Authorization: Bearer $TOKEN_PURCHASER_A" \
    -H "Content-Type: application/json" \
    -d "{
        \"vendorName\": \"Random Hardware Store\",
        \"amount\": 300.00,
        \"receiptDate\": \"2026-09-10\",
        \"category\": \"Equipment\",
        \"birValidationStatus\": \"Informal\",
        \"receiptImageURL\": \"https://r2.example.com/receipt6.jpg\",
        \"quantity\": 2
    }"

# 7. category: "Labor" -> 400
run_test "7. Labor category rejected" 400 \
    -X POST "$BASE_URL/api/expenses" \
    -H "Authorization: Bearer $TOKEN_PURCHASER_A" \
    -H "Content-Type: application/json" \
    -d "{
        \"projectID\": \"$PROJECT_ID\",
        \"vendorName\": \"Random Hardware Store\",
        \"amount\": 300.00,
        \"receiptDate\": \"2026-09-10\",
        \"category\": \"Labor\",
        \"birValidationStatus\": \"Informal\",
        \"receiptImageURL\": \"https://r2.example.com/receipt7.jpg\",
        \"quantity\": 2
    }"

# 8. Invalid birValidationStatus -> 400
run_test "8. Invalid birValidationStatus" 400 \
    -X POST "$BASE_URL/api/expenses" \
    -H "Authorization: Bearer $TOKEN_PURCHASER_A" \
    -H "Content-Type: application/json" \
    -d "{
        \"projectID\": \"$PROJECT_ID\",
        \"vendorName\": \"Random Hardware Store\",
        \"amount\": 300.00,
        \"receiptDate\": \"2026-09-10\",
        \"category\": \"Materials\",
        \"birValidationStatus\": \"Something Else\",
        \"receiptImageURL\": \"https://r2.example.com/receipt8.jpg\",
        \"quantity\": 2
    }"

# 9. Missing receiptImageURL -> 400
run_test "9. Missing receiptImageURL" 400 \
    -X POST "$BASE_URL/api/expenses" \
    -H "Authorization: Bearer $TOKEN_PURCHASER_A" \
    -H "Content-Type: application/json" \
    -d "{
        \"projectID\": \"$PROJECT_ID\",
        \"vendorName\": \"Random Hardware Store\",
        \"amount\": 300.00,
        \"receiptDate\": \"2026-09-10\",
        \"category\": \"Materials\",
        \"birValidationStatus\": \"Informal\",
        \"quantity\": 2
    }"

# 10. Missing quantity -> 400
run_test "10. Missing quantity" 400 \
    -X POST "$BASE_URL/api/expenses" \
    -H "Authorization: Bearer $TOKEN_PURCHASER_A" \
    -H "Content-Type: application/json" \
    -d "{
        \"projectID\": \"$PROJECT_ID\",
        \"vendorName\": \"Random Hardware Store\",
        \"amount\": 300.00,
        \"receiptDate\": \"2026-09-10\",
        \"category\": \"Materials\",
        \"birValidationStatus\": \"Informal\",
        \"receiptImageURL\": \"https://r2.example.com/receipt10.jpg\"
    }"

# 11. Malformed lineItems (non-numeric amount) -> 400
run_test "11. Malformed lineItems" 400 \
    -X POST "$BASE_URL/api/expenses" \
    -H "Authorization: Bearer $TOKEN_PURCHASER_A" \
    -H "Content-Type: application/json" \
    -d "{
        \"projectID\": \"$PROJECT_ID\",
        \"vendorName\": \"Random Hardware Store\",
        \"amount\": 300.00,
        \"receiptDate\": \"2026-09-10\",
        \"category\": \"Materials\",
        \"birValidationStatus\": \"Informal\",
        \"receiptImageURL\": \"https://r2.example.com/receipt11.jpg\",
        \"quantity\": 2,
        \"lineItems\": [{\"description\": \"cement\", \"amount\": \"500\"}]
    }"

# 12. Valid lineItems + tin + birPermitNumber -> 201
run_test "12. Valid lineItems + tin + birPermitNumber" 201 \
    -X POST "$BASE_URL/api/expenses" \
    -H "Authorization: Bearer $TOKEN_PURCHASER_A" \
    -H "Content-Type: application/json" \
    -d "{
        \"projectID\": \"$PROJECT_ID\",
        \"vendorName\": \"Random Hardware Store\",
        \"amount\": 500.00,
        \"receiptDate\": \"2026-09-10\",
        \"category\": \"Materials\",
        \"birValidationStatus\": \"Formal-Tax-Deductible\",
        \"receiptImageURL\": \"https://r2.example.com/receipt12.jpg\",
        \"quantity\": 2,
        \"tin\": \"123-456-789-000\",
        \"birPermitNumber\": \"FP012345\",
        \"lineItems\": [{\"description\": \"cement\", \"amount\": 500}]
    }"
echo "        (check body above for tin/birPermitNumber/lineItems in response)"

# 13. Non-Purchaser role calling POST / -> 403
run_test "13. Site Manager forbidden from POST /" 403 \
    -X POST "$BASE_URL/api/expenses" \
    -H "Authorization: Bearer $TOKEN_SITE_MANAGER" \
    -H "Content-Type: application/json" \
    -d "{
        \"projectID\": \"$PROJECT_ID\",
        \"vendorName\": \"Random Hardware Store\",
        \"amount\": 300.00,
        \"receiptDate\": \"2026-09-10\",
        \"category\": \"Materials\",
        \"birValidationStatus\": \"Informal\",
        \"receiptImageURL\": \"https://r2.example.com/receipt13.jpg\",
        \"quantity\": 1
    }"

# 14. GET /mine as Purchaser A -> 200, only A's expenses
run_test "14. GET /mine (Purchaser A)" 200 \
    -X GET "$BASE_URL/api/expenses/mine" \
    -H "Authorization: Bearer $TOKEN_PURCHASER_A"
echo "        -> manually confirm every row's submittedBy is Purchaser A, none are B's"

# 15. GET /:id with a valid id -> 200
run_test "15. GET /:id (valid)" 200 \
    -X GET "$BASE_URL/api/expenses/$LAST_EXPENSE_ID" \
    -H "Authorization: Bearer $TOKEN_PURCHASER_A"

# 16. GET /:id with a made-up UUID -> 404
run_test "16. GET /:id (nonexistent)" 404 \
    -X GET "$BASE_URL/api/expenses/00000000-0000-0000-0000-000000000000" \
    -H "Authorization: Bearer $TOKEN_PURCHASER_A"

# 17. projectID derivation check (manual)
echo ""
echo "[MANUAL] 17. Confirm expense from test #1 has projectID matching TICKET_RESOLVED_A's project,"
echo "              not any projectID you could have (incorrectly) passed in the body."
echo "              curl -H \"Authorization: Bearer \$TOKEN_PURCHASER_A\" $BASE_URL/api/expenses/<id-from-test-1>"

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="