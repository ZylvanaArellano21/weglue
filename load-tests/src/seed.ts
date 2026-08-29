import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { LoadTestConfig } from './config.js';
import { argNumber, argString, assertWriteApproved, parseArgs } from './config.js';
import { serviceClient, unwrap, withTimeout } from './supabase.js';

export type SeedManifest = {
  schemaVersion: 1;
  namespace: string;
  universityId: string;
  size: number;
  userIds: string[];
  emails: string[];
  passwords: string[];
  clubIds: string[];
  eventIds: string[];
  postIds: string[];
  conversationIds: string[];
  channelIds: string[];
  createdAt: string;
  createdUniversity: boolean;
};

const INTERESTS = ['Photography', 'Technology and Computer', 'Sports & Athletics', 'Music'];
const ACTIVITIES = ['Study Groups', 'Social Events', 'Networking', 'Workshops'];

export function manifestPath(config: LoadTestConfig, namespace = config.seedNamespace, size?: number): string {
  return join(config.resultsDir, `seed-${namespace}${size ? `-${size}` : ''}.json`);
}

export function readManifest(config: LoadTestConfig, path?: string): SeedManifest {
  const file = path ?? manifestPath(config);
  if (!existsSync(file)) throw new Error(`Seed manifest not found: ${file}. Run seed first or pass --manifest.`);
  return JSON.parse(readFileSync(file, 'utf8')) as SeedManifest;
}

async function chunked<T>(values: T[], size: number, fn: (chunk: T[]) => Promise<void>): Promise<void> {
  for (let i = 0; i < values.length; i += size) await fn(values.slice(i, i + size));
}

function password(namespace: string, index: number): string {
  return `LoadTest-${namespace.replace(/[^A-Za-z0-9]/g, '').slice(0, 20) || 'WeGlue'}-${index}a!`;
}

export async function seed(config: LoadTestConfig, args: Record<string, string | boolean>): Promise<string> {
  assertWriteApproved(config);
  const size = Math.floor(argNumber(args, 'size', 100));
  const namespace = argString(args, 'namespace', config.seedNamespace);
  if (!Number.isInteger(size) || size < 1 || size > 5000) throw new Error('--size must be an integer from 1 to 5000');
  const admin = serviceClient(config);
  mkdirSync(config.resultsDir, { recursive: true });

  const existingUniversity = unwrap(await admin.from('universities').select('id').eq('id', config.universityId).maybeSingle(), 'find target university');
  let createdUniversity = false;
  if (!existingUniversity) {
    const slug = `loadtest-${namespace}-${config.universityId.slice(0, 8)}`.replace(/[^a-z0-9-]/gi, '-').slice(0, 80);
    const created = unwrap(await admin.from('universities').insert({ id: config.universityId, name: `Load Test University ${namespace}`, slug, is_active: true }).select('id').single(), 'create synthetic university');
    if (!created) throw new Error('Synthetic university insert returned no row');
    createdUniversity = true;
  }

  const userIds: string[] = [];
  const emails: string[] = [];
  const passwords: string[] = [];
  for (let i = 0; i < size; i += 1) {
    const username = `lt_${namespace}_${i}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 40);
    const email = `${username}@${config.emailDomain}`.toLowerCase();
    const existing = unwrap(await admin.from('profiles').select('id').eq('username', username).maybeSingle(), `find profile ${username}`) as { id: string } | null;
    let id = existing?.id;
    if (!id) {
      const created = await withTimeout(admin.auth.admin.createUser({ email, password: password(namespace, i), email_confirm: true, user_metadata: { username, full_name: `Load Test ${i}`, loadtest_namespace: namespace } }), config.requestTimeoutMs, `create seed user ${i}`);
      if (created.error) throw created.error;
      id = created.data.user?.id;
    }
    if (!id) throw new Error(`Unable to resolve seed user ${username}`);
    userIds.push(id);
    emails.push(email);
    passwords.push(password(namespace, i));
  }

  await chunked(userIds.map((id, i) => ({
    id, username: `lt_${namespace}_${i}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 40), full_name: `Load Test ${i}`,
    university_id: config.universityId, email_domain: config.emailDomain, is_seed: true,
    onboarding_completed: true, picture_prompt_status: 'hidden',
  })), 250, async (rows) => {
    unwrap(await admin.from('profiles').upsert(rows, { onConflict: 'id' }), 'upsert seed profiles');
  });
  await chunked(userIds, 500, async (rows) => {
    unwrap(await admin.from('user_interests').delete().in('user_id', rows), 'clear seed interests');
    unwrap(await admin.from('user_activities').delete().in('user_id', rows), 'clear seed activities');
    unwrap(await admin.from('user_interests').insert(rows.flatMap((user_id) => INTERESTS.slice(0, 2).map((interest) => ({ user_id, interest })))), 'seed interests');
    unwrap(await admin.from('user_activities').insert(rows.flatMap((user_id) => ACTIVITIES.slice(0, 2).map((activity) => ({ user_id, activity })))), 'seed activities');
  });

  const clubIds: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const handle = `lt_${namespace}_${i}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 55);
    const existing = unwrap(await admin.from('clubs').select('id').eq('handle', handle).maybeSingle(), `find club ${handle}`) as { id: string } | null;
    const club = existing ?? unwrap(await admin.from('clubs').insert({ name: `Load Test Club ${i}`, handle, description: `Synthetic club ${namespace}`, university_id: config.universityId, is_seed: true, is_active: true }).select('id').single(), `create club ${i}`);
    clubIds.push(club.id);
  }
  await chunked(clubIds.flatMap((clubId, clubIndex) => userIds.map((userId, userIndex) => ({ club_id: clubId, user_id: userId, role: userIndex === 0 && clubIndex === 0 ? 'officer' : 'member' }))), 500, async (rows) => {
    unwrap(await admin.from('club_members').upsert(rows, { onConflict: 'club_id,user_id' }), 'seed memberships');
  });

  const eventIds: string[] = [];
  for (let i = 0; i < clubIds.length; i += 1) {
    const marker = `LOADTEST:${namespace}:event:${i}`;
    const found = unwrap(await admin.from('events').select('id').eq('club_id', clubIds[i]).eq('title', marker).maybeSingle(), `find event ${i}`) as { id: string } | null;
    const event = found ?? unwrap(await admin.from('events').insert({ club_id: clubIds[i], created_by: userIds[0], title: marker, description: 'Synthetic load-test event', event_date: '2099-01-01', start_time: '12:00:00', end_time: '13:00:00', visibility: 'everyone', is_seed: true }).select('id').single(), `create event ${i}`);
    eventIds.push(event.id);
  }
  const postIds: string[] = [];
  for (let i = 0; i < Math.min(3, userIds.length); i += 1) {
    const marker = `LOADTEST:${namespace}:post:${i}`;
    const found = unwrap(await admin.from('posts').select('id').eq('author_id', userIds[i]).eq('caption', marker).maybeSingle(), `find post ${i}`) as { id: string } | null;
    const post = found ?? unwrap(await admin.from('posts').insert({ author_id: userIds[i], club_id: clubIds[i % clubIds.length], post_type: 'picture', image_url: `https://loadtest.invalid/${namespace}/${i}.jpg`, caption: marker }).select('id').single(), `create post ${i}`);
    postIds.push(post.id);
  }

  const conversationIds: string[] = [];
  const channelIds: string[] = [];
  for (const clubId of clubIds) {
    const existing = unwrap(await admin.from('conversations').select('id').eq('club_id', clubId).eq('type', 'club_group').maybeSingle(), 'find club conversation') as { id: string } | null;
    const conversation = existing ?? unwrap(await admin.from('conversations').insert({ type: 'club_group', club_id: clubId, name: `Load Test Club · Members` }).select('id').single(), 'create club conversation');
    conversationIds.push(conversation.id);
    const channel = unwrap(await admin.from('conversation_channels').select('id').eq('conversation_id', conversation.id).eq('name', 'Members').maybeSingle(), 'find chat channel') as { id: string } | null;
    const actualChannel = channel ?? unwrap(await admin.from('conversation_channels').insert({ conversation_id: conversation.id, name: 'Members', display_order: 0 }).select('id').single(), 'create chat channel');
    channelIds.push(actualChannel.id);
    await chunked(userIds.map((user_id) => ({ conversation_id: conversation.id, user_id })), 500, async (rows) => {
      unwrap(await admin.from('conversation_participants').upsert(rows, { onConflict: 'conversation_id,user_id' }), 'seed conversation participants');
    });
  }
  const manifest: SeedManifest = { schemaVersion: 1, namespace, universityId: config.universityId, size, userIds, emails, passwords, clubIds, eventIds, postIds, conversationIds, channelIds, createdAt: new Date().toISOString(), createdUniversity };
  const file = manifestPath(config, namespace, size);
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return file;
}

export async function teardown(config: LoadTestConfig, args: Record<string, string | boolean>): Promise<void> {
  assertWriteApproved(config);
  const manifest = readManifest(config, typeof args.manifest === 'string' ? args.manifest : undefined);
  if (manifest.universityId !== config.universityId) throw new Error('Manifest university does not match LOADTEST_UNIVERSITY_ID');
  const admin = serviceClient(config);
  const ids = (name: string, values: string[]) => chunked(values, 100, async (chunk) => {
    if (chunk.length) unwrap(await admin.from(name).delete().in('id', chunk), `delete ${name}`);
  });
  await ids('posts', manifest.postIds);
  await ids('events', manifest.eventIds);
  await ids('conversations', manifest.conversationIds);
  await ids('clubs', manifest.clubIds);
  for (const id of manifest.userIds) {
    const deleted = await admin.auth.admin.deleteUser(id);
    if (deleted.error && !deleted.error.message.toLowerCase().includes('not found')) throw deleted.error;
  }
  if (manifest.createdUniversity) {
    const university = await admin.from('universities').select('id').eq('id', manifest.universityId).maybeSingle();
    if (university.data?.id === manifest.universityId) unwrap(await admin.from('universities').delete().eq('id', manifest.universityId), 'delete synthetic university');
  }
}

export function seedArgs(argv: string[]): Record<string, string | boolean> { return parseArgs(argv); }
