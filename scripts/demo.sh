#!/usr/bin/env bash
# End-to-end demo against the mock server. Requires:
#   terminal 1: npm run mock
#   terminal 2: cp .env.mock.example .env && npm start
# then run this script.
set -euo pipefail

PROXY_URL="${PROXY_URL:-http://localhost:3099}"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

step() { printf '\n\033[1m%s\033[0m\n' "$1"; }

step "1) /target-warmup — issues a proxy session and primes the upstream cookie jar"
curl -sS -c "$JAR" -b "$JAR" "$PROXY_URL/target-warmup"
echo

step "2) POST /target-api/echo — reuses the jar's upstream cookie through the proxy"
curl -sS -c "$JAR" -b "$JAR" -X POST "$PROXY_URL/target-api/echo" \
  -H 'Content-Type: application/json' \
  -d '{"hello":"world"}'
echo

step "3) POST /verify-api/session/start — relays to the third-party widget and captures its token"
curl -sS -c "$JAR" -b "$JAR" -X POST "$PROXY_URL/verify-api/session/start" \
  -H 'Content-Type: application/json' \
  -d '{}'
echo

step "4) GET /verify-tokens/me — reads back the captured token (only valid for this session's cookie)"
curl -sS -c "$JAR" -b "$JAR" "$PROXY_URL/verify-tokens/me"
echo

step "5) sanity check — the same call WITHOUT the session cookie must be rejected"
curl -sS -o /dev/null -w 'status: %{http_code}\n' "$PROXY_URL/verify-tokens/me"
