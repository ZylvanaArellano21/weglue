import { supabase } from '../lib/supabase';

export interface PollOption {
  id: string;
  option_text: string;
  order_index: number;
  vote_count: number;
  user_voted: boolean;
}

export interface ClubPoll {
  id: string;
  club_id: string;
  channel_id: string | null;
  created_by: string;
  question: string;
  allow_multiple: boolean;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  options: PollOption[];
  total_votes: number;
}

export interface CreatePollInput {
  club_id: string;
  channel_id: string | null;
  question: string;
  allow_multiple: boolean;
  options: string[];
  start_date?: string;
  end_date?: string;
}

export async function sendPoll(
  createdBy: string,
  channelId: string,
  clubId: string,
  input: CreatePollInput,
): Promise<ClubPoll> {
  const { data: poll, error: pollError } = await supabase
    .from('club_polls')
    .insert({
      club_id: clubId,
      channel_id: channelId,
      created_by: createdBy,
      question: input.question,
      allow_multiple: input.allow_multiple,
      start_date: input.start_date ?? null,
      end_date: input.end_date ?? null,
    })
    .select('id')
    .single();

  if (pollError) throw pollError;

  const optionRows = input.options.map((text, idx) => ({
    poll_id: poll.id,
    option_text: text,
    order_index: idx,
  }));

  const { error: optionsError } = await supabase
    .from('club_poll_options')
    .insert(optionRows);

  if (optionsError) throw optionsError;

  // Insert a channel_message referencing this poll
  const { error: msgError } = await supabase.from('channel_messages').insert({
    channel_id: channelId,
    club_id: clubId,
    sender_id: createdBy,
    content: null,
    attachment_type: 'poll',
    poll_id: poll.id,
  });

  if (msgError) throw msgError;

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
      .from('club_polls')
      .select('id, club_id, channel_id, created_by, question, allow_multiple, start_date, end_date, created_at')
      .eq('id', pollId)
      .single(),
    supabase
      .from('club_poll_options')
      .select('id, option_text, order_index')
      .eq('poll_id', pollId)
      .order('order_index'),
    supabase
      .from('club_poll_votes')
      .select('option_id, voter_id')
      .eq('poll_id', pollId),
  ]);

  if (!poll) return null;

  const voteCountByOption: Record<string, number> = {};
  const userVotedOptions = new Set<string>();

  for (const v of (votes ?? []) as any[]) {
    voteCountByOption[v.option_id] = (voteCountByOption[v.option_id] ?? 0) + 1;
    if (v.voter_id === viewerId) userVotedOptions.add(v.option_id);
  }

  const pollOptions: PollOption[] = ((options ?? []) as any[]).map((o) => ({
    id: o.id,
    option_text: o.option_text,
    order_index: o.order_index,
    vote_count: voteCountByOption[o.id] ?? 0,
    user_voted: userVotedOptions.has(o.id),
  }));

  const totalVotes = (votes ?? []).length;

  return {
    ...(poll as any),
    options: pollOptions,
    total_votes: totalVotes,
  };
}

export async function votePoll(
  pollId: string,
  voterId: string,
  optionIds: string[],
): Promise<void> {
  const { data: poll } = await supabase
    .from('club_polls')
    .select('allow_multiple')
    .eq('id', pollId)
    .single();

  if (!poll) throw new Error('Poll not found.');

  if (!poll.allow_multiple && optionIds.length > 1) {
    throw new Error('This poll only allows one vote.');
  }

  const { data: existingVotes } = await supabase
    .from('club_poll_votes')
    .select('id, option_id')
    .eq('poll_id', pollId)
    .eq('voter_id', voterId);

  const existingOptionIds = new Set(
    ((existingVotes ?? []) as any[]).map((v) => v.option_id),
  );

  const toAdd = optionIds.filter((id) => !existingOptionIds.has(id));
  const toRemove = [...existingOptionIds].filter((id) => optionIds.includes(id));

  // Toggle: voting the same option again removes it
  const toggleRemove = optionIds.filter((id) => existingOptionIds.has(id));

  if (toggleRemove.length > 0) {
    await supabase
      .from('club_poll_votes')
      .delete()
      .eq('poll_id', pollId)
      .eq('voter_id', voterId)
      .in('option_id', toggleRemove);
    return;
  }

  if (toAdd.length > 0) {
    if (!poll.allow_multiple) {
      // Remove any existing vote first
      await supabase
        .from('club_poll_votes')
        .delete()
        .eq('poll_id', pollId)
        .eq('voter_id', voterId);
    }

    await supabase.from('club_poll_votes').insert(
      toAdd.map((optionId) => ({
        poll_id: pollId,
        option_id: optionId,
        voter_id: voterId,
      })),
    );
  }
}
