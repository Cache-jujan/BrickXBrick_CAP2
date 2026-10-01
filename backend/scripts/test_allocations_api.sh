#!/usr/bin/env bash
# F8 hybrid allocation integration checks. Run only against an isolated test DB.
# Required environment: BASE_URL, DATABASE_URL, TOKEN_PURCHASER,
# TOKEN_SITE_MANAGER, PROJECT_A, PROJECT_B, RECEIPT_IMAGE_URL, ALLOW_TEST_DATA=1.
# RECEIPT_IMAGE_URL must be a URL previously issued by this backend's receipt scan.

set -euo pipefail

: "${BASE_URL:?Set BASE_URL, e.g. http://127.0.0.1:3000}"
: "${DATABASE_URL:?Set DATABASE_URL for an isolated test database}"
: "${TOKEN_PURCHASER:?Set TOKEN_PURCHASER to an active Purchaser JWT}"
: "${TOKEN_SITE_MANAGER:?Set TOKEN_SITE_MANAGER to an active Site Manager JWT}"
: "${PROJECT_A:?Set PROJECT_A to an active project UUID}"
: "${PROJECT_B:?Set PROJECT_B to a different active project UUID}"
: "${RECEIPT_IMAGE_URL:?Set RECEIPT_IMAGE_URL to a receipt URL returned by /api/receipts/scan}"

if [[ "${ALLOW_TEST_DATA:-}" != "1" ]]; then
  echo "Refusing to create test expenses. Set ALLOW_TEST_DATA=1 only for an isolated test database." >&2
  exit 2
fi
command -v curl >/dev/null
command -v python3 >/dev/null
command -v psql >/dev/null || { echo "psql is required for persisted-row assertions" >&2; exit 2; }
BASE_URL="${BASE_URL%/}"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT
PASS=0

write_body() {
  local target="$1" mode="$2" image_url="$3" bad_quantity="${4:-0}"
  python3 - "$target" "$mode" "$image_url" "$PROJECT_A" "$PROJECT_B" "$bad_quantity" <<'PY'
import json, sys
path, mode, image, project_a, project_b, bad_quantity = sys.argv[1:]
common = {
    "receiptImageURL": image,
    "vendorName": "F8 integration fixture",
    "receiptDate": "2026-09-10",
    "category": "Materials",
    "receiptTotal": 45.75,
}
if mode == "itemized":
    common.update({
        "lineItems": [{"lineNumber": 1, "description": "Test cement", "quantity": 50, "amount": 45.75}],
        "allocations": [
            {"lineNumber": 1, "projectID": project_a, "quantity": 30},
            {"lineNumber": 1, "projectID": project_b, "quantity": 19 if bad_quantity == "1" else 20},
        ],
    })
elif mode == "manual":
    common["manualAmountAllocations"] = [
        {"projectID": project_a, "amount": 20},
        {"projectID": project_b, "amount": 25.75},
    ]
else:
    raise SystemExit(f"unknown mode: {mode}")
with open(path, "w", encoding="utf-8") as stream:
    json.dump(common, stream)
PY
}

post_allocation() {
  local token="$1" body_file="$2" response_file="$3"
  curl --silent --show-error -o "$response_file" -w '%{http_code}' \
    -X POST "$BASE_URL/api/allocations" \
    -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/json' \
    --data-binary "@$body_file"
}

assert_status() {
  local label="$1" expected="$2" actual="$3" body_file="$4"
  if [[ "$actual" != "$expected" ]]; then
    echo "[FAIL] $label: expected HTTP $expected, got $actual" >&2
    cat "$body_file" >&2
    exit 1
  fi
  echo "[PASS] $label -> HTTP $actual"
  PASS=$((PASS + 1))
}

psql_value() {
  local sql="$1" common_id="${2:-}"
  if [[ -n "$common_id" ]]; then
    psql "$DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 -v common="$common_id" -c "$sql"
  else
    psql "$DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 -c "$sql"
  fi
}

# UTC003: a source line split 30/20 by quantity derives project expenses and
# preserves two allocation rows, source-line quantity, and total cents.
write_body "$TMP_DIR/itemized.json" itemized "$RECEIPT_IMAGE_URL"
HTTP=$(post_allocation "$TOKEN_PURCHASER" "$TMP_DIR/itemized.json" "$TMP_DIR/itemized-response.json")
assert_status "UTC003 itemized quantity split" 201 "$HTTP" "$TMP_DIR/itemized-response.json"
COMMON_ID=$(python3 - "$TMP_DIR/itemized-response.json" <<'PY'
import json, sys
body = json.load(open(sys.argv[1], encoding="utf-8"))
assert body.get("mode") == "quantity", body
assert len(body.get("expenses", [])) == 2, body
print(body["commonReceiptID"])
PY
)
ROWS=$(psql_value "SELECT COUNT(DISTINCT expenseid)||'|'||COUNT(*)||'|'||SUM(allocatedamount)||'|'||SUM(allocatedquantity) FROM receiptallocations WHERE commonreceiptid = :'common'" "$COMMON_ID")
[[ "$ROWS" == "2|2|45.75|50.00" ]] || { echo "[FAIL] persisted itemized allocations: expected 2|2|45.75|50.00, got $ROWS" >&2; exit 1; }
LINES=$(psql_value "SELECT COUNT(*) FROM receiptlineitems WHERE commonreceiptid = :'common'" "$COMMON_ID")
[[ "$LINES" == "1" ]] || { echo "[FAIL] persisted source line count: expected 1, got $LINES" >&2; exit 1; }
echo "[PASS] UTC003 persisted rows -> 2 expenses, 2 portions, ₱45.75, 50 units, 1 source line"
PASS=$((PASS + 1))

# UTC004: under-allocating a source quantity fails before any write.
BEFORE=$(psql_value "SELECT (SELECT COUNT(*) FROM expenses)||'|'||(SELECT COUNT(*) FROM receiptallocations)")
write_body "$TMP_DIR/underallocated.json" itemized "$RECEIPT_IMAGE_URL" 1
HTTP=$(post_allocation "$TOKEN_PURCHASER" "$TMP_DIR/underallocated.json" "$TMP_DIR/underallocated-response.json")
assert_status "UTC004 unallocated source quantity" 400 "$HTTP" "$TMP_DIR/underallocated-response.json"
AFTER=$(psql_value "SELECT (SELECT COUNT(*) FROM expenses)||'|'||(SELECT COUNT(*) FROM receiptallocations)")
[[ "$BEFORE" == "$AFTER" ]] || { echo "[FAIL] invalid quantity request wrote rows: before=$BEFORE after=$AFTER" >&2; exit 1; }
echo "[PASS] UTC004 invalid request left expense/allocation counts unchanged"
PASS=$((PASS + 1))

# Receipt integrity gate: malformed/non-server-issued image URL fails before writes.
write_body "$TMP_DIR/bad-image.json" manual "http://invalid.example/receipts/files/not-a-uuid.jpg"
HTTP=$(post_allocation "$TOKEN_PURCHASER" "$TMP_DIR/bad-image.json" "$TMP_DIR/bad-image-response.json")
assert_status "non-server-issued receipt URL" 400 "$HTTP" "$TMP_DIR/bad-image-response.json"

# Role gate: Site Manager is not authorized to initiate F8.
write_body "$TMP_DIR/forbidden.json" manual "$RECEIPT_IMAGE_URL"
HTTP=$(post_allocation "$TOKEN_SITE_MANAGER" "$TMP_DIR/forbidden.json" "$TMP_DIR/forbidden-response.json")
assert_status "Site Manager role denied" 403 "$HTTP" "$TMP_DIR/forbidden-response.json"

# UTC006: manual amount fallback remains available for lump-sum/no-line receipts.
write_body "$TMP_DIR/manual.json" manual "$RECEIPT_IMAGE_URL"
HTTP=$(post_allocation "$TOKEN_PURCHASER" "$TMP_DIR/manual.json" "$TMP_DIR/manual-response.json")
assert_status "UTC006 manual amount fallback" 201 "$HTTP" "$TMP_DIR/manual-response.json"
MANUAL_ID=$(python3 - "$TMP_DIR/manual-response.json" <<'PY'
import json, sys
body = json.load(open(sys.argv[1], encoding="utf-8"))
assert body.get("mode") == "amount", body
assert len(body.get("expenses", [])) == 2, body
print(body["commonReceiptID"])
PY
)
MANUAL_NULL_QTY=$(psql_value "SELECT COUNT(*) FROM expenses e JOIN receiptallocations a USING (expenseid) WHERE a.commonreceiptid = :'common' AND e.quantity IS NULL" "$MANUAL_ID")
[[ "$MANUAL_NULL_QTY" == "2" ]] || { echo "[FAIL] manual fallback should persist NULL quantity for both expenses; got $MANUAL_NULL_QTY" >&2; exit 1; }
echo "[PASS] manual fallback persisted two amount-mode expenses with NULL quantity"
PASS=$((PASS + 1))

echo "=== F8 integration checks: $PASS passed ==="
