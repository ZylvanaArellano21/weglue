-- ============================================================================
-- 090 — app_releases table + the "new update" push notification (Section 1
--        backend: client contract documented in
--        apps/mobile/hooks/useAppUpdateStatus.ts)
-- ============================================================================
--
-- app_releases: one row per platform+version. `is_public` must only ever be
-- set true once that exact version is ACTUALLY 100% publicly downloadable
-- from the App Store / Play Store — never for a TestFlight build, an
-- internal-testing track, or a build still in review. This is a manual,
-- deliberate action (publish_app_release below), never inferred from a
-- store-API poll: there is no reliable signal for "fully rolled out" to
-- poll, and staged rollouts make guessing unsafe (the client-side badge
-- must never light up for someone who genuinely cannot download it yet).
--
-- Clients (apps/mobile/hooks/useAppUpdateStatus.ts) read this table
-- directly: SELECT version WHERE platform=<theirs> AND is_public=true ORDER
-- BY released_at DESC LIMIT 1, then compare against the real installed
-- native version (expo-application, immune to OTA). RLS below only ever
-- exposes is_public=true rows — a draft/unpublished row is invisible to
-- every client, even under an app bug that queried without the is_public
-- filter.
--
-- publish_app_release(platform, version): the one write path. Marks a
-- version public and fans out exactly one push per eligible user on that
-- platform — "eligible" = an active, production push token for that
-- platform; a device that has already updated may still receive this (the
-- server has no way to know a token's current installed app version, only
-- expo-application on-device does — this mirrors how every store's own
-- version-availability banner works, client-side only). Restricted to a
-- platform_admin identity (is_platform_admin_auth — migration 053, the same
-- check every other admin-only SECURITY DEFINER function in this codebase
-- uses), OR a session with no JWT context at all (auth.uid() IS NULL) —
-- i.e. a direct privileged DB session (Supabase Studio's SQL editor, a
-- migration, a service-role script), never a public/anon/authenticated
-- client call. To run this from Studio as the founder's own platform_admin
-- identity (recommended, so the admin-action check above is exercised for
-- real rather than bypassed), set the same JWT claim this repo's own test
-- harnesses use before calling it:
--   SELECT set_config('request.jwt.claims',
--     json_build_object('sub', '<founder-auth-uid>', 'role', 'authenticated')::text,
--     true);
--   SELECT public.publish_app_release('ios', '1.0.4');
--
-- No Admin Dashboard UI is added by this migration — that was an explicit
-- STOP-and-ask item in the founder's task brief for this feature. This is
-- the backend lever only; a dashboard screen (if wanted) is a separate,
-- to-be-approved follow-up.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.app_releases (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform    TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  version     TEXT NOT NULL,
  is_public   BOOLEAN NOT NULL DEFAULT false,
  released_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform, version)
);

ALTER TABLE public.app_releases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_releases: anyone can read public releases" ON public.app_releases;
CREATE POLICY "app_releases: anyone can read public releases"
  ON public.app_releases FOR SELECT
  USING (is_public = true);
-- authenticated needs the table-level GRANT to even attempt a SELECT — RLS
-- above is what actually narrows it to is_public=true rows. No INSERT/
-- UPDATE/DELETE grant at all: only publish_app_release() (SECURITY DEFINER,
-- runs as its owner) or a service-role/superuser session can write.
GRANT SELECT ON public.app_releases TO authenticated;

-- notify_photo_post_university/etc. use category 'account' for a reason:
-- user_wants_push() already special-cases it to always return true,
-- bypassing the in-app category toggle entirely — the founder's spec wants
-- this gated ONLY by real OS push permission (i.e. an active token),
-- exactly what 'account' already means elsewhere in this schema, just not
-- yet used by any real type. blockable=false because this notification has
-- no actor to block (a system/account notice, not a personal interaction —
-- same class as club_post/new_event, see migration 057's classification).
-- in_app=false: this is push-only, no Notifications-inbox row — the
-- in-app signal is the sidebar Update badge (client-side), not an inbox
-- entry.
INSERT INTO public.notification_types (type, category, push, in_app, enabled, group_window_minutes, blockable, description)
VALUES ('app_update', 'account', true, false, true, 0, false, 'A new We Glue version is publicly available.')
ON CONFLICT (type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.publish_app_release(p_platform TEXT, p_version TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipient RECORD;
BEGIN
  IF p_platform NOT IN ('ios', 'android') THEN
    RAISE EXCEPTION 'invalid platform: %', p_platform;
  END IF;

  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM auth.users u
     WHERE u.id = auth.uid() AND public.is_platform_admin_auth(u.raw_app_meta_data)
  ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  INSERT INTO public.app_releases (platform, version, is_public, released_at, updated_at)
  VALUES (p_platform, p_version, true, now(), now())
  ON CONFLICT (platform, version) DO UPDATE
    SET is_public = true,
        released_at = COALESCE(public.app_releases.released_at, now()),
        updated_at = now();

  -- One push per eligible user: an active, production token on this
  -- platform. dedupe_key is keyed by (platform, version, user) so calling
  -- this twice for the same already-public version never double-sends.
  FOR v_recipient IN
    SELECT DISTINCT pt.user_id
      FROM public.push_tokens pt
     WHERE pt.platform = p_platform
       AND pt.status = 'active'
       AND pt.environment = 'production'
  LOOP
    PERFORM public.enqueue_push(
      v_recipient.user_id,
      NULL,
      'app_update',
      'A new We Glue update is ready',
      'Update now to get the latest improvements.',
      jsonb_build_object('screen', 'update'),
      'app_update:' || p_platform || ':' || p_version,
      'app_update:' || p_platform || ':' || p_version || ':' || v_recipient.user_id,
      0
    );
  END LOOP;
  PERFORM public.invoke_push_dispatch();
END;
$$;
REVOKE ALL ON FUNCTION public.publish_app_release(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_app_release(TEXT, TEXT) TO authenticated;

COMMIT;
