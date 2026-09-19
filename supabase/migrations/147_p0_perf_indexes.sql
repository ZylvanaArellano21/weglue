-- P0 performance remediation: composite indexes confirmed missing against the
-- live schema (checked via pg_indexes on the local dev stack, not migration
-- history alone). Each backs a query that currently has only a single-column
-- index covering its filter, leaving the ORDER BY to an unindexed sort.
--
-- club_members: member-pagination filters club_id and orders by joined_at
-- (apps/web/lib/clubs/clubMembersService.ts, apps/mobile/services/clubTabService.ts).
-- Existing idx_club_members_club_id only covers the filter.
create index if not exists idx_club_members_club_joined_at
  on public.club_members (club_id, joined_at);

-- conversation_channels: the channel hub filters conversation_id and orders
-- by display_order (apps/web/lib/messages/service.ts,
-- apps/mobile/services/channelService.ts). Existing idx_conv_channels_conv_id
-- only covers the filter.
create index if not exists idx_conv_channels_conversation_display_order
  on public.conversation_channels (conversation_id, display_order);

-- events: the Home events feed filters event_end_at and orders by
-- (event_date, id) for keyset pagination (apps/web/lib/hooks/useHomeEventsFeed.ts).
-- Existing idx_events_event_date only covers the single-column sort; id is
-- the same-day pagination tiebreaker and isn't part of any existing index.
create index if not exists idx_events_event_date_id
  on public.events (event_date, id);
