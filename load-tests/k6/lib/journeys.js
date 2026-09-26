// Pure request builders for every journey. Imported by k6/main.js (which
// executes them) and by the Vitest contract tests (which verify them), so the
// tested request set is exactly the executed request set. Each journey is a
// list of stages; the calls inside one stage run in parallel, mirroring the
// app's Promise.all groups at the contract commit.

export const JOURNEY_NAMES = Object.freeze([
  'launch', 'home', 'events', 'discover', 'club', 'notifications', 'inbox', 'thread', 'message-send', 'social-write',
]);

export const WRITE_JOURNEYS = Object.freeze(['message-send', 'social-write']);

const get = (path) => ({ method: 'GET', path });
const rpc = (name, body = {}) => ({ method: 'POST', path: `/rest/v1/rpc/${name}`, body });

// getMyChats (apps/mobile/services/chatService.ts) at the contract commit.
const CHAT_LIST_SELECT = 'conversation_id,last_read_at,joined_at,hidden_at,cleared_before,muted_at,archived_at,'
  + 'conversations!inner(id,type,name,avatar_url,club_id,created_by,deleted_at,banner_broadcast_active,banner_epoch,'
  + 'clubs(id,name,avatar_url),conversation_participants(user_id,profiles!user_id(username,full_name,avatar_url)),'
  + 'conversation_channels(id,name,is_default,display_order),'
  + 'messages(id,sender_id,content,message_type,created_at,deleted_at,deleted_by,profiles!sender_id(username,full_name)))';

export function chatListPath(userId) {
  return `/rest/v1/conversation_participants?select=${CHAT_LIST_SELECT}&user_id=eq.${userId}`
    + '&conversations.messages.order=created_at.desc&conversations.messages.limit=30&order=joined_at.desc';
}

/** Conversations (by manifest index) that include the user as a participant. */
export function eligibleConversationIndexes(manifest, userIndex) {
  return manifest.clubSizes.map((size, index) => ({ size, index })).filter((item) => userIndex < item.size).map((item) => item.index);
}

export function conversationIndexFor(manifest, userIndex, entityIndex) {
  const eligible = eligibleConversationIndexes(manifest, userIndex);
  if (eligible.length === 0) throw new Error(`No synthetic conversation available to user ${userIndex}`);
  return eligible[entityIndex % eligible.length];
}

function homeStages(ctx) {
  const { session, manifest } = ctx;
  const uid = session.userId;
  const postIds = manifest.postIds.slice(0, 20).join(',');
  const authors = manifest.users.slice(0, 20).map((user) => user.id).join(',');
  return [
    [
      get(`/rest/v1/follows?select=following_id,status&follower_id=eq.${uid}`),
      get(`/rest/v1/follows?select=follower_id&following_id=eq.${uid}&status=eq.accepted`),
      get(`/rest/v1/profiles?select=university&id=eq.${uid}`),
    ],
    [
      get('/rest/v1/posts?select=id,image_url,caption,created_at,author_id,club_id,author_kind,'
        + 'profiles!inner(id,username,avatar_url,university),clubs(id,name,avatar_url)'
        + `&profiles.university=eq.${encodeURIComponent(manifest.universityName)}&order=created_at.desc&offset=0&limit=20`),
    ],
    [
      get(`/rest/v1/post_likes?select=post_id,user_id&post_id=in.(${postIds})`),
      get(`/rest/v1/post_comments?select=post_id&post_id=in.(${postIds})`),
      get(`/rest/v1/user_privacy?select=user_id,is_private&user_id=in.(${authors})`),
      get(`/rest/v1/post_club_tags?select=post_id,club_id,clubs(id,name)&post_id=in.(${postIds})`),
      get(`/rest/v1/post_images?select=post_id,position,width,height&post_id=in.(${postIds})`),
    ],
  ];
}

function eventsStages(ctx) {
  const { session, manifest, nowIso } = ctx;
  const uid = session.userId;
  const eventIds = manifest.eventIds.slice(0, 20).join(',');
  return [
    [
      get(`/rest/v1/club_members?select=club_id,role&user_id=eq.${uid}`),
      get(`/rest/v1/user_activities?select=activity&user_id=eq.${uid}`),
      get(`/rest/v1/saved_events?select=event_id&user_id=eq.${uid}`),
      get(`/rest/v1/event_rsvps?select=event_id,status&user_id=eq.${uid}`),
    ],
    [
      get('/rest/v1/events?select=id,title,description,cover_image_url,event_date,start_time,end_time,event_end_at,location,building,room,'
        + 'club_id,created_by,visibility,specific_user_ids,clubs!inner(id,name,avatar_url),event_images(position,width,height),'
        + `event_interests(interest),event_activities(activity)&event_end_at=gt.${encodeURIComponent(nowIso)}&order=event_date.asc,id.asc&limit=20`),
      get(`/rest/v1/event_rsvps?select=event_id,user_id,profiles!inner(id,username,avatar_url)&event_id=in.(${eventIds})&status=eq.going`),
    ],
  ];
}

function launchStages(ctx) {
  const uid = ctx.session.userId;
  return [
    [
      rpc('my_access_state'),
      get(`/rest/v1/profiles?select=*&id=eq.${uid}`),
      get(`/rest/v1/user_interests?select=interest,interest_id&user_id=eq.${uid}`),
      rpc('my_sync_university_id'),
      get('/rest/v1/app_releases?select=version,released_at,store_url,build_number&platform=eq.ios&is_public=eq.true&order=released_at.desc&limit=1'),
    ],
    [
      rpc('get_unread_summary'),
      get(chatListPath(uid)),
      get(`/rest/v1/message_hides?select=message_id&user_id=eq.${uid}`),
      get(`/rest/v1/channel_mutes?select=channel_id&user_id=eq.${uid}`),
      get(`/rest/v1/club_members?select=clubs!inner(id,name,avatar_url)&user_id=eq.${uid}&role=eq.officer`),
    ],
    ...homeStages(ctx),
    ...eventsStages(ctx),
  ];
}

function discoverStages(ctx) {
  const uid = ctx.session.userId;
  return [
    [rpc('get_phone_discovery_categories')],
    [
      rpc('get_phone_discovery_clubs', { p_user_id: uid, p_interest_slug: null, p_limit: 20, p_offset: 0 }),
      rpc('get_discovery_people', { p_user_id: uid }),
      rpc('get_discovery_events', { p_user_id: uid, p_limit: 20, p_offset: 0 }),
    ],
    [rpc('search_discovery', { p_user_id: uid, p_query: 'Load Test' })],
  ];
}

function clubStages(ctx) {
  const { manifest, action } = ctx;
  const id = manifest.clubIds[action.entityIndex % manifest.clubIds.length];
  return [[
    get(`/rest/v1/clubs?select=*&id=eq.${id}`),
    get(`/rest/v1/club_members?select=user_id,role,joined_at&club_id=eq.${id}`),
    get(`/rest/v1/club_officers?select=*&club_id=eq.${id}`),
    get(`/rest/v1/club_photos?select=*&club_id=eq.${id}`),
    get(`/rest/v1/club_goals?select=*&club_id=eq.${id}`),
    get(`/rest/v1/club_interests?select=*&club_id=eq.${id}`),
    rpc('get_club_profile_events', { p_club_id: id }),
    get(`/rest/v1/posts?select=*&club_id=eq.${id}&order=created_at.desc&limit=20`),
    rpc('club_shared_identities', { p_club_id: id }),
    get(`/rest/v1/conversations?select=id,type,club_id&club_id=eq.${id}`),
  ]];
}

function notificationsStages(ctx) {
  const uid = ctx.session.userId;
  return [
    [get('/rest/v1/notifications?select=id,type,actor_id,entity_id,entity_type,read,created_at,message,route,group_count,group_actors,'
      + `profiles!notifications_actor_id_fkey(id,username,avatar_url)&user_id=eq.${uid}&order=created_at.desc&limit=100`)],
    [{ method: 'PATCH', path: `/rest/v1/notifications?user_id=eq.${uid}&read=eq.false`, body: { read: true }, headers: { Prefer: 'return=minimal' }, write: true }],
    [rpc('get_unread_summary')],
  ];
}

function inboxStages(ctx) {
  const uid = ctx.session.userId;
  return [[get(chatListPath(uid)), get(`/rest/v1/message_hides?select=message_id&user_id=eq.${uid}`)], [rpc('get_unread_summary')]];
}

function threadStages(ctx) {
  const { session, manifest, action } = ctx;
  const index = conversationIndexFor(manifest, session.userIndex, action.entityIndex);
  const conversationId = manifest.conversationIds[index];
  const channelId = manifest.channelIds[index];
  return [
    [
      get(`/rest/v1/messages?select=*&conversation_id=eq.${conversationId}&channel_id=eq.${channelId}&order=created_at.desc&limit=40`),
      get(`/rest/v1/message_hides?select=message_id&user_id=eq.${session.userId}`),
      get(`/rest/v1/conversation_participants?select=cleared_before&conversation_id=eq.${conversationId}&user_id=eq.${session.userId}`),
      rpc('conversation_shared_identities', { p_conversation_id: conversationId }),
      rpc('conversation_restricted_senders', { p_conversation_id: conversationId }),
    ],
    [{ ...rpc('mark_conversation_read', { p_conversation_id: conversationId }), write: true }],
  ];
}

/**
 * Deterministic UUID client_tag for one campaign write. `messages.client_tag`
 * is a uuid column; the namespace marker travels in the message content.
 */
export function actionClientTag(sha256Hex, uuidFromSha256Hex, namespace, action, cycle) {
  return uuidFromSha256Hex(sha256Hex(`${namespace}:action-tag:${action.clientTag}:cycle:${cycle}`));
}

function messageSendStages(ctx) {
  const { session, manifest, action, namespace, cycle, clientTag, sentAt } = ctx;
  const index = conversationIndexFor(manifest, session.userIndex, action.entityIndex);
  return [[{
    method: 'POST',
    path: '/rest/v1/messages',
    body: {
      conversation_id: manifest.conversationIds[index],
      channel_id: manifest.channelIds[index],
      sender_id: session.userId,
      // The send time lets Realtime receivers measure end-to-end delivery latency.
      content: `${namespace}:action:${action.sequence}:cycle:${cycle}:t:${sentAt}`,
      message_type: 'text',
      client_tag: clientTag,
    },
    headers: { Prefer: 'return=minimal' },
    write: true,
  }]];
}

function socialWriteStages(ctx) {
  const { session, manifest, action } = ctx;
  const eventId = manifest.eventIds[action.entityIndex % manifest.eventIds.length];
  const uid = session.userId;
  // Toggle on then off so every write leaves the synthetic state unchanged.
  if (action.entityIndex % 2 === 0) {
    return [
      [get(`/rest/v1/event_rsvps?select=status&event_id=eq.${eventId}&user_id=eq.${uid}`)],
      [{ method: 'POST', path: '/rest/v1/event_rsvps?on_conflict=event_id,user_id', body: { event_id: eventId, user_id: uid, status: 'going' }, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, write: true }],
      [{ method: 'DELETE', path: `/rest/v1/event_rsvps?event_id=eq.${eventId}&user_id=eq.${uid}`, write: true }],
    ];
  }
  return [
    [{ method: 'POST', path: '/rest/v1/saved_events?on_conflict=user_id,event_id', body: { user_id: uid, event_id: eventId }, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, write: true }],
    [{ method: 'DELETE', path: `/rest/v1/saved_events?user_id=eq.${uid}&event_id=eq.${eventId}`, write: true }],
  ];
}

const BUILDERS = {
  launch: launchStages,
  home: homeStages,
  events: eventsStages,
  discover: discoverStages,
  club: clubStages,
  notifications: notificationsStages,
  inbox: inboxStages,
  thread: threadStages,
  'message-send': messageSendStages,
  'social-write': socialWriteStages,
};

/** Stages for one trace action. `ctx` = { session, manifest, action, namespace, nowIso, cycle, clientTag, sentAt }. */
export function buildJourney(journey, ctx) {
  const builder = BUILDERS[journey];
  if (!builder) throw new Error(`Unknown journey ${journey}`);
  return builder(ctx);
}

const FORBIDDEN = /push_tokens|send-push|functions\/v1|expo\.dev|exp\.host|\/auth\/v1\/(signup|otp|recover|magiclink)|\/storage\/v1/i;

/** Throws if any stage would touch push registration/delivery, Edge Functions, OTP/email, or Storage. */
export function assertAllowedStages(journey, stages) {
  for (const stage of stages) {
    for (const call of stage) {
      if (FORBIDDEN.test(call.path)) throw new Error(`Forbidden request in ${journey}: ${call.path}`);
      if (!call.path.startsWith('/rest/v1/')) throw new Error(`Journey ${journey} must only call PostgREST: ${call.path}`);
      if (call.method !== 'GET' && call.method !== 'POST' && call.method !== 'PATCH' && call.method !== 'DELETE') throw new Error(`Unexpected method ${call.method}`);
      if (call.method !== 'GET' && !call.path.startsWith('/rest/v1/rpc/') && !call.write) throw new Error(`Unmarked write in ${journey}: ${call.path}`);
    }
  }
}
