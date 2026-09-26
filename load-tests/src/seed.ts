import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import pg from 'pg';
import { assertWriteApproved } from './config.js';
import { deterministicUuid, syntheticEmail, syntheticPassword, syntheticUsername } from './synthetic.js';
import { serviceClient } from './supabase.js';
import type { LoadTestConfig, SyntheticManifest } from './types.js';

// Must match the database taxonomy (interests.label / user_activities CHECK).
const INTERESTS = ['Photography', 'Technology and Computer', 'Sports & Athletics', 'Music'];
const ACTIVITIES = ['Study Groups', 'Social Events', 'Networking', 'Workshops'];
export const CLUB_SIZES_BEFORE_ALL = [5, 25, 75, 150] as const;
export const SEED_MESSAGES_PER_CONVERSATION = 40;
export const SEED_EVENTS = 100;
export const SEED_POSTS = 300;

type SeedUser = SyntheticManifest['users'][number];
type Queryable = Pick<pg.PoolClient, 'query'>;

/** Every fifth event is in the past so feeds see both past and upcoming rows. */
export function seedEventDate(index: number): string {
  return index % 5 === 0 ? '2020-01-01' : '2099-01-01';
}

/** The first two members of every club with at least two members are officers. */
export function seedMemberRole(memberIndex: number, clubSize: number): 'officer' | 'member' {
  return memberIndex < Math.min(2, clubSize) ? 'officer' : 'member';
}

type LoadTestUniversity = { id: string; name: string; slug: string };

async function loadTestUniversity(client: Queryable, config: LoadTestConfig): Promise<LoadTestUniversity> {
  const result = await client.query<LoadTestUniversity & { is_active: boolean }>('select id, name, slug, is_active from public.universities where id = $1', [config.universityId]);
  const university = result.rows[0];
  if (!university?.is_active || !university.name.startsWith('Load Test ')) throw new Error('Refusing to seed outside an active Load Test university');
  return university;
}

/**
 * Synthetic Auth identities. Accounts are created through the Auth admin API
 * with the Load Test campus slug, so We Glue's own signup hook and
 * handle_new_user assign the campus exactly as they do for a real signup.
 */
async function ensureAuthUsers(config: LoadTestConfig, client: Queryable, university: LoadTestUniversity): Promise<SeedUser[]> {
  const admin = serviceClient(config);
  const users: SeedUser[] = [];
  for (let index = 0; index < config.syntheticUsers; index += 1) {
    const email = syntheticEmail(config, index);
    const password = syntheticPassword(config.namespace, config.seed, index);
    const username = syntheticUsername(config.namespace, index);
    const existing = (await client.query<{ id: string; is_seed: boolean; university_id: string | null }>(
      'select id, is_seed, university_id from public.profiles where username = $1', [username])).rows[0];
    let id = existing?.id;
    if (existing) {
      if (existing.university_id !== config.universityId) throw new Error(`Refusing to reuse profile ${existing.id} outside the Load Test university`);
      const authUser = await admin.auth.admin.getUserById(existing.id);
      if (authUser.error || authUser.data.user.email?.toLowerCase() !== email || authUser.data.user.user_metadata?.loadtest_namespace !== config.namespace) {
        throw new Error(`Existing profile ${existing.id} does not match the synthetic auth identity`);
      }
    } else {
      const created = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { username, full_name: `Load Test User ${index}`, university_slug: university.slug, loadtest_namespace: config.namespace },
      });
      if (created.error) throw new Error(`create synthetic user ${index}: ${created.error.message}`);
      id = created.data.user?.id;
    }
    if (!id) throw new Error(`Unable to resolve synthetic user ${index}`);
    users.push({ index, id, email, password });
  }
  const placed = await client.query<{ id: string }>('select id from public.profiles where id = any($1::uuid[]) and university_id = $2', [users.map((user) => user.id), config.universityId]);
  if (placed.rowCount !== users.length) throw new Error('Signup did not place every synthetic profile in the Load Test university');
  return users;
}

/** Inserts `rows` (arrays of equal-length columns) with one unnest statement. */
async function insertColumns(client: Queryable, sql: string, columns: unknown[][]): Promise<void> {
  if ((columns[0]?.length ?? 0) === 0) return;
  await client.query(sql, columns);
}

/**
 * Fixture content. The service role is read-only on these tables in the 148
 * schema, so the fixture is written by the database owner in one transaction,
 * the way data migrations write. Row triggers still run.
 */
async function writeFixture(client: Queryable, config: LoadTestConfig, users: SeedUser[]): Promise<Omit<SyntheticManifest, 'schemaVersion' | 'namespace' | 'seed' | 'stagingRef' | 'universityId' | 'universityName' | 'createdAt' | 'users'>> {
  const ns = config.namespace;
  const userIds = users.map((user) => user.id);

  await client.query(`update public.profiles set full_name = 'Load Test User ' || t.idx, email_domain = $2, onboarding_completed = true, picture_prompt_status = 'hidden', is_seed = true
    from unnest($1::uuid[], $3::int[]) as t(id, idx) where profiles.id = t.id`, [userIds, config.emailDomain, users.map((user) => user.index)]);

  await client.query('delete from public.user_interests where user_id = any($1::uuid[])', [userIds]);
  await client.query('delete from public.user_activities where user_id = any($1::uuid[])', [userIds]);
  const pairs = (labels: string[]) => users.flatMap((user, offset) => labels.slice(offset % 2, offset % 2 + 2).map((label) => [user.id, label] as const));
  const interests = pairs(INTERESTS);
  await insertColumns(client, 'insert into public.user_interests (user_id, interest) select * from unnest($1::uuid[], $2::text[])', [interests.map((p) => p[0]), interests.map((p) => p[1])]);
  const activities = pairs(ACTIVITIES);
  await insertColumns(client, 'insert into public.user_activities (user_id, activity) select * from unnest($1::uuid[], $2::text[])', [activities.map((p) => p[0]), activities.map((p) => p[1])]);
  // Every tenth synthetic user is private, so privacy filtering has real rows.
  await client.query(`insert into public.user_privacy (user_id, is_private) select * from unnest($1::uuid[], $2::bool[])
    on conflict (user_id) do update set is_private = excluded.is_private`, [userIds, users.map((user) => user.index % 10 === 9)]);

  const clubSizes = [...CLUB_SIZES_BEFORE_ALL, config.syntheticUsers].map((size) => Math.min(size, users.length));
  const clubIds = clubSizes.map((_, index) => deterministicUuid(ns, 'club', index));
  await client.query(`insert into public.clubs (id, name, handle, description, university_id, is_seed, is_active)
    select t.id, t.name, t.handle, $4, $5, true, true from unnest($1::uuid[], $2::text[], $3::text[]) as t(id, name, handle)
    on conflict (id) do update set name = excluded.name, handle = excluded.handle, description = excluded.description, is_active = true`,
  [clubIds, clubIds.map((_, index) => `Load Test ${ns} Club ${index}`), clubIds.map((_, index) => `${ns}-${index}`.slice(0, 55)), `Synthetic load-test club ${ns}`, config.universityId]);

  // handle_club_created creates exactly one Members (club_group) conversation
  // with a `main` channel per club; the harness uses it rather than a duplicate.
  const conversationIds: string[] = [];
  const channelIds: string[] = [];
  for (const clubId of clubIds) {
    const conversations = await client.query<{ id: string }>(`select id from public.conversations where club_id = $1 and type = 'club_group' and deleted_at is null`, [clubId]);
    if (conversations.rowCount !== 1) throw new Error(`Expected exactly one Members conversation for club ${clubId}, found ${conversations.rowCount}`);
    const conversationId = conversations.rows[0]!.id;
    const channels = await client.query<{ id: string }>(`select id from public.conversation_channels where conversation_id = $1 and kind = 'main'`, [conversationId]);
    if (channels.rowCount !== 1) throw new Error(`Expected exactly one main channel for conversation ${conversationId}, found ${channels.rowCount}`);
    conversationIds.push(conversationId);
    channelIds.push(channels.rows[0]!.id);
  }

  // Events and posts are created BEFORE memberships so fixture creation cannot
  // fan out club-post or new-event notifications; campaign writes still do.
  const eventIds = Array.from({ length: SEED_EVENTS }, (_, index) => deterministicUuid(ns, 'event', index));
  await client.query(`insert into public.events (id, club_id, created_by, title, description, event_date, start_time, end_time, visibility, is_seed)
    select t.id, t.club_id, t.created_by, t.title, $6, t.event_date, '12:00:00', '13:00:00', 'everyone', true
    from unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::text[], $5::date[]) as t(id, club_id, created_by, title, event_date)
    on conflict (id) do update set title = excluded.title, event_date = excluded.event_date`,
  [eventIds, eventIds.map((_, index) => clubIds[index % clubIds.length]), eventIds.map((_, index) => users[index % 2]!.id), // the club's officers
    eventIds.map((_, index) => `${ns}:event:${index}`), eventIds.map((_, index) => seedEventDate(index)), `Synthetic event ${ns}`]);

  const postIds = Array.from({ length: SEED_POSTS }, (_, index) => deterministicUuid(ns, 'post', index));
  await client.query(`insert into public.posts (id, author_id, club_id, post_type, image_url, caption)
    select t.id, t.author_id, t.club_id, 'picture', t.image_url, t.caption from unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::text[], $5::text[]) as t(id, author_id, club_id, image_url, caption)
    on conflict (id) do update set caption = excluded.caption`,
  [postIds, postIds.map((_, index) => users[index % users.length]!.id), postIds.map((_, index) => clubIds[index % clubIds.length]),
    postIds.map((_, index) => `https://example.invalid/${ns}/${index}.jpg`), postIds.map((_, index) => `${ns}:post:${index}`)]);

  // Memberships last: handle_club_join adds members to the club conversations.
  for (let clubIndex = 0; clubIndex < clubIds.length; clubIndex += 1) {
    const members = users.slice(0, clubSizes[clubIndex]!);
    await client.query(`insert into public.club_members (club_id, user_id, role) select $1, t.user_id, t.role from unnest($2::uuid[], $3::text[]) as t(user_id, role)
      on conflict (club_id, user_id) do update set role = excluded.role`,
    [clubIds[clubIndex], members.map((user) => user.id), members.map((_, index) => seedMemberRole(index, members.length))]);
    // Idempotent guard: the join trigger normally creates these rows already.
    await client.query(`insert into public.conversation_participants (conversation_id, user_id) select $1, unnest($2::uuid[]) on conflict (conversation_id, user_id) do nothing`,
      [conversationIds[clubIndex], members.map((user) => user.id)]);
  }

  // Seed messages are posted after membership, by their senders: We Glue's
  // channel-permission trigger evaluates auth.uid(), so each sender's rows are
  // inserted under that sender's transaction-local JWT claims. Recipients have
  // no push tokens, so message triggers enqueue no push.
  const messageIds: string[] = [];
  const bySender = new Map<string, { ids: string[]; conversations: string[]; channels: string[]; contents: string[]; tags: string[] }>();
  conversationIds.forEach((conversationId, conversation) => {
    for (let offset = 0; offset < SEED_MESSAGES_PER_CONVERSATION; offset += 1) {
      const index = conversation * SEED_MESSAGES_PER_CONVERSATION + offset;
      const id = deterministicUuid(ns, 'message', index);
      const sender = users[offset % clubSizes[conversation]!]!.id;
      messageIds.push(id);
      const rows = bySender.get(sender) ?? { ids: [], conversations: [], channels: [], contents: [], tags: [] };
      rows.ids.push(id);
      rows.conversations.push(conversationId);
      rows.channels.push(channelIds[conversation]!);
      rows.contents.push(`${ns}:seed-message:${index}`);
      rows.tags.push(deterministicUuid(ns, 'seed-message-tag', index));
      bySender.set(sender, rows);
    }
  });
  for (const [sender, rows] of bySender) {
    await client.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [JSON.stringify({ sub: sender, role: 'authenticated' }), sender]);
    await client.query(`insert into public.messages (id, conversation_id, channel_id, sender_id, content, message_type, client_tag)
      select t.id, t.conversation_id, t.channel_id, $6, t.content, 'text', t.client_tag
      from unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::text[], $5::uuid[]) as t(id, conversation_id, channel_id, content, client_tag)
      on conflict (id) do nothing`, [rows.ids, rows.conversations, rows.channels, rows.contents, rows.tags, sender]);
  }
  await client.query(`select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true)`);

  const follows = users.flatMap((user) => [1, 2].map((distance) => ({ id: deterministicUuid(ns, 'follow', user.index * 2 + distance - 1), follower: user.id, following: users[(user.index + distance) % users.length]!.id })));
  await insertColumns(client, `insert into public.follows (id, follower_id, following_id, status) select t.id, t.follower_id, t.following_id, 'accepted'
    from unnest($1::uuid[], $2::uuid[], $3::uuid[]) as t(id, follower_id, following_id) on conflict (follower_id, following_id) do update set status = 'accepted'`,
  [follows.map((f) => f.id), follows.map((f) => f.follower), follows.map((f) => f.following)]);
  await client.query(`insert into public.post_likes (id, post_id, user_id) select * from unnest($1::uuid[], $2::uuid[], $3::uuid[]) on conflict (post_id, user_id) do nothing`,
    [users.map((user) => deterministicUuid(ns, 'like', user.index)), users.map((user) => postIds[user.index % postIds.length]), userIds]);
  await client.query(`insert into public.post_comments (id, post_id, user_id, content) select * from unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::text[]) on conflict (id) do update set content = excluded.content`,
    [users.map((user) => deterministicUuid(ns, 'comment', user.index)), users.map((user) => postIds[(user.index + 1) % postIds.length]), userIds, users.map((user) => `${ns}:seed-comment:${user.index}`)]);
  // Representative muted channels and delete-for-me hides.
  const muters = users.filter((user) => user.index % 7 === 3).map((user) => user.id);
  if (muters.length > 0) {
    await client.query(`insert into public.channel_mutes (channel_id, user_id) select $2, unnest($1::uuid[]) on conflict (channel_id, user_id) do nothing`, [muters, channelIds[channelIds.length - 1]]);
  }
  const hiders = users.filter((user) => user.index % 11 === 5);
  const allMembersOffset = (conversationIds.length - 1) * SEED_MESSAGES_PER_CONVERSATION;
  await insertColumns(client, `insert into public.message_hides (message_id, user_id) select * from unnest($1::uuid[], $2::uuid[]) on conflict (message_id, user_id) do nothing`,
    [hiders.map((user) => messageIds[allMembersOffset + (user.index % SEED_MESSAGES_PER_CONVERSATION)]), hiders.map((user) => user.id)]);

  // Watermark: everything after this instant is campaign-generated.
  const seededAt = (await client.query<{ now: Date }>('select clock_timestamp() as now')).rows[0]!.now.toISOString();
  await client.query('update public.conversation_participants set last_read_at = $3 where conversation_id = any($1::uuid[]) and user_id = any($2::uuid[])', [conversationIds, userIds, seededAt]);
  return { seededAt, clubIds, clubSizes, eventIds, postIds, conversationIds, channelIds, messageIds };
}

export async function seedSyntheticData(config: LoadTestConfig): Promise<SyntheticManifest> {
  assertWriteApproved(config);
  if (!config.databaseUrl) throw new Error('LOADTEST_DATABASE_URL is required to seed the fixture');
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 1, connectionTimeoutMillis: 10_000 });
  try {
    const client = await pool.connect();
    try {
      const university = await loadTestUniversity(client, config);
      const users = await ensureAuthUsers(config, client, university);
      await client.query('begin');
      let fixture: Awaited<ReturnType<typeof writeFixture>>;
      try {
        fixture = await writeFixture(client, config, users);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
      const manifest: SyntheticManifest = {
        schemaVersion: 2,
        namespace: config.namespace,
        seed: config.seed,
        stagingRef: config.stagingRef,
        universityId: config.universityId,
        universityName: university.name,
        createdAt: new Date().toISOString(),
        users,
        ...fixture,
      };
      mkdirSync(dirname(config.manifestFile), { recursive: true });
      writeFileSync(config.manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      return manifest;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}
