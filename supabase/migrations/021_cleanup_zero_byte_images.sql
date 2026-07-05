-- ============================================================
-- We Glue – One-Time Cleanup: Zero-Byte Image Uploads
-- Migration: 021_cleanup_zero_byte_images.sql
--
-- Root cause (fixed separately in application code): uploadEventImage in
-- new-event.tsx, and (historically, before the 2026-07-04 fix) createPost
-- in postService.ts, passed a raw React Native Blob directly to
-- supabase.storage.upload(). This silently created a 0-byte object in the
-- 'posts' bucket — no error thrown — so posts.image_url / events.cover_image_url
-- were populated with a URL pointing at a file with no actual image data.
--
-- These files are unrecoverable (the bytes were never uploaded). This nulls
-- out any post/event image reference that points at a confirmed zero-byte
-- object, so the UI falls back to its placeholder instead of a permanently
-- broken image link.
-- ============================================================

UPDATE posts p
SET image_url = NULL
WHERE p.image_url IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM storage.objects o
    WHERE o.bucket_id = 'posts'
      AND (o.metadata->>'size')::bigint = 0
      AND p.image_url LIKE '%/storage/v1/object/public/posts/' || o.name
  );

UPDATE events e
SET cover_image_url = NULL
WHERE e.cover_image_url IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM storage.objects o
    WHERE o.bucket_id = 'posts'
      AND (o.metadata->>'size')::bigint = 0
      AND e.cover_image_url LIKE '%/storage/v1/object/public/posts/' || o.name
  );
