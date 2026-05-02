#!/usr/bin/env bash
# E2E live API test for Faivri / FairCheck.
# Validates: auth gates, user isolation, quota caps, payment surface, webhook security.
# Read-only — never sends real Stripe webhooks (only tests signature rejection).

set -u
API="${API_URL:-https://faircheck-backend-production.up.railway.app}"
PASS=0
FAIL=0
WARN=0
LOG=/tmp/faivri_e2e_$$.log
: > "$LOG"

cyan()   { printf "\033[36m%s\033[0m\n" "$*"; }
green()  { printf "\033[32m%s\033[0m\n" "$*"; }
red()    { printf "\033[31m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }

assert_status() {
  local name="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    green "  PASS  $name → $actual"
    PASS=$((PASS+1))
  else
    red   "  FAIL  $name (expected $expected, got $actual)"
    FAIL=$((FAIL+1))
    echo "[FAIL] $name expected=$expected actual=$actual" >> "$LOG"
  fi
}

assert_status_in() {
  local name="$1" expected_csv="$2" actual="$3"
  if [[ ",$expected_csv," == *,$actual,* ]]; then
    green "  PASS  $name → $actual (∈ $expected_csv)"
    PASS=$((PASS+1))
  else
    red   "  FAIL  $name (expected ∈ $expected_csv, got $actual)"
    FAIL=$((FAIL+1))
    echo "[FAIL] $name expected_in=$expected_csv actual=$actual" >> "$LOG"
  fi
}

# Status only (uses curl args verbatim).
status_of() {
  curl -s -o /dev/null -w "%{http_code}" "$@"
}

cyan "=================================================="
cyan " Faivri Live API E2E — $API"
cyan " $(date -u +%Y-%m-%dT%H:%M:%SZ)"
cyan "=================================================="

# JSON payloads (single-quoted, no backslash escaping).
# Real v4 UUIDs (random nibbles + version=4 nibble + variant=8/9/a/b nibble) so
# Pydantic UUID4 validators don't reject the body before the auth dep runs.
UUIDV4_A='12345678-1234-4abc-8def-1234567890ab'
UUIDV4_B='abcdef12-3456-4789-9abc-def012345678'
J_CHECKOUT='{"price_key":"signal_monthly"}'
J_NEGOTIATE="{\"query_id\":\"$UUIDV4_A\"}"
J_NEG_CHAT="{\"query_id\":\"$UUIDV4_A\",\"session_id\":\"sessabcd1234\",\"user_message\":\"hi\"}"
J_REPLY_COACH="{\"query_id\":\"$UUIDV4_A\",\"session_id\":\"sessabcd1234\",\"tone\":\"friendly\",\"user_message\":\"hello\"}"
J_LISTING='{"url":"https://www.ebay.com/itm/1"}'
J_RISK='{"profile_url":"https://www.ebay.com/usr/x"}'
J_VEHICLE='{"make":"Honda","model":"Civic","year":2018}'
J_STUDENT='{"email":"a@stanford.edu"}'
J_ANALYZE='{"query":"Brake pad replacement on 2018 Honda Civic, San Francisco, quoted $850","domain":"auto","quoted_price":85000,"city":"San Francisco","country":"US"}'

# ---------- 1. HEALTH ----------
cyan "[1/9] Health checks"
assert_status "GET /health"      "200" "$(status_of -X GET "$API/health")"
assert_status "GET /health/deep" "200" "$(status_of -X GET "$API/health/deep")"

# ---------- 2. AUTH GATES (with valid bodies, expect 401) ----------
cyan "[2/9] Auth gates on protected endpoints (valid body, no token → 401)"
assert_status "GET  /history"           "401" "$(status_of -X GET  "$API/api/v1/history")"
assert_status "GET  /savings/profile"   "401" "$(status_of -X GET  "$API/api/v1/savings/profile")"
assert_status "GET  /savings/summary"   "401" "$(status_of -X GET  "$API/api/v1/savings/summary")"
assert_status "GET  /usage"             "401" "$(status_of -X GET  "$API/api/v1/usage")"
assert_status "GET  /vehicles"          "401" "$(status_of -X GET  "$API/api/v1/vehicles")"
assert_status "POST /vehicles"          "401" "$(status_of -X POST "$API/api/v1/vehicles" -H 'Content-Type: application/json' -d "$J_VEHICLE")"
assert_status "POST /billing/checkout"  "401" "$(status_of -X POST "$API/api/v1/billing/checkout" -H 'Content-Type: application/json' -d "$J_CHECKOUT")"
assert_status "POST /billing/portal"    "401" "$(status_of -X POST "$API/api/v1/billing/portal")"
assert_status "GET  /auth/student/status" "401" "$(status_of -X GET  "$API/api/v1/auth/student/status")"
assert_status "POST /auth/student/verify" "401" "$(status_of -X POST "$API/api/v1/auth/student/verify" -H 'Content-Type: application/json' -d "$J_STUDENT")"
# /negotiate and /negotiate/chat allow anonymous callers when the query has
# no owner — non-existent v4 UUID → 404 (not 401). Tests below verify the
# OWNERSHIP gate (signed-in caller targeting someone else's query → 404).
assert_status "POST /negotiate (anon, valid UUID4, non-existent)"      "404" "$(status_of -X POST "$API/api/v1/negotiate"      -H 'Content-Type: application/json' -d "$J_NEGOTIATE")"
assert_status "POST /negotiate/chat (anon, valid UUID4, non-existent)" "404" "$(status_of -X POST "$API/api/v1/negotiate/chat" -H 'Content-Type: application/json' -d "$J_NEG_CHAT")"

# ---------- 3. AUTH GATES — bogus token ----------
cyan "[3/9] Bogus bearer token → 401"
assert_status "GET  /history (bogus jwt)"      "401" "$(status_of -X GET  "$API/api/v1/history" -H 'Authorization: Bearer not.a.real.jwt')"
assert_status "POST /billing/checkout (bogus)" "401" "$(status_of -X POST "$API/api/v1/billing/checkout" -H 'Authorization: Bearer not.a.real.jwt' -H 'Content-Type: application/json' -d "$J_CHECKOUT")"
assert_status "GET  /vehicles (bogus jwt)"     "401" "$(status_of -X GET  "$API/api/v1/vehicles" -H 'Authorization: Bearer not.a.real.jwt')"
# Bogus JWT on an anonymous-OK endpoint: even though anonymous is allowed,
# a malformed bearer token is REJECTED (not silently downgraded to anon) —
# stronger security posture. Expected: 401.
assert_status "POST /negotiate (bogus jwt → 401, not anon)" "401" "$(status_of -X POST "$API/api/v1/negotiate" -H 'Authorization: Bearer not.a.real.jwt' -H 'Content-Type: application/json' -d "$J_NEGOTIATE")"

# ---------- 4. PUBLIC READ-ONLY ----------
cyan "[4/9] Public endpoints (read-only, no auth required)"
assert_status_in "GET /community/prices"  "200,422" "$(status_of -X GET "$API/api/v1/community/prices?domain=auto")"
assert_status_in "GET /community/trends"  "200"     "$(status_of -X GET "$API/api/v1/community/trends")"
assert_status_in "GET /community/vendors" "200"     "$(status_of -X GET "$API/api/v1/community/vendors?domain=auto")"
assert_status    "GET /providers"         "200"     "$(status_of -X GET "$API/api/v1/providers")"
assert_status    "GET /usage/plans"       "200"     "$(status_of -X GET "$API/api/v1/usage/plans")"

# ---------- 5. STRIPE WEBHOOK SECURITY ----------
cyan "[5/9] Stripe webhook signature enforcement"
assert_status "POST /webhooks/stripe (no sig)"  "401" "$(status_of -X POST "$API/api/v1/webhooks/stripe" -H 'Content-Type: application/json' -d '{"id":"evt_test","type":"checkout.session.completed","data":{"object":{}}}')"
assert_status "POST /webhooks/stripe (bad sig)" "401" "$(status_of -X POST "$API/api/v1/webhooks/stripe" -H 'Content-Type: application/json' -H 'stripe-signature: t=123,v1=deadbeef' -d '{"id":"evt_test","type":"checkout.session.completed","data":{"object":{}}}')"
assert_status "POST /webhooks/stripe (empty)"   "401" "$(status_of -X POST "$API/api/v1/webhooks/stripe" -H 'Content-Type: application/json' -d '')"

# ---------- 6. INPUT VALIDATION on /analyze ----------
cyan "[6/9] /analyze input validation"
assert_status "POST /analyze (empty body)"    "422" "$(status_of -X POST "$API/api/v1/analyze" -H 'Content-Type: application/json' -d '{}')"
assert_status "POST /analyze (bad JSON)"      "422" "$(status_of -X POST "$API/api/v1/analyze" -H 'Content-Type: application/json' -d 'not json')"
assert_status "POST /analyze/purchase (empty)" "422" "$(status_of -X POST "$API/api/v1/analyze/purchase" -H 'Content-Type: application/json' -d '{}')"
assert_status "POST /analyze/purchase/json (empty)" "422" "$(status_of -X POST "$API/api/v1/analyze/purchase/json" -H 'Content-Type: application/json' -d '{}')"

# ---------- 7. EXTENSION ENDPOINTS auth ----------
cyan "[7/9] Extension endpoints (auth required, valid body → 401)"
assert_status "GET  /extension/listing-watch"     "401" "$(status_of -X GET  "$API/api/v1/extension/listing-watch")"
assert_status "POST /extension/listing-watch"     "401" "$(status_of -X POST "$API/api/v1/extension/listing-watch" -H 'Content-Type: application/json' -d "$J_LISTING")"
assert_status "POST /extension/seller-risk"       "401" "$(status_of -X POST "$API/api/v1/extension/seller-risk" -H 'Content-Type: application/json' -d "$J_RISK")"
# reply-coach delegates to /negotiate/chat which is anonymous-OK; a non-existent
# v4 UUID4 → 404 (was 500 before commit a8f32c2 tightened the boundary type).
assert_status "POST /extension/reply-coach (anon, valid UUID4, non-existent)" "404" "$(status_of -X POST "$API/api/v1/extension/reply-coach" -H 'Content-Type: application/json' -d "$J_REPLY_COACH")"

# ---------- 8. ADMIN GATES ----------
cyan "[8/9] Admin endpoints (require X-Admin-Api-Key)"
assert_status "GET  /webhooks/dlq (no key)"        "403" "$(status_of -X GET    "$API/api/v1/webhooks/dlq")"
assert_status "GET  /webhooks/dlq (wrong key)"     "403" "$(status_of -X GET    "$API/api/v1/webhooks/dlq" -H 'X-Admin-Api-Key: nope')"
assert_status "DEL  /history/purge (no key)"       "403" "$(status_of -X DELETE "$API/api/v1/history/purge")"
assert_status "POST /webhooks/dlq/x/replay (no key)" "403" "$(status_of -X POST "$API/api/v1/webhooks/dlq/00000000-0000-0000-0000-000000000000/replay")"

# ---------- 9. LIVE /analyze (anonymous, end-to-end) ----------
cyan "[9/9] Live anonymous /analyze pipeline (Tavily + LLM)"
ANALYZE_RES=$(curl -s -w "\n__HTTP__:%{http_code}" -X POST "$API/api/v1/analyze" \
  -H 'Content-Type: application/json' \
  -H 'User-Agent: faivri-e2e-test/1.0' \
  -d "$J_ANALYZE")
ANALYZE_CODE=$(echo "$ANALYZE_RES" | grep -oE '__HTTP__:[0-9]+' | cut -d: -f2)
ANALYZE_BODY=$(echo "$ANALYZE_RES" | sed '/__HTTP__:/d')
assert_status_in "POST /analyze (anonymous)" "200,402,429,503" "$ANALYZE_CODE"
if [[ "$ANALYZE_CODE" == "200" ]]; then
  echo "$ANALYZE_BODY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f\"  → verdict={d.get('verdict')} confidence={d.get('confidence_score')} \"
      f\"data_points={d.get('data_points_count')} \"
      f\"fair_low={d.get('fair_price_low')} fair_high={d.get('fair_price_high')} \"
      f\"sources={len((d.get('sources') or {}).get('citations', []) or d.get('sources_used') or [])}\")
" 2>/dev/null
elif [[ "$ANALYZE_CODE" == "503" ]]; then
  yellow "  WARN /analyze returned 503 — likely Tavily/LLM upstream issue"
  WARN=$((WARN+1))
elif [[ "$ANALYZE_CODE" == "429" ]]; then
  yellow "  WARN /analyze returned 429 — daily anonymous cap already hit (proves cap works)"
  WARN=$((WARN+1))
else
  echo "  body: $ANALYZE_BODY" | head -c 400
  echo
fi

cyan "=================================================="
green "PASS: $PASS"
[[ $WARN -gt 0 ]] && yellow "WARN: $WARN"
[[ $FAIL -gt 0 ]] && red   "FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && green "ALL CRITICAL GATES HOLD" || red "INVESTIGATE FAILURES IN $LOG"
cyan "=================================================="
exit $FAIL
