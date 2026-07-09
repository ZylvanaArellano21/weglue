-- ============================================================
-- TEMPORARY TEST SEED — NOT PRODUCT LOGIC, NOT A MIGRATION.
-- Makes Zylvana's test account (zarellanocampos@my.lonestar.edu,
-- c1797f66-df96-45dd-bd73-0b0353fb8be9) President/officer of every
-- club that existed on 2026-07-08, so she can test officer flows.
--
-- Applied live on 2026-07-08 via the service-role REST API.
-- Revert with temp_zylvana_officer_revert.sql (exact inverse).
--
-- State BEFORE seed (recorded for the revert):
--   club_members (role 'member'):
--     e87b15ef-f7d7-444b-990d-6708ea0bef7d  Stock Market Club
--     46906f64-35cb-45be-80e3-a8a5dbe4c7e5  Dog Club
--     06590e47-b389-469e-a8bf-447a1e31e1d6  Nature Club
--   club_members (no row at all):
--     e7e87bee-6b82-4230-946b-9493691d0de5  Eich club
--     2e7f7aa6-9794-4253-a0a8-ae455fc6c87c  Business Club
--     925e7a84-eb0b-4c98-9460-65ee4667c611  Clay Club
--   club_officers: no rows for this user in any club.
-- ============================================================

-- 1. Promote her three existing memberships to officer.
UPDATE club_members
SET role = 'officer'
WHERE user_id = 'c1797f66-df96-45dd-bd73-0b0353fb8be9'
  AND club_id IN (
    'e87b15ef-f7d7-444b-990d-6708ea0bef7d',
    '46906f64-35cb-45be-80e3-a8a5dbe4c7e5',
    '06590e47-b389-469e-a8bf-447a1e31e1d6'
  );

-- 2. Add officer membership for the three clubs she wasn't in.
--    ON CONFLICT keeps this idempotent and never duplicates rows.
INSERT INTO club_members (club_id, user_id, role)
VALUES
  ('e7e87bee-6b82-4230-946b-9493691d0de5', 'c1797f66-df96-45dd-bd73-0b0353fb8be9', 'officer'),
  ('2e7f7aa6-9794-4253-a0a8-ae455fc6c87c', 'c1797f66-df96-45dd-bd73-0b0353fb8be9', 'officer'),
  ('925e7a84-eb0b-4c98-9460-65ee4667c611', 'c1797f66-df96-45dd-bd73-0b0353fb8be9', 'officer')
ON CONFLICT (club_id, user_id) DO UPDATE SET role = 'officer';

-- 3. President display rows on every club page. display_order = 99 is the
--    marker for "temporary seed row" and sorts her after real officers.
INSERT INTO club_officers (club_id, user_id, display_name, role_title, avatar_url, display_order)
SELECT c.id, 'c1797f66-df96-45dd-bd73-0b0353fb8be9', 'lola21', 'President', 'text:🐸', 99
FROM clubs c
WHERE NOT EXISTS (
  SELECT 1 FROM club_officers o
  WHERE o.club_id = c.id
    AND o.user_id = 'c1797f66-df96-45dd-bd73-0b0353fb8be9'
);
