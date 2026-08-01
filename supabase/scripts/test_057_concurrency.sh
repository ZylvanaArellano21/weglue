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

# ── RACE 4: block vs concurrent DIRECT-CONVERSATION CREATION ───────────────
# Gate-1 regression. Before get_or_create_direct_chat took the pair lock, this
# CREATED the conversation and both participant rows; the block then committed,
# leaving an empty direct thread between a blocked pair sitting in the BLOCKER's
# inbox (unhidden, because block_user's hidden_at sweep had already run).
echo "RACE 4  block (held open) vs concurrent direct-conversation creation"
reset_pair "$C"
qq "DELETE FROM conversation_participants WHERE conversation_id IN (
      SELECT c.id FROM conversations c WHERE c.type='direct'
       AND EXISTS (SELECT 1 FROM conversation_participants p WHERE p.conversation_id=c.id AND p.user_id='$C'));" >/dev/null
hold_block "$C"; sleep 1
OUT=$(qq "$(as "$C") SELECT get_or_create_direct_chat('$A');")
settle
echo "$OUT" | grep -q "interaction_unavailable" \
  && { echo "  PASS  racing direct-conversation creation was REJECTED"; PASS=$((PASS+1)); } \
  || { echo "  *** FAIL ***  DM creation not rejected: $OUT"; FAIL=$((FAIL+1)); }
check "no direct conversation exists between the blocked pair" "0" \
  "$(q "SELECT count(*) FROM conversations c WHERE c.type='direct'
        AND EXISTS (SELECT 1 FROM conversation_participants p WHERE p.conversation_id=c.id AND p.user_id='$A')
        AND EXISTS (SELECT 1 FROM conversation_participants p WHERE p.conversation_id=c.id AND p.user_id='$C');")"

# ── RACE 5: block vs concurrent GROUP CREATION including the blocker ────────
# The blocked party must be dropped from the participant list even when the
# block commits mid-call. The group itself still gets created for everyone else.
echo "RACE 5  block (held open) vs concurrent group creation including that pair"
reset_pair "$C"
qq "DELETE FROM conversations WHERE name='raced group';" >/dev/null
hold_block "$C"; sleep 1
OUT=$(qq "$(as "$C") SELECT create_group_chat('raced group', ARRAY['$A','$B']::uuid[], NULL, NULL);")
settle
check "the blocker was NOT added to the raced group" "0" \
  "$(q "SELECT count(*) FROM conversation_participants cp
         JOIN conversations c ON c.id=cp.conversation_id
        WHERE c.name='raced group' AND cp.user_id='$A';")"
check "an unrelated participant WAS still added (group not broken)" "1" \
  "$(q "SELECT count(*) FROM conversation_participants cp
         JOIN conversations c ON c.id=cp.conversation_id
        WHERE c.name='raced group' AND cp.user_id='$B';")"

# ── RACE 6: overlapping concurrent group creations must not deadlock ────────
# Locks are taken in ascending LOCK-KEY order, a total order shared by every
# transaction, so two group creations with overlapping members cannot cycle.
echo "RACE 6  overlapping concurrent group creations (deadlock check)"
# Clear EVERY block first. Earlier races leave A blocking both B and C, which
# would make g1's participant list filter down to nothing and raise
# need_participants — a correct result, but not the thing under test here.
qq "$(as "$A") SELECT unblock_user('$B'); SELECT unblock_user('$C');" >/dev/null
qq "$(as "$B") SELECT unblock_user('$A'); SELECT unblock_user('$C');" >/dev/null
qq "$(as "$C") SELECT unblock_user('$A'); SELECT unblock_user('$B');" >/dev/null
qq "DELETE FROM conversations WHERE name IN ('deadlock g1','deadlock g2');" >/dev/null
docker exec -i "$CONTAINER" psql -U pgowner -d "$DB" -q -c \
  "$(as "$A") SELECT create_group_chat('deadlock g1', ARRAY['$B','$C']::uuid[], NULL, NULL);" >/dev/null 2>&1 &
D1=$!
docker exec -i "$CONTAINER" psql -U pgowner -d "$DB" -q -c \
  "$(as "$B") SELECT create_group_chat('deadlock g2', ARRAY['$C','$A']::uuid[], NULL, NULL);" >/dev/null 2>&1 &
D2=$!
wait $D1; wait $D2
check "both overlapping group creations committed, no deadlock" "2" \
  "$(q "SELECT count(*) FROM conversations WHERE name IN ('deadlock g1','deadlock g2');")"

# ── LOCK-KEY PROPERTIES ────────────────────────────────────────────────────
echo "PROPS   pair-lock key invariants"
check "A/B and B/A produce the SAME key" "t" \
  "$(q "SELECT private.user_pair_lock_key('$A','$C') = private.user_pair_lock_key('$C','$A');")"
check "different pairs produce DIFFERENT keys" "t" \
  "$(q "SELECT private.user_pair_lock_key('$A','$C') <> private.user_pair_lock_key('$A','$B');")"
check "key function is IMMUTABLE (safe to order by)" "t" \
  "$(q "SELECT provolatile='i' FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='private' AND p.proname='user_pair_lock_key';")"
check "20k unrelated pairs map to 20k distinct keys (no global serialization)" "20000" \
  "$(q "WITH pairs AS (SELECT gen_random_uuid() a, gen_random_uuid() b FROM generate_series(1,20000))
        SELECT count(DISTINCT private.user_pair_lock_key(a,b)) FROM pairs;")"
check "advisory locks are TRANSACTION-scoped (none survive commit)" "0" \
  "$(q "SELECT count(*) FROM pg_locks WHERE locktype='advisory';")"

echo "==========================================================================="
echo "  passed=$PASS  failed=$FAIL"
[ "$FAIL" -eq 0 ] || { echo "  *** CONCURRENCY TESTS FAILED ***"; exit 1; }
echo "  ALL 057 CONCURRENCY TESTS PASSED"
