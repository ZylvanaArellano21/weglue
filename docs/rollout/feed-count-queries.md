
# Feed count-query trimming — BE-8 rollout spec

Status: specification only. No app code, migration, RPC body, database write, commit, or deploy is included here.

## 1. Current reads and cost

Let P be the visible page size, L the likes on those posts, C the comments, and R the going RSVPs on those events. The client retains only a count and one viewer boolean, but the current selects return every matching interaction row.

### Posts feed — mobile

apps/mobile/services/postService.ts:126:

    supabase.from('post_likes').select('post_id, user_id').in('post_id', postIds),

Computes both likesCountMap and userLikedSet (:143-149). Complexity and transfer are O(L) for the page, not O(P); postIds is capped at 20 (:72-73), but likes per post are not.

apps/mobile/services/postService.ts:127-130:

    supabase
      .from('post_comments')
      .select('post_id')
      .in('post_id', postIds),

Computes commentsCountMap (:151-154). Complexity and transfer are O(C), not O(P).

The mobile post-detail loader repeats the same pattern for one post at apps/mobile/services/postService.ts:209-210:

    supabase.from('post_likes').select('user_id').eq('post_id', postId),
    supabase.from('post_comments').select('id').eq('post_id', postId),

It computes likes.length, commentsRows.length, and likes.some(...) (:235-258): O(likes(postId) + comments(postId)) rows for one post, rather than O(1) metadata.

The same aggregate pattern also exists in the mobile profile/batch post loaders (:293-294 and :394-395). Those are adjacent follow-on candidates if the service helper is shared; this spec's mandatory surface is Home plus post detail.

### Posts feed — web

apps/web/lib/hooks/useHomePostsFeed.ts:101-102:

    supabase.from("post_likes").select("post_id, user_id").in("post_id", postIds),
    supabase.from("post_comments").select("post_id").in("post_id", postIds),

The first builds likesCountMap and userLikedSet (:118-123); the second builds commentsCountMap (:125-128). Their transfer is O(L) + O(C) for the page, not O(P).

The web post-detail loader at apps/web/lib/hooks/useHomePostsFeed.ts:192-193 is:

    supabase.from("post_likes").select("user_id").eq("post_id", postId),
    supabase.from("post_comments").select("id").eq("post_id", postId),

It computes likes.length, commentsRows.length, and the viewer-like boolean (:225-239): O(likes(postId) + comments(postId)) rows.

### Events feed — mobile

apps/mobile/services/eventService.ts:104-108:

    const { data: goingRsvps } = await supabase
      .from('event_rsvps')
      .select('event_id, user_id, profiles!inner(id, username, avatar_url)')
      .in('event_id', eventIds)
      .eq('status', 'going');

This simultaneously builds attendeeCountMap and attendeePreviewMap (:110-123). It returns O(R) RSVP/profile rows for up to 20 events (:53), although the client keeps only four preview entries per event (:116).

The already-cheap viewer-scoped reads at :72-73 are not part of this change:

    supabase.from('saved_events').select('event_id').eq('user_id', userId),
    supabase.from('event_rsvps').select('event_id, status').eq('user_id', userId),

They remain viewer-scoped and bounded by that viewer's saved/RSVP rows.

### Events feed — web

apps/web/lib/hooks/useHomeEventsFeed.ts:121-125:

    const { data: goingRsvps } = await supabase
      .from("event_rsvps")
      .select("event_id, user_id, profiles!inner(id, username, avatar_url)")
      .in("event_id", eventIds)
      .eq("status", "going");

It builds attendeeCountMap and attendeePreviewMap (:127-141), so transfer is O(R), not O(P). The client retains four previews per event (:133). The viewer-scoped saved_events and event_rsvps reads at :84-85 remain unchanged.

## 2. Amplification model

Assumptions for a mature university: 20 posts per page, mean 40 likes and 12 comments per post; 20 events per page, mean 30 going RSVPs per event. These are planning assumptions, not a production measurement.

| Surface | Current interaction rows transferred | Proposed top-level rows | Reduction |
|---|---:|---:|---:|
| Posts page | 20 × (40 + 12) = 1,040 | 20 post-meta rows | 98.1% |
| Events page | 20 × 30 = 600 | 20 event-meta rows, each with a bounded preview | 96.7% |
| Both pages | 1,640 | 40 | 97.6% |

The event response may contain up to 20 × 5 = 100 small preview objects inside JSON, but never 600 RSVP rows. The proposed RPCs still aggregate against interaction tables in the database; this spec reduces network rows/payload and client materialization, not the logical need to count indexed matches.

At 50 active users with one feed load per two-minute stale cycle, each two-minute interval transfers approximately 52,000 post interaction rows and 30,000 event RSVP rows today, versus 1,000 + 1,000 aggregate rows under the proposal. That is 50× the single-load volume at the target concurrency. If all 50 users sustain that cadence for an hour (1,500 feed loads), the corresponding totals are 1,560,000 versus 30,000 post rows and 900,000 versus 30,000 event rows.

The real feed stale windows are 2 * 60 * 1000 at apps/mobile/hooks/useHomePostsFeed.ts:75, apps/web/lib/hooks/useHomePostsFeed.ts:170, apps/mobile/hooks/useHomeEventsFeed.ts:51, and apps/web/lib/hooks/useHomeEventsFeed.ts:238. The per-navigation student-content invalidation is coalesced to 10_000 ms in the frontend rollout commit 42cd0a4c on the Claude frontend branch (apps/web/app/providers.tsx:70-74, 260-267 there). The 10-second guard limits navigation-triggered invalidation bursts; it does not turn the two-minute stale cycle into a 10-second feed poll. A genuine permission/focus recovery remains unthrottled.

## 3. Proposed RPC contracts

Add these contracts in migration 102_feed_count_query_rpcs.sql (next after migration 101). This document intentionally does not specify migration or RPC bodies.

### Post metadata

    get_post_feed_meta(
      p_post_ids uuid[],
      p_viewer uuid
    ) returns table(
      post_id uuid,
      like_count int,
      comment_count int,
      viewer_liked bool
    )

Return one row per distinct accessible input post, including zero counts. viewer_liked is false when the viewer has no visible like. The result should be deterministic, ordered by post_id.

### Event metadata

    get_event_feed_meta(
      p_event_ids uuid[],
      p_viewer uuid
    ) returns table(
      event_id uuid,
      attendee_count int,
      viewer_rsvp text,
      attendee_preview jsonb
    )

attendee_count and attendee_preview use status = 'going'; viewer_rsvp returns the viewer's current status (going or cant) or null. attendee_preview is a JSON array of at most five objects with exactly {id, username, avatar_url}, ordered deterministically (for example created_at, user_id with user_id as a tie-breaker). It must preserve the current attendee/profile privacy and blocking semantics rather than exposing rows merely because the function is privileged.

### Security and input rules

- Both functions are SECURITY DEFINER, STABLE, and use SET search_path = '' with fully qualified object names. Revoke execute from PUBLIC and anon; grant execute to authenticated. Do not broaden table DML privileges.
- p_viewer is explicit and passed by the loader; the aggregate logic must not call auth.uid() to discover the viewer. This matches the parameterized core predicate in migration 078 and the explicit identity parameters used in migration 094, keeps the function deterministic/testable, and matches the existing services' explicit userId flow. Because this is SECURITY DEFINER, the implementation must retain a caller-bound authorization boundary so an authenticated caller cannot use another person's p_viewer to probe viewer state; use the 078-style caller-bound boundary around the parameterized core if needed.
- Cap each input array at 100 UUIDs. The normal Home callers pass at most 20. Null and empty arrays return zero rows without scanning or error; more than 100 distinct input IDs fail closed with a clear input-size error rather than silently truncating.
- Recommended behavior for IDs the viewer cannot see: re-check accessibility and omit those IDs. The faster alternative is to trust that callers only pass IDs already returned by the RLS-filtered base feed and count regardless, but that creates a count/preview oracle if a client supplies arbitrary IDs. Re-checking costs some database work and preserves the existing RLS/privacy contract. For events, this also avoids counting raw rows that the client later removes with its visibility guard.
- Use two per-table RPCs, not one combined cross-table RPC. A post-only or event-only screen pays one call, a screen that needs both pays two, and failures/authorization logic stay isolated. The current platform-specific interaction reads converge to 1–2 metadata RPC calls instead of materializing the four likes/comments/RSVP query shapes across mobile and web. The posts loader's unrelated privacy/tag selects remain separate.

## 4. Consumer changes and tests

Claude owns all apps/** edits. The implementation should change only the following consumer paths:

- apps/mobile/services/postService.ts: replace Home likes/comments reads and the mobile post-detail reads with get_post_feed_meta; map returned rows to the existing likes_count, comments_count, and user_has_liked fields. If the shared helper is reused, assess the profile/batch paths noted above separately.
- apps/web/lib/hooks/useHomePostsFeed.ts: replace the Home and web post-detail likes/comments reads with the post RPC and preserve optimistic like/comment cache behavior.
- apps/mobile/services/eventService.ts: replace the goingRsvps read with get_event_feed_meta; map the bounded preview and counts without changing the viewer-scoped reads.
- apps/web/lib/hooks/useHomeEventsFeed.ts: make the same event metadata replacement and preserve event grouping, optimistic RSVP, and save behavior.
- Post-detail paths are the getPostById/usePostDetail paths in the two post files above; no separate web detail service was found.

Focused tests to add or extend:

- apps/mobile/services/__tests__/postService.test.ts — RPC arguments, zero-count rows, viewer-like mapping, and mobile detail mapping.
- apps/web/lib/__tests__/homePostsFeed.test.ts — no raw interaction selects on the feed/detail path, RPC response mapping, and cache-compatible output.
- apps/mobile/services/__tests__/eventService.test.ts — going count, viewer_rsvp, deterministic bounded preview mapping, and unchanged viewer-scoped reads.
- apps/web/lib/__tests__/homeEventsFeed.test.ts — the same event mapping plus section/grouping behavior.
- supabase/scripts/test_102_feed_count_query_rpcs.sql — contract/security assertions: function volatility, SECURITY DEFINER, empty/oversized input behavior, inaccessible-ID behavior, zero counts, preview cap/order, and role grants/revokes.

## 5. Index and payload expectations

Local migration evidence shows the required lookup indexes already exist:

- idx_post_likes_post_id and idx_post_comments_post_id in supabase/migrations/004_home_tab.sql:33-34,44-45.
- idx_event_rsvps_event_id in supabase/migrations/001_initial_schema.sql:288, plus idx_event_rsvps_event_status in supabase/migrations/024_performance_indexes.sql:20-22.
- The viewer-scoped event reads also have idx_event_rsvps_user_id (001:289) and (user_id,status) in supabase/migrations/014_calendar_tab_indexes.sql:12-13.

The BE-8 sandbox could not reach api.supabase.com, but the production pg_indexes check was subsequently run from the coordinating session and **confirms every required index is live**:

- `post_likes`: `idx_post_likes_post_id` (post_id) + `post_likes_post_id_user_id_key` unique (post_id, user_id) — the latter serves `viewer_liked` directly.
- `post_comments`: `idx_post_comments_post_id` (post_id).
- `event_rsvps`: `idx_event_rsvps_event_id` (event_id) + `idx_event_rsvps_event_status` (event_id, status) — the latter serves the `status = 'going'` count/preview.

**No new index is needed.** The migration/test gate should still re-run the check on staging and confirm the EXPLAIN plans before implementation.

The practical benefit is a roughly 97–98% reduction in interaction rows and payload on the stated model, plus one bounded result set per table. At the interaction-meta layer, the current four parallel select shapes converge to 1–2 RPC calls: one post RPC and/or one event RPC. It removes client-side O(total interactions) loops and does not change the existing viewer-scoped saved/RSVP queries.

## 6. Admin Dashboard impact

Admin code does read the same base tables, but through separate privileged paths:

- apps/web/lib/admin/contentData.ts:372-384 reads post comments and exact like/comment counts for admin post detail.
- apps/web/lib/admin/contentData.ts:684 counts going RSVPs for admin event lists.
- apps/web/lib/admin/contentData.ts:915-919 reads event RSVP rows for admin event detail.
- apps/web/lib/admin/dataHealth.ts:372 scans bounded RSVP samples for data health; admin search also reads RSVP rows in apps/web/lib/admin/data.ts:1003-1007.

These paths use the admin client and do not call the proposed student RPCs. The new function grants/revokes therefore do not change admin behavior. The existing lookup indexes are shared database structures, so an index addition or repair could improve admin counts/details, but it must not alter their result semantics or limits.

## 7. When to implement

Keep this as a spec until staging measurement by BE-3 / BE-6 under concurrent-active load shows feed reads are a material bottleneck at the 50-active target. Production feed content is currently sparse (2 posts, 0 events), so current production traffic does not justify implementing or measuring this optimization as an urgent fix. When the gate passes, implement migration 102, run the contract/security tests and pg_indexes check, then have Claude make the four apps/** consumer changes and their focused tests.
