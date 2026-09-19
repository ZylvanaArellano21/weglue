create table public.share_funnel_events (
  id uuid primary key default gen_random_uuid(),
  share_session_id uuid,
  event_name text not null check (event_name in (
    'share_initiated',
    'instagram_story_selected',
    'preview_opened',
    'open_in_app_clicked',
    'store_clicked'
  )),
  entity_type text check (entity_type in ('post', 'event')),
  entity_id uuid,
  source text check (source in (
    'instagram_story',
    'copy_link',
    'messages',
    'whatsapp',
    'more',
    'direct_unknown'
  )),
  platform text check (platform in ('ios', 'android', 'web')),
  occurred_at timestamptz not null default now(),
  constraint share_funnel_events_entity_pairing check (
    (entity_type is null) = (entity_id is null)
  )
);

alter table public.share_funnel_events enable row level security;

-- Remove role-specific and inherited PUBLIC table privileges. The RPC below
-- is the only entry point for anon and authenticated callers.
revoke all on table public.share_funnel_events from anon;
revoke all on table public.share_funnel_events from authenticated;
revoke all on table public.share_funnel_events from public;

create or replace function public.log_share_funnel_event(
  p_share_session_id uuid,
  p_event_name text,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_source text default null,
  p_platform text default null
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  -- Dedup: a rerender/retry of the SAME step for the SAME session+entity
  -- must not insert a second row. share_session_id may be null for a
  -- direct/unattributed preview open with no prior share journey — dedup
  -- that case on (event_name, entity_type, entity_id) with a null session.
  if exists (
    select 1
    from public.share_funnel_events e
    where e.event_name = p_event_name
      and e.entity_type is not distinct from p_entity_type
      and e.entity_id is not distinct from p_entity_id
      and e.share_session_id is not distinct from p_share_session_id
  ) then
    return;
  end if;

  -- Let the table's CHECK constraints be the single source of truth for
  -- validation (event_name/entity_type/source/platform/pairing) — an invalid
  -- value here must raise a real error to the caller, not silently no-op.
  insert into public.share_funnel_events
    (share_session_id, event_name, entity_type, entity_id, source, platform)
  values
    (p_share_session_id, p_event_name, p_entity_type, p_entity_id, p_source, p_platform);
end;
$$;

revoke all on function public.log_share_funnel_event(uuid, text, text, uuid, text, text) from public;
grant execute on function public.log_share_funnel_event(uuid, text, text, uuid, text, text) to anon, authenticated;

create index share_funnel_events_event_name_idx on public.share_funnel_events (event_name);
create index share_funnel_events_entity_idx on public.share_funnel_events (entity_type, entity_id);
create index share_funnel_events_session_idx on public.share_funnel_events (share_session_id);
