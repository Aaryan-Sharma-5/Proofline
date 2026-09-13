#!/usr/bin/env bash
# Post-deploy verification for the public origin.
#
# Run this immediately after `docker compose up -d` on the host, or from any
# machine against the public URL. It checks what a judge or an integrating
# developer would actually hit, and it fails loudly rather than printing a wall
# of output nobody reads.
#
#   ./deploy/verify-deployment.sh                       # production default
#   ./deploy/verify-deployment.sh http://127.0.0.1:4021 # a local stack
#
# What it does NOT do: spend HBAR. Nothing here triggers a paid verification,
# so it is safe to run repeatedly. The paid paths are exercised by the capture
# suite, which is a deliberate, metered action.

set -uo pipefail

ORIGIN="${1:-https://proofline.duckdns.org}"
FAILURES=0

pass() { printf '  \033[32mok\033[0m    %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAILURES=$((FAILURES + 1)); }

code() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$@"; }

echo "Verifying ${ORIGIN}"
echo

# --- Public routes -----------------------------------------------------------
echo "Public routes"
for path in / /app /history /docs /openapi.json /health /verification; do
  got=$(code "${ORIGIN}${path}")
  if [ "$got" = "200" ]; then pass "GET ${path} -> 200"; else fail "GET ${path} -> ${got} (want 200)"; fi
done
echo

# --- The payment gate --------------------------------------------------------
# An unpaid /verify must challenge, not serve. This is the sponsor-critical
# behaviour: if it ever returns 200, the resource is being given away.
echo "Payment gate"
got=$(code -X POST "${ORIGIN}/verify")
if [ "$got" = "402" ]; then pass "POST /verify unpaid -> 402"; else fail "POST /verify unpaid -> ${got} (want 402)"; fi

got=$(code "${ORIGIN}/ping")
if [ "$got" = "402" ]; then pass "GET /ping unpaid -> 402"; else fail "GET /ping unpaid -> ${got} (want 402)"; fi

# The challenge must be a real x402 v2 offer on Hedera, not an empty 402.
challenge=$(curl -s -i -X POST --max-time 20 "${ORIGIN}/verify" \
  | grep -i '^payment-required:' | sed 's/^[Pp]ayment-[Rr]equired: //' | tr -d '\r')
if [ -n "$challenge" ]; then
  decoded=$(printf '%s' "$challenge" | base64 -d 2>/dev/null)
  for field in '"x402Version":2' '"scheme":"exact"' '"network":"hedera:testnet"' '"feePayer"'; do
    if printf '%s' "$decoded" | grep -q "$field"; then
      pass "challenge carries ${field}"
    else
      fail "challenge missing ${field}"
    fi
  done
else
  fail "no Payment-Required header on the 402"
fi
echo

# --- Internal service isolation ---------------------------------------------
# The analysis service has no gateway route. Probed adversarially, because a
# path-traversal or method-substitution slip would be invisible otherwise.
echo "Internal isolation"
for path in /analyze //analyze /verify/../analyze /./analyze; do
  got=$(code -X POST "${ORIGIN}${path}")
  if [ "$got" = "404" ] || [ "$got" = "400" ]; then
    pass "POST ${path} -> ${got} (not routable)"
  else
    fail "POST ${path} -> ${got} (must not reach the analysis service)"
  fi
done

if curl -s --max-time 20 "${ORIGIN}/openapi.json" | grep -q 'analyze'; then
  fail "public OpenAPI mentions /analyze"
else
  pass "public OpenAPI does not mention /analyze"
fi
echo

# --- Privacy -----------------------------------------------------------------
# The history projection is an allowlist. A field added upstream must not
# appear here by default, and the internal score must never be served.
echo "Privacy"
history=$(curl -s --max-time 20 "${ORIGIN}/verification?limit=5")
for leak in policy_score extraction line_items vendor beneficiary_account; do
  if printf '%s' "$history" | grep -q "\"${leak}\""; then
    fail "history exposes ${leak}"
  else
    pass "history does not expose ${leak}"
  fi
done
echo

# --- Facilitator -------------------------------------------------------------
# Bounty qualification requires Blocky402; the official facilitator is dev-only.
echo "Facilitator"
health=$(curl -s --max-time 20 "${ORIGIN}/health")
if printf '%s' "$health" | grep -q 'blocky402'; then
  pass "settling through Blocky402"
else
  fail "facilitator is not Blocky402: ${health}"
fi
if printf '%s' "$health" | grep -q 'hedera:testnet'; then
  pass "network is hedera:testnet"
else
  fail "unexpected network: ${health}"
fi
echo

if [ "$FAILURES" -eq 0 ]; then
  printf '\033[32mAll checks passed.\033[0m\n'
  exit 0
fi
printf '\033[31m%d check(s) failed.\033[0m\n' "$FAILURES"
exit 1
