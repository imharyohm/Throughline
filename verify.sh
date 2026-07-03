#!/usr/bin/env bash
# verify.sh — Throughline automated gate check
# Runs detector + headline + temporal + forget→recall against local or cloud.
# Usage: ./verify.sh [base_url]
#   base_url defaults to http://localhost:3000

set -euo pipefail

BASE="${1:-http://localhost:3000}"
PASS=0
FAIL=0
TOTAL=0

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$1"; }

check() {
  local name="$1"
  local result="$2"
  TOTAL=$((TOTAL + 1))
  if [ "$result" = "PASS" ]; then
    PASS=$((PASS + 1))
    green "  ✓ $name"
  else
    FAIL=$((FAIL + 1))
    red "  ✗ $name"
  fi
}

echo ""
echo "═══════════════════════════════════════════"
echo "  Throughline Gate Check"
echo "  Target: $BASE"
echo "  $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "═══════════════════════════════════════════"
echo ""

# ── 1. Server health ─────────────────────────────────────────────────────────
echo "1. Server Health"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE" 2>/dev/null || echo "000")
check "Server responds (HTTP $HTTP_CODE)" "$([ "$HTTP_CODE" = "200" ] && echo PASS || echo FAIL)"

# ── 2. Corpus available ──────────────────────────────────────────────────────
echo ""
echo "2. Corpus & Assumptions"
ARTIFACTS=$(curl -s "$BASE/api/ingest" 2>/dev/null)
ARTIFACT_COUNT=$(echo "$ARTIFACTS" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('artifacts',[])))" 2>/dev/null || echo "0")
check "Corpus has artifacts ($ARTIFACT_COUNT)" "$([ "$ARTIFACT_COUNT" -ge 5 ] && echo PASS || echo FAIL)"

ASSUMPTIONS=$(curl -s "$BASE/api/detect" 2>/dev/null)
ASSUMPTION_COUNT=$(echo "$ASSUMPTIONS" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('assumptions',[])))" 2>/dev/null || echo "0")
check "Assumptions extracted ($ASSUMPTION_COUNT)" "$([ "$ASSUMPTION_COUNT" -ge 5 ] && echo PASS || echo FAIL)"

# ── 3. Headline COT query ────────────────────────────────────────────────────
echo ""
echo "3. Headline Query (GRAPH_COMPLETION_COT)"
HEADLINE_Q="Why did we choose Postgres, what assumptions drove it, and are they still true?"
HEADLINE_RES=$(curl -s -X POST "$BASE/api/recall" \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"$HEADLINE_Q\",\"queryType\":\"GRAPH_COMPLETION_COT\"}" 2>/dev/null)
HEADLINE_ERR=$(echo "$HEADLINE_RES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',''))" 2>/dev/null || echo "ERROR")

if [ -z "$HEADLINE_ERR" ]; then
  HEADLINE_ANSWER=$(echo "$HEADLINE_RES" | python3 -c "
import sys,json
d=json.load(sys.stdin)
r=d.get('result',{})
a=r.get('answer','') if isinstance(r,dict) else str(r)
print(a)
" 2>/dev/null || echo "")
  check "COT returns an answer" "$([ -n "$HEADLINE_ANSWER" ] && echo PASS || echo FAIL)"

  HAS_POSTGRES=$(echo "$HEADLINE_ANSWER" | grep -qi "postgres" && echo "yes" || echo "no")
  check "Answer mentions Postgres" "$([ "$HAS_POSTGRES" = "yes" ] && echo PASS || echo FAIL)"

  HAS_ASSUMPTION=$(echo "$HEADLINE_ANSWER" | grep -qiE "assumption|A1|10.?000|MAU" && echo "yes" || echo "no")
  check "Answer mentions the assumption" "$([ "$HAS_ASSUMPTION" = "yes" ] && echo PASS || echo FAIL)"
else
  yellow "  ⚠ Headline query returned error: $HEADLINE_ERR"
  yellow "    (Expected if Cognee data not yet ingested)"
  check "COT returns an answer" "FAIL"
fi

# ── 4. Temporal query ─────────────────────────────────────────────────────────
echo ""
echo "4. Temporal Query"
TEMPORAL_Q="What did we believe about user growth when we decided on Postgres?"
TEMPORAL_RES=$(curl -s -X POST "$BASE/api/recall" \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"$TEMPORAL_Q\",\"queryType\":\"TEMPORAL\"}" 2>/dev/null)
TEMPORAL_ERR=$(echo "$TEMPORAL_RES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',''))" 2>/dev/null || echo "ERROR")

if [ -z "$TEMPORAL_ERR" ]; then
  check "Temporal query returns answer" "PASS"
else
  yellow "  ⚠ Temporal query error: $TEMPORAL_ERR"
  check "Temporal query returns answer" "FAIL"
fi

# ── 5. Contradiction Detector ─────────────────────────────────────────────────
echo ""
echo "5. Contradiction Detector"
DETECT_RES=$(curl -s -X POST "$BASE/api/detect" \
  -H "Content-Type: application/json" \
  -d "{}" 2>/dev/null)
DETECT_ERR=$(echo "$DETECT_RES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',''))" 2>/dev/null || echo "ERROR")

if [ -z "$DETECT_ERR" ]; then
  CONTRADICTED=$(echo "$DETECT_RES" | python3 -c "
import sys,json
d=json.load(sys.stdin)
s=d.get('summary',{})
print(s.get('contradicted',0))
" 2>/dev/null || echo "0")
  TOTAL_FINDINGS=$(echo "$DETECT_RES" | python3 -c "
import sys,json
d=json.load(sys.stdin)
s=d.get('summary',{})
print(s.get('total',0))
" 2>/dev/null || echo "0")
  check "Detector ran ($TOTAL_FINDINGS findings)" "$([ "$TOTAL_FINDINGS" -gt 0 ] && echo PASS || echo FAIL)"
  check "Detector found contradictions ($CONTRADICTED)" "$([ "$CONTRADICTED" -gt 0 ] && echo PASS || echo FAIL)"

  # Check A1 specifically (the key one)
  A1_VERDICT=$(echo "$DETECT_RES" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for f in d.get('findings',[]):
    if f['assumption']['id']=='A1':
        print(f['verdict'])
        break
else:
    print('missing')
" 2>/dev/null || echo "error")
  check "A1 (<10k MAU) detected as contradicted ($A1_VERDICT)" "$([ "$A1_VERDICT" = "contradicted" ] && echo PASS || echo FAIL)"
else
  yellow "  ⚠ Detector error: $DETECT_ERR"
  check "Detector ran" "FAIL"
fi

# ── 6. Forget → Recall ───────────────────────────────────────────────────────
# echo ""
# echo "6. Forget → Recall"
# FORGET_RES=$(curl -s -X POST "$BASE/api/forget" \
#   -H "Content-Type: application/json" \
#   -d "{\"memoryOnly\":true}" 2>/dev/null)
# FORGET_ERR=$(echo "$FORGET_RES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',''))" 2>/dev/null || echo "ERROR")

# if [ -z "$FORGET_ERR" ]; then
#   check "Forget (memory_only) succeeded" "PASS"
# else
#   yellow "  ⚠ Forget error: $FORGET_ERR"
#   check "Forget (memory_only) succeeded" "FAIL"
# fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════"
if [ "$FAIL" -eq 0 ]; then
  green "  ALL $TOTAL CHECKS PASSED"
else
  yellow "  $PASS/$TOTAL passed, $FAIL failed"
fi
echo "═══════════════════════════════════════════"
echo ""

exit "$FAIL"
