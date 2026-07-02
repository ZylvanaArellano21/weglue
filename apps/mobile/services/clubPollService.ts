import { supabase } from '../lib/supabase';
import { getClubConversationId } from './channelService';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PollOption {
  id: string;
  option_text: string;
  display_order: number;
  vote_count: number;
  user_voted: boolean;
  voter_usernames: string[];
}

export interface ClubPoll {
  id: string;
  message_id: string;
  conversation_id: string;
  channel_id: string | null;
  created_by: string;
  question: string;
  allow_multiple: boolean;
  start_at: string | null;
  end_at: string | null;
  created_at: string;
  options: PollOption[];
  total_votes: number;
}

export interface CreatePollInput {
  question: string;
  allow_multiple: boolean;
  options: string[];
  start_at?: string;
  end_at?: string;
}

// ─── Polls ────────────────────────────────────────────────────────────────────

/**
 * Creates a poll message in a channel.
 * Steps: insert message (type='poll') → insert poll → insert poll_options.
 */
export async function sendPoll(
  createdBy: string,
  channelId: string,
  clubId: string,
  input: CreatePollInput,
): Promise<ClubPoll> {
  const conversationId = await getClubConversationId(clubId);
  if (!conversationId) throw new Error('Club group chat not found.');

  // Insert poll message first
  const { data: msg, error: msgError } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      channel_id: channelId,
      sender_id: createdBy,
      content: null,
      message_type: 'poll',
    })
    .select('id')
    .single();

  if (msgError) throw msgError;

  // Insert poll record linked to the message
  const { data: poll, error: pollError } = await supabase
    .from('polls')
    .insert({
      message_id: msg.id,
      question: input.question,
      allow_multiple: input.allow_multiple,
      start_at: input.start_at ?? null,
      end_at: input.end_at ?? null,
    })
    .select('id')
    .single();

  if (pollError) throw pollError;

  // Insert poll options
  const optionRows = input.options.map((text, idx) => ({
    poll_id: poll.id,
    option_text: text,
    display_order: idx,
  }));

  const { error: optionsError } = await supabase
    .from('poll_options')
    .insert(optionRows);

  if (optionsError) throw optionsError;

  const fullPoll = await getClubPoll(poll.id, createdBy);
  if (!fullPoll) throw new Error('Failed to load created poll.');
  return fullPoll;
}

export async function getClubPoll(
  pollId: string,
  viewerId: string,
): Promise<ClubPoll | null> {
  const [{ data: poll }, { data: options }, { data: votes }] = await Promise.all([
    supabase
      .from('polls')
      .select(
        'id, message_id, question, allow_multiple, start_at, end_at, created_at, messages!inner(conversation_id, channel_id, sender_id)',
      )
      .eq('id', pollId)
      .single(),
    supabase
      .from('poll_options')
      .select('id, option_text, display_order')
      .eq('poll_id', pollId)
      .order('display_order'),
    supabase
      .from('poll_votes')
      .select('option_id, user_id, profiles!user_id(username)')
      .eq('poll_id', pollId),
  ]);

  if (!poll) return null;

  const votesByOption: Record<string, { count: number; usernames: string[] }> = {};
  const userVotedOptions = new Set<string>();

  for (const v of (votes ?? []) as any[]) {
    if (!votesByOption[v.option_id]) {
      votesByOption[v.option_id] = { count: 0, usernames: [] };
    }
    votesByOption[v.option_id].count += 1;
    votesByOption[v.option_id].usernames.push(v.profiles?.username ?? '');
    if (v.user_id === viewerId) userVotedOptions.add(v.option_id);
  }

  const pollOptions: PollOption[] = ((options ?? []) as any[]).map((o) => ({
    id: o.id,
    option_text: o.option_text,
    display_order: o.display_order,
    vote_count: votesByOption[o.id]?.count ?? 0,
    user_voted: userVotedOptions.has(o.id),
    voter_usernames: votesByOption[o.id]?.usernames ?? [],
  }));

  const msg = (poll as any).messages;

  return {
    id: pollId,
    message_id: (poll as any).message_id,
    conversation_id: msg.conversation_id,
    channel_id: msg.channel_id,
    created_by: msg.sender_id,
    question: (poll as any).question,
    allow_multiple: (poll as any).allow_multiple,
    start_at: (poll as any).start_at,
    end_at: (poll as any).end_at,
    created_at: (poll as any).created_at,
    options: pollOptions,
    total_votes: (votes ?? []).length,
  };
}

/**
 * Votes on a poll option.
 * Uses the cast_poll_vote RPC which enforces:
 *   - membership, voting window, allow_multiple toggle.
 */
export async function votePoll(
  pollId: string,
  _voterId: string,
  optionIds: string[],
): Promise<void> {
  for (const optionId of optionIds) {
    const { error } = await supabase.rpc('cast_poll_vote', {
      p_poll_id: pollId,
      p_option_id: optionId,
    });
    if (error) throw error;
  }
}

/** Returns polls for a club conversation, ordered newest first. Used in group chat info Polls tab. */
export async function getClubPollHistory(
  clubId: string,
  viewerId: string,
): Promise<ClubPoll[]> {
  const conversationId = await getClubConversationId(clubId);
  if (!conversationId) return [];

  const { data: pollRows, error } = await supabase
    .from('polls')
    .select('id, messages!inner(conversation_id)')
    .eq('messages.conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw error;

  const polls = await Promise.all(
    ((pollRows ?? []) as any[]).map((row) => getClubPoll(row.id, viewerId)),
  );

  return polls.filter(Boolean) as ClubPoll[];
}
