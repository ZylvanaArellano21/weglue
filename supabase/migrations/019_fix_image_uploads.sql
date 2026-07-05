-- ============================================================
-- We Glue – Fix Image Uploads
-- Migration: 019_fix_image_uploads.sql
--
-- Root cause: the personal-avatar upload screens (auth/avatar.tsx,
-- onboarding/profile-pic.tsx, profile/edit-profile-pic.tsx) and
-- accountService.ts deletion logic all target a bucket named
-- 'avatars', which was never created by any prior migration.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars', 'avatars', true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
) ON CONFLICT (id) DO UPDATE SET
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Path convention: {user_id}/avatar.jpg — folder must be the uploader's own id.
DROP POLICY IF EXISTS "avatars: public read" ON storage.objects;
CREATE POLICY "avatars: public read"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars: users upload own" ON storage.objects;
CREATE POLICY "avatars: users upload own"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "avatars: users update own" ON storage.objects;
CREATE POLICY "avatars: users update own"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "avatars: users delete own" ON storage.objects;
CREATE POLICY "avatars: users delete own"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
