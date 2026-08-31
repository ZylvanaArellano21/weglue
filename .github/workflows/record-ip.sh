#!/usr/bin/env bash
# Record this runner's actual public egress IP, cross-checked against several
# independent services. A runner counts as a "unique IP" only if at least two
# services agree on the same address.
set -u
JOB="${1:-unknown}"
SHARD="${2:-0}"
mkdir -p out

fetch() { curl -sS --max-time 15 "$1" 2>/dev/null | tr -d '[:space:]'; }

A="$(fetch https://api.ipify.org)"
B="$(fetch https://checkip.amazonaws.com)"
C="$(fetch https://ifconfig.me/ip)"
D="$(fetch https://ipinfo.io/ip)"

echo "job=$JOB shard=$SHARD ipify=$A aws=$B ifconfig.me=$C ipinfo=$D"

# canonical = the value returned by a majority of the services
CANON=""
for cand in "$A" "$B" "$C" "$D"; do
  [ -z "$cand" ] && continue
  n=0
  for v in "$A" "$B" "$C" "$D"; do [ "$v" = "$cand" ] && n=$((n+1)); done
  if [ "$n" -ge 2 ]; then CANON="$cand"; break; fi
done

VERIFIED=false
[ -n "$CANON" ] && VERIFIED=true

printf '{"job":"%s","shard":"%s","ipify":"%s","aws":"%s","ifconfigme":"%s","ipinfo":"%s","canonical":"%s","verified":%s}\n' \
  "$JOB" "$SHARD" "$A" "$B" "$C" "$D" "$CANON" "$VERIFIED" > out/ip.json
cat out/ip.json

if [ "$VERIFIED" != "true" ]; then
  echo "::warning::could not verify a public IP by majority for $JOB/$SHARD"
fi
