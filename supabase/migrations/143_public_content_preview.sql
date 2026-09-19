create table public.external_share_settings (
  entity_type text not null check (entity_type in ('post', 'event')),
  entity_id uuid not null,
  enabled boolean not null default false,
  enabled_by uuid references public.profiles(id),
  enabled_at timestamptz,
  disabled_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (entity_type, entity_id)
);

alter table public.external_share_settings enable row level security;

-- Remove both role-specific and inherited PUBLIC table privileges. PostgreSQL
-- default privileges affect newly created tables; they do not re-grant this
-- existing table after these explicit revokes.
revoke all on table public.external_share_settings from anon;
revoke all on table public.external_share_settings from public;

create policy external_share_settings_anon_denied
  on public.external_share_settings
  for all
  to anon
  using (false)
  with check (false);

create policy external_share_settings_authenticated_select
  on public.external_share_settings
  for select
  to authenticated
  using (
    (
      entity_type = 'post'
      and exists (
        select 1
        from public.posts p
        where p.id = entity_id
          and (
            (p.author_kind = 'user' and p.author_id = auth.uid())
            or (p.author_kind = 'club' and public.is_club_officer(p.club_id))
          )
      )
    )
    or (
      entity_type = 'event'
      and exists (
        select 1
        from public.events e
        where e.id = entity_id
          and public.is_club_officer(e.club_id)
      )
    )
  );

grant select on table public.external_share_settings to authenticated;

create or replace function public.enable_external_share(
  p_entity_type text,
  p_entity_id uuid
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_author_kind text;
  v_author_id uuid;
  v_club_id uuid;
  v_authorized boolean := false;
begin
  if p_entity_type is null
     or p_entity_id is null
     or p_entity_type not in ('post', 'event')
     or auth.uid() is null then
    return false;
  end if;

  if p_entity_type = 'post' then
    select p.author_kind, p.author_id, p.club_id
      into v_author_kind, v_author_id, v_club_id
      from public.posts p
     where p.id = p_entity_id;

    if not found then
      return false;
    end if;

    v_authorized :=
      (v_author_kind = 'user' and v_author_id = auth.uid())
      or (v_author_kind = 'club' and public.is_club_officer(v_club_id));
  else
    select e.club_id
      into v_club_id
      from public.events e
     where e.id = p_entity_id;

    if not found then
      return false;
    end if;

    v_authorized := public.is_club_officer(v_club_id);
  end if;

  if v_authorized is distinct from true then
    return false;
  end if;

  insert into public.external_share_settings (
    entity_type,
    entity_id,
    enabled,
    enabled_by,
    enabled_at,
    disabled_at,
    updated_at
  )
  values (
    p_entity_type,
    p_entity_id,
    true,
    auth.uid(),
    now(),
    null,
    now()
  )
  on conflict (entity_type, entity_id) do update
    set enabled = true,
        enabled_by = excluded.enabled_by,
        enabled_at = excluded.enabled_at,
        disabled_at = null,
        updated_at = excluded.updated_at;

  return true;
end;
$$;

create or replace function public.disable_external_share(
  p_entity_type text,
  p_entity_id uuid
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_author_kind text;
  v_author_id uuid;
  v_club_id uuid;
  v_authorized boolean := false;
begin
  if p_entity_type is null
     or p_entity_id is null
     or p_entity_type not in ('post', 'event')
     or auth.uid() is null then
    return false;
  end if;

  if p_entity_type = 'post' then
    select p.author_kind, p.author_id, p.club_id
      into v_author_kind, v_author_id, v_club_id
      from public.posts p
     where p.id = p_entity_id;

    if not found then
      return false;
    end if;

    v_authorized :=
      (v_author_kind = 'user' and v_author_id = auth.uid())
      or (v_author_kind = 'club' and public.is_club_officer(v_club_id));
  else
    select e.club_id
      into v_club_id
      from public.events e
     where e.id = p_entity_id;

    if not found then
      return false;
    end if;

    v_authorized := public.is_club_officer(v_club_id);
  end if;

  if v_authorized is distinct from true then
    return false;
  end if;

  insert into public.external_share_settings (
    entity_type,
    entity_id,
    enabled,
    disabled_at,
    updated_at
  )
  values (
    p_entity_type,
    p_entity_id,
    false,
    now(),
    now()
  )
  on conflict (entity_type, entity_id) do update
    set enabled = false,
        disabled_at = excluded.disabled_at,
        updated_at = excluded.updated_at;

  return true;
end;
$$;

create or replace function public.get_public_preview_post(p_post_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select jsonb_build_object(
    'caption', p.caption,
    'image_url', p.image_url,
    'post_images', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'storage_path', pi.storage_path,
            'position', pi.position,
            'width', pi.width,
            'height', pi.height
          )
          order by pi.position
        )
        from public.post_images pi
        where pi.post_id = p.id
      ),
      '[]'::jsonb
    ),
    'author', case
      when p.author_kind = 'user' then jsonb_build_object(
        'display_name', coalesce(author_profile.full_name, author_profile.username),
        'avatar_url', author_profile.avatar_url
      )
      else null
    end,
    'club', case
      when p.author_kind = 'club' then jsonb_build_object(
        'name', club.name,
        'avatar_url', club.avatar_url
      )
      else null
    end,
    'created_at', p.created_at
  )
  from public.posts p
  left join public.profiles author_profile on author_profile.id = p.author_id
  left join public.clubs club on club.id = p.club_id
  left join public.universities university on university.id = case
    when p.author_kind = 'club' then club.university_id
    else author_profile.university_id
  end
  where p.id = p_post_id
    and public.content_is_student_visible('post', p.id)
    and university.is_active
    and exists (
      select 1
      from public.external_share_settings share
      where share.entity_type = 'post'
        and share.entity_id = p.id
        and share.enabled
    );
$$;

create or replace function public.get_public_preview_event(p_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select jsonb_build_object(
    'title', e.title,
    'description', e.description,
    'cover_image_url', e.cover_image_url,
    'event_date', e.event_date,
    'start_time', e.start_time,
    'end_time', e.end_time,
    'location', e.location,
    'building', e.building,
    'room', e.room,
    'club', jsonb_build_object(
      'name', club.name,
      'avatar_url', club.avatar_url
    )
  )
  from public.events e
  join public.clubs club on club.id = e.club_id
  join public.universities university on university.id = club.university_id
  where e.id = p_event_id
    and public.content_is_student_visible('event', e.id)
    and e.visibility = 'everyone'
    and university.is_active
    and exists (
      select 1
      from public.external_share_settings share
      where share.entity_type = 'event'
        and share.entity_id = e.id
        and share.enabled
    );
$$;

create or replace function public.get_public_preview_more(
  p_hero_type text,
  p_hero_id uuid,
  p_limit int default 3
)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  with hero_university as (
    select university.id, university.is_active
    from public.posts p
    left join public.profiles author_profile on author_profile.id = p.author_id
    left join public.clubs club on club.id = p.club_id
    join public.universities university on university.id = case
      when p.author_kind = 'club' then club.university_id
      else author_profile.university_id
    end
    where p_hero_type = 'post'
      and p.id = p_hero_id

    union all

    select university.id, university.is_active
    from public.events e
    join public.clubs club on club.id = e.club_id
    join public.universities university on university.id = club.university_id
    where p_hero_type = 'event'
      and e.id = p_hero_id
  )
  select coalesce(
    jsonb_agg(items.item order by items.sort_at desc),
    '[]'::jsonb
  )
  from (
    select
      p.created_at as sort_at,
      jsonb_build_object(
        'type', 'post',
        'id', p.id,
        'caption', p.caption,
        'image_url', p.image_url,
        'author', case
          when p.author_kind = 'user' then jsonb_build_object(
            'display_name', coalesce(author_profile.full_name, author_profile.username),
            'avatar_url', author_profile.avatar_url
          )
          else null
        end,
        'club', case
          when p.author_kind = 'club' then jsonb_build_object(
            'name', club.name,
            'avatar_url', club.avatar_url
          )
          else null
        end,
        'created_at', p.created_at
      ) as item
    from public.posts p
    left join public.profiles author_profile on author_profile.id = p.author_id
    left join public.clubs club on club.id = p.club_id
    join public.universities university on university.id = case
      when p.author_kind = 'club' then club.university_id
      else author_profile.university_id
    end
    cross join hero_university hero
    where university.id = hero.id
      and hero.is_active
      and university.is_active
      and public.content_is_student_visible('post', p.id)
      and exists (
        select 1
        from public.external_share_settings share
        where share.entity_type = 'post'
          and share.entity_id = p.id
          and share.enabled
      )
      and (p_hero_type is distinct from 'post' or p.id is distinct from p_hero_id)

    union all

    select
      e.created_at as sort_at,
      jsonb_build_object(
        'type', 'event',
        'id', e.id,
        'title', e.title,
        'description', e.description,
        'cover_image_url', e.cover_image_url,
        'event_date', e.event_date,
        'start_time', e.start_time,
        'end_time', e.end_time,
        'location', e.location,
        'building', e.building,
        'room', e.room,
        'club', jsonb_build_object(
          'name', club.name,
          'avatar_url', club.avatar_url
        )
      ) as item
    from public.events e
    join public.clubs club on club.id = e.club_id
    join public.universities university on university.id = club.university_id
    cross join hero_university hero
    where university.id = hero.id
      and hero.is_active
      and university.is_active
      and public.content_is_student_visible('event', e.id)
      and e.visibility = 'everyone'
      and (
        e.event_date > current_date
        or (
          e.event_date = current_date
          and coalesce(e.end_time, '23:59:59'::time) > localtime
        )
      )
      and exists (
        select 1
        from public.external_share_settings share
        where share.entity_type = 'event'
          and share.entity_id = e.id
          and share.enabled
      )
      and (p_hero_type is distinct from 'event' or e.id is distinct from p_hero_id)
    order by sort_at desc
    limit greatest(coalesce(p_limit, 3), 0)
  ) items;
$$;

revoke execute on function public.enable_external_share(text, uuid) from public;
revoke execute on function public.disable_external_share(text, uuid) from public;
grant execute on function public.enable_external_share(text, uuid) to authenticated;
grant execute on function public.disable_external_share(text, uuid) to authenticated;
grant execute on function public.get_public_preview_post(uuid) to anon, authenticated;
grant execute on function public.get_public_preview_event(uuid) to anon, authenticated;
grant execute on function public.get_public_preview_more(text, uuid, int) to anon, authenticated;
