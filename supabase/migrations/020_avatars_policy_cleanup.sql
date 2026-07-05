-- ============================================================
-- We Glue – Avatars Bucket Policy Cleanup
-- Migration: 020_avatars_policy_cleanup.sql
--
-- Discovered while fixing the missing 'avatars' bucket (019): orphaned
-- policies existed on storage.objects for bucket_id = 'avatars' from a
-- prior setup attempt that was never captured in a migration (the bucket
-- row itself was missing, which is why uploads failed with "bucket not
-- found" despite these policies being present).
--
-- "avatars: auth upload" had NO per-user folder check — any authenticated
-- user could overwrite any other user's avatar file. Removing it, along
-- with the redundant underscore-named duplicates, leaving exactly the
-- ownership-scoped policies created in 019.
-- ============================================================

DROP POLICY IF EXISTS "avatars: auth upload" ON storage.objects;
DROP POLICY IF EXISTS "avatars_auth_upload" ON storage.objects;
DROP POLICY IF EXISTS "avatars_auth_update" ON storage.objects;
DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
