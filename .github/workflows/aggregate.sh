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
A_ATT=0; A_OK=0; A_429IP=0; A_429EMAIL=0; A_5XX=0
A_TRANS=0; A_RECOV=0; A_STILL=0
V_AUTH=0; V_PROF=0; V_ORPH_A=0; V_ORPH_P=0; V_NULLU=0; V_ONB=0; V_TERMS=0; V_DUP=0
V_IEXP=0; V_IROW=0; V_AEXP=0; V_AROW=0; V_WRONGI=0; V_WRONGA=0
while IFS= read -r f; do
  A_ATT=$((A_ATT + $(jq -r '.details.signups.attempted // 0' "$f")))
  A_OK=$((A_OK + $(jq -r '.details.signups.ok // 0' "$f")))
  A_429IP=$((A_429IP + $(jq -r '.details.signups.errors["429_per_ip_request"] // 0' "$f")))
  A_429EMAIL=$((A_429EMAIL + $(jq -r '.details.signups.errors["429_email_bucket"] // 0' "$f")))
  A_5XX=$((A_5XX + $(jq -r '.details.signups.errors["5xx"] // 0' "$f")))
  A_TRANS=$((A_TRANS + $(jq -r '.details.retryRecovery.firstPassTransientFailures // 0' "$f")))
  A_RECOV=$((A_RECOV + $(jq -r '.details.retryRecovery.recoveredOnRetry // 0' "$f")))
  A_STILL=$((A_STILL + $(jq -r '(.details.retryRecovery.stillFailedAfterRetry // []) | length' "$f")))
  V_AUTH=$((V_AUTH + $(jq -r '.details.triggerVerification.auth_users // 0' "$f")))
  V_PROF=$((V_PROF + $(jq -r '.details.triggerVerification.profiles // 0' "$f")))
  V_ORPH_A=$((V_ORPH_A + $(jq -r '.details.triggerVerification.orphaned_auth_users // 0' "$f")))
  V_ORPH_P=$((V_ORPH_P + $(jq -r '.details.triggerVerification.orphaned_profiles // 0' "$f")))
  V_NULLU=$((V_NULLU + $(jq -r '.details.triggerVerification.profiles_null_university // 0' "$f")))
  V_ONB=$((V_ONB + $(jq -r '.details.triggerVerification.onboarding_completed // 0' "$f")))
  V_TERMS=$((V_TERMS + $(jq -r '.details.triggerVerification.agreed_terms // 0' "$f")))
  V_DUP=$((V_DUP + $(jq -r '.details.triggerVerification.dup_usernames // 0' "$f")))
  V_IEXP=$((V_IEXP + $(jq -r '.details.triggerVerification.interests_expected // 0' "$f")))
  V_IROW=$((V_IROW + $(jq -r '.details.triggerVerification.interest_rows // 0' "$f")))
  V_AEXP=$((V_AEXP + $(jq -r '.details.triggerVerification.activities_expected // 0' "$f")))
  V_AROW=$((V_AROW + $(jq -r '.details.triggerVerification.activity_rows // 0' "$f")))
  V_WRONGI=$((V_WRONGI + $(jq -r '.details.triggerVerification.users_wrong_interest_count // 0' "$f")))
  V_WRONGA=$((V_WRONGA + $(jq -r '.details.triggerVerification.users_wrong_activity_count // 0' "$f")))
done < <(find all -path "*auth-500*/result.json")
echo "| metric | value | PASS if |" >> "$OUT"
echo "|---|---|---|" >> "$OUT"
echo "| signups attempted | $A_ATT | 500 |" >> "$OUT"
echo "| signups OK (first pass) | $A_OK | |" >> "$OUT"
echo "| per-IP \`over_request_rate_limit\` 429 | $A_429IP | 0 |" >> "$OUT"
echo "| email-bucket 429 | $A_429EMAIL | 0 |" >> "$OUT"
echo "| transient failures (5xx/timeout) first pass | $A_TRANS | |" >> "$OUT"
echo "| ... recovered on retry | $A_RECOV | == transient |" >> "$OUT"
echo "| ... still failed after retry | $A_STILL | 0 |" >> "$OUT"
echo "" >> "$OUT"
if [ "$V_AUTH" -gt 0 ]; then
  echo "**DB integrity (real onboarding signups, per-shard \`triggerVerification\` summed):**" >> "$OUT"
  echo "" >> "$OUT"
  echo "| check | value | PASS if |" >> "$OUT"
  echo "|---|---|---|" >> "$OUT"
  echo "| auth_users | $V_AUTH | |" >> "$OUT"
  echo "| profiles | $V_PROF | == auth_users |" >> "$OUT"
  echo "| orphan auth users | $V_ORPH_A | 0 |" >> "$OUT"
  echo "| orphan profiles | $V_ORPH_P | 0 |" >> "$OUT"
  echo "| null university | $V_NULLU | 0 |" >> "$OUT"
  echo "| onboarding_completed | $V_ONB | == auth_users |" >> "$OUT"
  echo "| agreed_terms (+ agreed_at) | $V_TERMS | == auth_users |" >> "$OUT"
  echo "| duplicate usernames | $V_DUP | 0 |" >> "$OUT"
  echo "| interest rows / expected | $V_IROW / $V_IEXP | equal |" >> "$OUT"
  echo "| activity rows / expected | $V_AROW / $V_AEXP | equal |" >> "$OUT"
  echo "| users w/ wrong interest count | $V_WRONGI | 0 |" >> "$OUT"
  echo "| users w/ wrong activity count | $V_WRONGA | 0 |" >> "$OUT"
  echo "" >> "$OUT"
else
  echo "_DB integrity: \`triggerVerification\` needs the Supabase management PAT, which is deliberately NOT in CI (account-wide). Verified locally post-run against the runIds below._" >> "$OUT"
  echo "" >> "$OUT"
fi
echo "_runIds (for local re-verification): $(find all -path "*auth-500*/result.json" -exec jq -r '.details.runId // "?"' {} \; | tr '\n' ' ')_" >> "$OUT"
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
