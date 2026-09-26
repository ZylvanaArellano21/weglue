import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import pg from 'pg';
import { assertWriteApproved } from './config.js';
import { deterministicUuid, syntheticEmail, syntheticPassword, syntheticUsername } from './synthetic.js';
import { inChunks, serviceClient, unwrap } from './supabase.js';
import type { LoadTestConfig, SyntheticManifest } from './types.js';

// Must match the database taxonomy (interests.label / user_activities CHECK).
const INTERESTS = ['Photography', 'Technology and Computer', 'Sports & Athletics', 'Music'];
const ACTIVITIES = ['Study Groups', 'Social Events', 'Networking', 'Workshops'];
export const CLUB_SIZES_BEFORE_ALL = [5, 25, 75, 150] as const;
export const SEED_MESSAGES_PER_CONVERSATION = 40;
export const SEED_EVENTS = 100;
export const SEED_POSTS = 300;

type Admin = ReturnType<typeof serviceClient>;

/** Every fifth event is in the past so feeds see both past and upcoming rows. */
export function seedEventDate(index: number): string {
  return index % 5 === 0 ? '2020-01-01' : '2099-01-01';
}

/** The first two members of every club with at least two members are officers. */
export function seedMemberRole(memberIndex: number, clubSize: number): 'officer' | 'member' {
  return memberIndex < Math.min(2, clubSize) ? 'officer' : 'member';
}

async function databaseNow(config: LoadTestConfig): Promise<string> {
  if (!config.databaseUrl) throw new Error('LOADTEST_DATABASE_URL is required to record the seed watermark');
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 1, connectionTimeoutMillis: 10_000 });
  try {
    const result = await pool.query<{ now: Date }>('select clock_timestamp() as now');
    return result.rows[0]!.now.toISOString();
  } finally {
    await pool.end();
  }
}

async function resolveClubConversation(admin: Admin, clubId: string): Promise<{ conversationId: string; channelId: string }> {
  // handle_club_created creates exactly one Members (club_group) conversation
  // with a `main` channel per club; the harness uses it rather than a duplicate.
  const conversations = unwrap(await admin.from('conversations').select('id').eq('club_id', clubId).eq('type', 'club_group').is('deleted_at', null), 'resolve club conversation') as Array<{ id: string }>;
  if (conversations.length !== 1) throw new Error(`Expected exactly one Members conversation for club ${clubId}, found ${conversations.length}`);
  const conversationId = conversations[0]!.id;
  const channels = unwrap(await admin.from('conversation_channels').select('id').eq('conversation_id', conversationId).eq('kind', 'main'), 'resolve main channel') as Array<{ id: string }>;
  if (channels.length !== 1) throw new Error(`Expected exactly one main channel for conversation ${conversationId}, found ${channels.length}`);
  return { conversationId, channelId: channels[0]!.id };
}

export async function seedSyntheticData(config: LoadTestConfig): Promise<SyntheticManifest> {
  assertWriteApproved(config);
  const admin = serviceClient(config);
  const university = unwrap(await admin.from('universities').select('id,name').eq('id', config.universityId).maybeSingle(), 'verify university') as { id: string; name: string } | null;
  if (!university?.name.startsWith('Load Test ')) throw new Error('Refusing to seed outside a Load Test university');

  const users: SyntheticManifest['users'] = [];
  for (let index = 0; index < config.syntheticUsers; index += 1) {
    const email = syntheticEmail(config, index);
    const password = syntheticPassword(config.namespace, config.seed, index);
    const username = syntheticUsername(config.namespace, index);
    const existing = unwrap(await admin.from('profiles').select('id,is_seed,university_id').eq('username', username).maybeSingle(), `find user ${index}`) as { id: string; is_seed: boolean; university_id: string | null } | null;
    if (existing && (!existing.is_seed || existing.university_id !== config.universityId)) {
      throw new Error(`Refusing to reuse non-synthetic profile ${existing.id}`);
    }
    let id = existing?.id;
    if (id) {
      const authUser = await admin.auth.admin.getUserById(id);
      if (authUser.error || authUser.data.user.email?.toLowerCase() !== email || authUser.data.user.user_metadata?.loadtest_namespace !== config.namespace) {
        throw new Error(`Existing profile ${id} does not match the synthetic auth identity`);
      }
    }
    if (!id) {
      const created = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { username, full_name: `Load Test User ${index}`, loadtest_namespace: config.namespace },
      });
      if (created.error) throw new Error(`create synthetic user ${index}: ${created.error.message}`);
      id = created.data.user?.id;
    }
    if (!id) throw new Error(`Unable to resolve synthetic user ${index}`);
    users.push({ index, id, email, password });
  }

  await inChunks(users, 100, async (chunk) => {
    unwrap(await admin.from('profiles').upsert(chunk.map((user) => ({
      id: user.id,
      username: syntheticUsername(config.namespace, user.index),
      full_name: `Load Test User ${user.index}`,
      university_id: config.universityId,
      email_domain: config.emailDomain,
      onboarding_completed: true,
      picture_prompt_status: 'hidden',
      is_seed: true,
    })), { onConflict: 'id' }), 'upsert synthetic profiles');
  });

  const userIds = users.map((user) => user.id);
  await inChunks(userIds, 100, async (ids) => {
    unwrap(await admin.from('user_interests').delete().in('user_id', ids), 'reset interests');
    unwrap(await admin.from('user_activities').delete().in('user_id', ids), 'reset activities');
    unwrap(await admin.from('user_interests').insert(ids.flatMap((user_id, offset) => INTERESTS.slice(offset % 2, offset % 2 + 2).map((interest) => ({ user_id, interest })))), 'seed interests');
    unwrap(await admin.from('user_activities').insert(ids.flatMap((user_id, offset) => ACTIVITIES.slice(offset % 2, offset % 2 + 2).map((activity) => ({ user_id, activity })))), 'seed activities');
    // Every tenth synthetic user is private, so privacy filtering has real rows.
    unwrap(await admin.from('user_privacy').upsert(ids.map((user_id) => ({ user_id, is_private: users.find((user) => user.id === user_id)!.index % 10 === 9 })), { onConflict: 'user_id' }), 'seed privacy');
  });

  const clubSizes = [...CLUB_SIZES_BEFORE_ALL, config.syntheticUsers].map((size) => Math.min(size, users.length));
  const clubIds = clubSizes.map((_, index) => deterministicUuid(config.namespace, 'club', index));
  unwrap(await admin.from('clubs').upsert(clubIds.map((id, index) => ({
    id,
    name: `Load Test ${config.namespace} Club ${index}`,
    handle: `${config.namespace}-${index}`.slice(0, 55),
    description: `Synthetic load-test club ${config.namespace}`,
    university_id: config.universityId,
    is_seed: true,
    is_active: true,
  })), { onConflict: 'id' }), 'seed clubs');
  const conversationIds: string[] = [];
  const channelIds: string[] = [];
  for (const clubId of clubIds) {
    const resolved = await resolveClubConversation(admin, clubId);
    conversationIds.push(resolved.conversationId);
    channelIds.push(resolved.channelId);
  }

  // Content is created BEFORE memberships so fixture creation cannot fan out
  // club-post, new-event, or message notifications; campaign writes still do.
  const eventIds = Array.from({ length: SEED_EVENTS }, (_, index) => deterministicUuid(config.namespace, 'event', index));
  await inChunks(eventIds, 100, async (ids) => {
    unwrap(await admin.from('events').upsert(ids.map((id) => {
      const index = eventIds.indexOf(id);
      const clubIndex = index % clubIds.length;
      return {
        id,
        club_id: clubIds[clubIndex],
        created_by: users[index % 2]?.id, // the club's officers
        title: `${config.namespace}:event:${index}`,
        description: `Synthetic event ${config.namespace}`,
        event_date: seedEventDate(index),
        start_time: '12:00:00',
        end_time: '13:00:00',
        visibility: 'everyone',
        is_seed: true,
      };
    }), { onConflict: 'id' }), 'seed events');
  });

  const postIds = Array.from({ length: SEED_POSTS }, (_, index) => deterministicUuid(config.namespace, 'post', index));
  await inChunks(postIds, 100, async (ids) => {
    unwrap(await admin.from('posts').upsert(ids.map((id) => {
      const index = postIds.indexOf(id);
      return {
        id,
        author_id: users[index % users.length]?.id,
        club_id: clubIds[index % clubIds.length],
        post_type: 'picture',
        image_url: `https://example.invalid/${config.namespace}/${index}.jpg`,
        caption: `${config.namespace}:post:${index}`,
      };
    }), { onConflict: 'id' }), 'seed posts');
  });

  const messageIds: string[] = [];
  for (let conversation = 0; conversation < conversationIds.length; conversation += 1) {
    const rows = Array.from({ length: SEED_MESSAGES_PER_CONVERSATION }, (_, offset) => {
      const index = conversation * SEED_MESSAGES_PER_CONVERSATION + offset;
      const id = deterministicUuid(config.namespace, 'message', index);
      messageIds.push(id);
      return {
        id,
        conversation_id: conversationIds[conversation],
        channel_id: channelIds[conversation],
        sender_id: users[offset % clubSizes[conversation]!]!.id,
        content: `${config.namespace}:seed-message:${index}`,
        message_type: 'text',
        client_tag: deterministicUuid(config.namespace, 'seed-message-tag', index),
      };
    });
    unwrap(await admin.from('messages').upsert(rows, { onConflict: 'id' }), `seed conversation ${conversation} messages`);
  }

  // Memberships last: handle_club_join adds members to the club conversations.
  for (let clubIndex = 0; clubIndex < clubIds.length; clubIndex += 1) {
    const size = clubSizes[clubIndex]!;
    unwrap(await admin.from('club_members').upsert(users.slice(0, size).map((user, index) => ({
      club_id: clubIds[clubIndex], user_id: user.id, role: seedMemberRole(index, size),
    })), { onConflict: 'club_id,user_id' }), `seed club ${clubIndex} members`);
    // Idempotent guard: the join trigger normally creates these rows already.
    unwrap(await admin.from('conversation_participants').upsert(users.slice(0, size).map((user) => ({ conversation_id: conversationIds[clubIndex], user_id: user.id })), { onConflict: 'conversation_id,user_id', ignoreDuplicates: true }), `seed chat ${clubIndex} participants`);
  }

  await inChunks(users, 100, async (chunk) => {
    unwrap(await admin.from('follows').upsert(chunk.flatMap((user) => [1, 2].map((distance) => ({
      id: deterministicUuid(config.namespace, 'follow', user.index * 2 + distance - 1),
      follower_id: user.id,
      following_id: users[(user.index + distance) % users.length]?.id,
      status: 'accepted',
    }))), { onConflict: 'follower_id,following_id' }), 'seed follows');
    unwrap(await admin.from('post_likes').upsert(chunk.map((user) => ({
      id: deterministicUuid(config.namespace, 'like', user.index),
      post_id: postIds[user.index % postIds.length],
      user_id: user.id,
    })), { onConflict: 'post_id,user_id' }), 'seed likes');
    unwrap(await admin.from('post_comments').upsert(chunk.map((user) => ({
      id: deterministicUuid(config.namespace, 'comment', user.index),
      post_id: postIds[(user.index + 1) % postIds.length],
      user_id: user.id,
      content: `${config.namespace}:seed-comment:${user.index}`,
    })), { onConflict: 'id' }), 'seed comments');
    // Representative muted channels and delete-for-me hides.
    const muters = chunk.filter((user) => user.index % 7 === 3);
    if (muters.length > 0) unwrap(await admin.from('channel_mutes').upsert(muters.map((user) => ({ channel_id: channelIds[channelIds.length - 1], user_id: user.id })), { onConflict: 'channel_id,user_id' }), 'seed channel mutes');
    const hiders = chunk.filter((user) => user.index % 11 === 5);
    const allMembersOffset = (conversationIds.length - 1) * SEED_MESSAGES_PER_CONVERSATION;
    if (hiders.length > 0) unwrap(await admin.from('message_hides').upsert(hiders.map((user) => ({ message_id: messageIds[allMembersOffset + (user.index % SEED_MESSAGES_PER_CONVERSATION)], user_id: user.id })), { onConflict: 'message_id,user_id' }), 'seed message hides');
  });

  // Watermark: everything after this instant is campaign-generated.
  const seededAt = await databaseNow(config);
  await inChunks(userIds, 100, async (ids) => {
    unwrap(await admin.from('conversation_participants').update({ last_read_at: seededAt }).in('conversation_id', conversationIds).in('user_id', ids), 'set seed read watermark');
  });

  const manifest: SyntheticManifest = {
    schemaVersion: 2,
    namespace: config.namespace,
    seed: config.seed,
    stagingRef: config.stagingRef,
    universityId: config.universityId,
    universityName: university.name,
    createdAt: new Date().toISOString(),
    seededAt,
    users,
    clubIds,
    clubSizes,
    eventIds,
    postIds,
    conversationIds,
    channelIds,
    messageIds,
  };
  mkdirSync(dirname(config.manifestFile), { recursive: true });
  writeFileSync(config.manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return manifest;
}
