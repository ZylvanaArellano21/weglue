#!/usr/bin/env bash
# Combine every shard's ip.json + result.json into one report.
set -u
OUT=combined-report.md
: > "$OUT"

echo "# Distributed-IP capacity run — combined report" >> "$OUT"
echo "" >> "$OUT"
echo "_generated $(date -u +%Y-%m-%dT%H:%M:%SZ)_" >> "$OUT"
echo "" >> "$OUT"

# ---------- IP diversity ----------
mapfile -t IPFILES < <(find all -name ip.json | sort)
TOTAL_JOBS=${#IPFILES[@]}
VERIFIED_IPS=()
UNVERIFIED_JOBS=0
for f in "${IPFILES[@]}"; do
  v=$(jq -r '.verified' "$f")
  c=$(jq -r '.canonical' "$f")
  if [ "$v" = "true" ] && [ -n "$c" ] && [ "$c" != "null" ]; then
    VERIFIED_IPS+=("$c")
  else
    UNVERIFIED_JOBS=$((UNVERIFIED_JOBS+1))
  fi
done
UNIQUE=$(printf '%s\n' "${VERIFIED_IPS[@]}" | sort -u)
UNIQUE_COUNT=$(printf '%s\n' "${VERIFIED_IPS[@]}" | sort -u | grep -c . || true)

echo "## Public IP diversity" >> "$OUT"
echo "" >> "$OUT"
echo "| | count |" >> "$OUT"
echo "|---|---|" >> "$OUT"
echo "| runner jobs total | $TOTAL_JOBS |" >> "$OUT"
echo "| jobs with a majority-verified public IP | $((TOTAL_JOBS - UNVERIFIED_JOBS)) |" >> "$OUT"
echo "| jobs that could NOT verify an IP | $UNVERIFIED_JOBS |" >> "$OUT"
echo "| **unique verified public IPs observed** | **$UNIQUE_COUNT** |" >> "$OUT"
echo "" >> "$OUT"
echo "<details><summary>per-job IPs</summary>" >> "$OUT"
echo "" >> "$OUT"
echo '```' >> "$OUT"
for f in "${IPFILES[@]}"; do jq -c '{job,shard,canonical,verified,ipify,aws,ifconfigme,ipinfo}' "$f" >> "$OUT"; done
echo '```' >> "$OUT"
echo "" >> "$OUT"
echo "unique IPs:" >> "$OUT"
echo '```' >> "$OUT"
printf '%s\n' "$UNIQUE" >> "$OUT"
echo '```' >> "$OUT"
echo "</details>" >> "$OUT"
echo "" >> "$OUT"

# how many distinct IPs per scenario
for SC in active-50 auth-500 classroom-30; do
  n=$(find all -path "*${SC}*/ip.json" -exec jq -r 'select(.verified==true)|.canonical' {} \; | sort -u | grep -c . || true)
  echo "- $SC: $n distinct verified IPs" >> "$OUT"
done
echo "" >> "$OUT"

# ---------- auth-500 ----------
echo "## Scenario: 500 Auth / onboarding — distributed IPs" >> "$OUT"
echo "" >> "$OUT"
A_ATT=0; A_OK=0; A_429IP=0; A_429EMAIL=0; A_5XX=0; A_OTHER=0
while IFS= read -r f; do
  A_ATT=$((A_ATT + $(jq -r '.details.signups.attempted // 0' "$f")))
  A_OK=$((A_OK + $(jq -r '.details.signups.ok // 0' "$f")))
  A_429IP=$((A_429IP + $(jq -r '.details.signups.errors["429_per_ip_request"] // 0' "$f")))
  A_429EMAIL=$((A_429EMAIL + $(jq -r '.details.signups.errors["429_email_bucket"] // 0' "$f")))
  A_5XX=$((A_5XX + $(jq -r '.details.signups.errors["5xx"] // 0' "$f")))
done < <(find all -path "*auth-500*/result.json")
echo "| metric | value |" >> "$OUT"
echo "|---|---|" >> "$OUT"
echo "| signups attempted | $A_ATT |" >> "$OUT"
echo "| signups OK | $A_OK |" >> "$OUT"
echo "| 429 over_request_rate_limit (per-IP) | $A_429IP |" >> "$OUT"
echo "| 429 email bucket | $A_429EMAIL |" >> "$OUT"
echo "| 5xx | $A_5XX |" >> "$OUT"
echo "" >> "$OUT"
echo "_Per-shard emailLike patterns (for local DB-integrity verification):_" >> "$OUT"
echo '```' >> "$OUT"
find all -path "*auth-500*/result.json" -exec jq -r '"\(.details.runId // "?")  sr-\(.details.runId // "?")-%@resend.dev"' {} \; >> "$OUT"
echo '```' >> "$OUT"
echo "" >> "$OUT"

# ---------- classroom-30 ----------
echo "## Scenario: ~30 classroom onboarding — distributed IPs" >> "$OUT"
echo "" >> "$OUT"
echo '```' >> "$OUT"
find all -path "*classroom-30*/result.json" -exec jq -c '{runId:.details.runId, classroom:.details.classroom}' {} \; >> "$OUT"
echo '```' >> "$OUT"
echo "" >> "$OUT"

# ---------- active-50 ----------
echo "## Scenario: 50 active users — distributed IPs" >> "$OUT"
echo "" >> "$OUT"
echo '```' >> "$OUT"
find all -path "*active-50*/result.json" -exec jq -c '{shard:(.details.shard//null), usersReady:.details.usersReady, barrierWaitMs:(.metrics.counters["barrier_wait_ms"]//null), tables:(.metrics.tables|to_entries|map({(.key):{p50:.value.p50,p95:.value.p95,errRate:.value.errorRate}})|add)}' {} \; >> "$OUT"
echo '```' >> "$OUT"
echo "" >> "$OUT"

cat "$OUT" >> "$GITHUB_STEP_SUMMARY" 2>/dev/null || true
echo "wrote $OUT"
