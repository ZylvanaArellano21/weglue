-- ============================================================
-- REVERT for temp_zylvana_officer_seed.sql — restores the exact
-- pre-seed state recorded on 2026-07-08. Removes ONLY the
-- temporary assignments for Zylvana's test account; touches no
-- clubs, no other users, no pre-existing officer records.
--
-- Run in the Supabase SQL editor (or psql with the service role).
-- ============================================================

-- 1. Remove her temporary President display rows (display_order 99
--    is the seed marker; user_id + role_title double-check it).
DELETE FROM club_officers
WHERE user_id = 'c1797f66-df96-45dd-bd73-0b0353fb8be9'
  AND role_title = 'President'
  AND display_order = 99;

-- 2. Demote the three clubs where she was a plain member before.
UPDATE club_members
SET role = 'member'
WHERE user_id = 'c1797f66-df96-45dd-bd73-0b0353fb8be9'
  AND club_id IN (
    'e87b15ef-f7d7-444b-990d-6708ea0bef7d',  -- Stock Market Club
    '46906f64-35cb-45be-80e3-a8a5dbe4c7e5',  -- Dog Club
    '06590e47-b389-469e-a8bf-447a1e31e1d6'   -- Nature Club
  );

-- 3. Remove the memberships the seed created from scratch.
DELETE FROM club_members
WHERE user_id = 'c1797f66-df96-45dd-bd73-0b0353fb8be9'
  AND club_id IN (
    'e7e87bee-6b82-4230-946b-9493691d0de5',  -- Eich club
    '2e7f7aa6-9794-4253-a0a8-ae455fc6c87c',  -- Business Club
    '925e7a84-eb0b-4c98-9460-65ee4667c611'   -- Clay Club
  );
