#!/bin/bash
# Multi-process concurrent-active: N processes, each a slice of --users.
# usage: run-sharded-active.sh <total_users> <shards> <duration_ms> <duty_ms>
U=${1:-50}; N=${2:-5}; DUR=${3:-300000}; DUTY=${4:-4000}
MAN=${MANIFEST:-results/seed-s50-50.json}
TS=$(date +%Y%m%dT%H%M%S)
echo "sharded concurrent-active: $U users / $N processes / ${DUR}ms / manifest $MAN"
LAST=""
for i in $(seq 0 $((N-1))); do
  node dist/cli.js concurrent-active -- --manifest "$MAN" --users "$U" \
    --shard "$i/$N" --duration-ms "$DUR" --duty-ms "$DUTY" \
    --signin-spacing-ms $((N*500)) > "results/sharded-$TS-shard$i.log" 2>&1 &
  LAST=$!
  echo "  shard $i pid $LAST"
  [ "$i" -lt "$((N-1))" ] && sleep 3
done
wait
echo "all shards done -> results/sharded-$TS-shard*.log"
