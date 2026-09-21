# P0 security follow-up: public post and event media URLs

Status: Open. Separate from P0.5 Realtime work.

The `posts` Supabase Storage bucket is public (`supabase/migrations/004_home_tab.sql`). Post and event images are uploaded there and their public object URLs are stored in application rows. Database visibility checks govern which rows the application returns, but they do not revoke direct access to a public object URL already known to a caller. This is a pre-existing privacy concern, particularly for media attached to restricted posts or events.

The follow-up needs an explicit media access model and migration plan covering existing URLs, stored objects, client rendering, cache behavior, and authorization changes. It must verify private post, private club, event, and campus visibility with direct object requests. No Storage bucket privacy, RLS, media schema, or URL change is included in P0.5.
