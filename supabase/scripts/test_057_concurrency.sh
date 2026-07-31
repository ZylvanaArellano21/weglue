#!/bin/bash
# ===========================================================================
# Concurrency harness — migration 057 (student blocking)
#
# WHY THIS IS A SHELL SCRIPT AND NOT PART OF THE .sql HARNESS
#
# A single psql script runs one session, so it can only test INTERLEAVINGS
# ("do the block, then try the follow"). It structurally cannot reproduce the
# case that actually broke: two REAL concurrent transactions where the second
# one's RLS check runs against a snapshot that cannot yet see the first one's
# uncommitted block row.
#
# That case was found by this test, not by reading the code. Before the
# pair-scoped advisory lock existed, RACE 1 ended with a block AND a live follow
# between the same pair — a persistent, user-visible inconsistency.
#
# HOW TO RUN (throwaway database, NEVER production) — after applying
# test_057_fixture_schema.sql, 057_student_blocking.sql and
# test_057_student_blocking.sql to database `wg`:
#
#   ./supabase/scripts/test_057_concurrency.sh wg-057
# ===========================================================================
set -u

CONTAINER="${1:-wg-057}"
DB="${2:-wg}"
A='aaaaaaaa-0000-4000-8000-000000000001'
B='bbbbbbbb-0000-4000-8000-000000000002'
C='cccccccc-0000-4000-8000-000000000003'
DM='55555555-0000-4000-8000-00000000ee01'
GROUP='55555555-0000-4000-8000-00000000ee02'

PASS=0; FAIL=0
q() { docker exec -i "$CONTAINER" psql -U pgowner -d "$DB" -t -A -c "$1" 2>&1; }
qq() { docker exec -i "$CONTAINER" psql -U pgowner -d "$DB" -q -c "$1" 2>&1; }
as() { printf "SET ROLE authenticated; SELECT set_config('request.jwt.claims','{\"sub\":\"%s\"}',false);" "$1"; }

check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "  PASS  $1"; PASS=$((PASS+1));
  else echo "  *** FAIL ***  $1 (expected '$2', got '$3')"; FAIL=$((FAIL+1)); fi
}

reset_pair() {
  qq "$(as "$A") SELECT unblock_user('$1');" >/dev/null
  qq "$(as "$1") SELECT unblock_user('$A');" >/dev/null
  qq "DELETE FROM follows WHERE follower_id IN ('$A','$1') AND following_id IN ('$A','$1');" >/dev/null
}

# Session 1 opens a transaction, blocks, and HOLDS it open for 3 seconds so a
# second session can genuinely race it.
HOLD_SECONDS=3
hold_block() {
  docker exec -i "$CONTAINER" psql -U pgowner -d "$DB" -q -c "
    BEGIN;
    SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claims','{\"sub\":\"$A\"}',true);
    SELECT block_user('$1');
    SELECT pg_sleep($HOLD_SECONDS);
    COMMIT;" >/dev/null 2>&1 &
}

# The holder is backgrounded from inside a function, so its PID is not a child
# of this shell and `wait` cannot reap it. Wait on the clock instead.
settle() { sleep $((HOLD_SECONDS + 1)); }

echo "=== 057 CONCURRENCY HARNESS ==============================================="

# ── RACE 1: block vs a concurrent FOLLOW from the other party ───────────────
echo "RACE 1  block (held open) vs concurrent follow"
reset_pair "$C"
hold_block "$C"; sleep 1
OUT=$(qq "$(as "$C") INSERT INTO follows (follower_id, following_id, status) VALUES ('$C','$A','pending');")
settle
echo "$OUT" | grep -q "interaction_unavailable" \
  && { echo "  PASS  the racing follow was REJECTED at the database boundary"; PASS=$((PASS+1)); } \
  || { echo "  *** FAIL ***  racing follow was not rejected: $OUT"; FAIL=$((FAIL+1)); }
check "block row committed" "1" "$(q "SELECT count(*) FROM user_blocks WHERE blocker_id='$A' AND blocked_id='$C';")"
check "NO follow survived alongside the block" "0" \
  "$(q "SELECT count(*) FROM follows WHERE (follower_id='$C' AND following_id='$A') OR (follower_id='$A' AND following_id='$C');")"

# ── RACE 2: block vs a concurrent DIRECT MESSAGE from the other party ───────
echo "RACE 2  block (held open) vs concurrent direct message"
reset_pair "$B"
qq "DELETE FROM messages WHERE content='raced dm';" >/dev/null
hold_block "$B"; sleep 1
OUT=$(qq "$(as "$B") INSERT INTO messages (conversation_id, sender_id, content) VALUES ('$DM','$B','raced dm');")
settle
echo "$OUT" | grep -q "interaction_unavailable" \
  && { echo "  PASS  the racing direct message was REJECTED"; PASS=$((PASS+1)); } \
  || { echo "  *** FAIL ***  racing DM was not rejected: $OUT"; FAIL=$((FAIL+1)); }
check "no raced message was stored" "0" "$(q "SELECT count(*) FROM messages WHERE content='raced dm';")"

# ── CONTROL: a SHARED GROUP message must be completely unaffected ───────────
# The guard takes NO lock for non-direct conversations, and blocking never
# restricts a shared room (founder decision 2). Without this control the two
# results above could be produced by a guard that simply blocks everything.
echo "CONTROL  shared group message is unaffected while the pair is blocked"
qq "DELETE FROM messages WHERE content='group unaffected';" >/dev/null
OUT=$(qq "$(as "$B") INSERT INTO messages (conversation_id, sender_id, content) VALUES ('$GROUP','$B','group unaffected');")
check "group message from the blocked party still lands" "1" \
  "$(q "SELECT count(*) FROM messages WHERE content='group unaffected';")"

# ── RACE 3: simultaneous MUTUAL block must not deadlock ─────────────────────
# Both directions map to the SAME advisory key, so one waits for the other
# rather than the two taking locks in opposite orders.
echo "RACE 3  simultaneous mutual block (deadlock check)"
reset_pair "$C"
docker exec -i "$CONTAINER" psql -U pgowner -d "$DB" -q -c "$(as "$A") SELECT block_user('$C');" >/dev/null 2>&1 &
P1=$!
docker exec -i "$CONTAINER" psql -U pgowner -d "$DB" -q -c "$(as "$C") SELECT block_user('$A');" >/dev/null 2>&1 &
P2=$!
wait $P1; wait $P2
check "both blocks committed, no deadlock" "2" \
  "$(q "SELECT count(*) FROM user_blocks WHERE (blocker_id='$A' AND blocked_id='$C') OR (blocker_id='$C' AND blocked_id='$A');")"

echo "==========================================================================="
echo "  passed=$PASS  failed=$FAIL"
[ "$FAIL" -eq 0 ] || { echo "  *** CONCURRENCY TESTS FAILED ***"; exit 1; }
echo "  ALL 057 CONCURRENCY TESTS PASSED"
