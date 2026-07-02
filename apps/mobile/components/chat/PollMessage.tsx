import { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getClubPoll, votePoll } from '../../services/clubPollService';
import { useRealtimePoll } from '../../hooks/useRealtimeMessages';
import { chatColors, chatFonts, chatShadow, chatTypography } from './chatTheme';

interface Props {
  pollId: string;
  messageId: string;
  userId: string;
  isOwn: boolean;
}

/**
 * Inline poll card — visually distinct from text bubbles; teal accent card style.
 */
export function PollMessage({ pollId, messageId: _messageId, userId, isOwn: _isOwn }: Props) {
  const queryClient = useQueryClient();
  const [votingOptionId, setVotingOptionId] = useState<string | null>(null);

  const { data: poll, isLoading } = useQuery({
    queryKey: ['poll', pollId, userId],
    queryFn: () => getClubPoll(pollId, userId),
    staleTime: 10 * 1000,
  });

  useRealtimePoll(pollId);

  const { mutate: vote } = useMutation({
    mutationFn: (optionId: string) => votePoll(pollId, userId, [optionId]),
    onMutate: (optionId) => setVotingOptionId(optionId),
    onSettled: () => {
      setVotingOptionId(null);
      queryClient.invalidateQueries({ queryKey: ['poll', pollId] });
    },
  });

  const now = new Date();
  const isActive = poll
    ? (!poll.start_at || now >= new Date(poll.start_at)) &&
      (!poll.end_at || now <= new Date(poll.end_at))
    : false;

  const handleVote = useCallback(
    (optionId: string) => {
      if (!isActive) return;
      vote(optionId);
    },
    [isActive, vote],
  );

  if (isLoading || !poll) {
    return (
      <View style={styles.card}>
        <ActivityIndicator size="small" color={chatColors.teal} />
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.question}>{poll.question}</Text>

      {!isActive && (
        <Text style={styles.status}>
          {poll.end_at && now > new Date(poll.end_at) ? 'Poll ended' : 'Poll not started'}
        </Text>
      )}

      {poll.options.map((option) => {
        const isVoting = votingOptionId === option.id;
        return (
          <TouchableOpacity
            key={option.id}
            style={[styles.optionRow, option.user_voted && styles.optionRowVoted]}
            onPress={() => handleVote(option.id)}
            disabled={!isActive || !!votingOptionId}
            activeOpacity={0.75}
          >
            <View style={styles.optionMain}>
              {isVoting ? (
                <ActivityIndicator size="small" color={chatColors.teal} />
              ) : (
                <View style={[styles.radio, option.user_voted && styles.radioVoted]} />
              )}
              <Text style={styles.optionText} numberOfLines={2}>
                {option.option_text}
              </Text>
              <Text style={styles.voteCount}>{option.vote_count}</Text>
            </View>
            {option.voter_usernames.length > 0 && (
              <Text style={styles.voters} numberOfLines={1}>
                {option.voter_usernames.slice(0, 3).join(', ')}
                {option.voter_usernames.length > 3
                  ? ` +${option.voter_usernames.length - 3}`
                  : ''}
              </Text>
            )}
          </TouchableOpacity>
        );
      })}

      <Text style={styles.footer}>
        {poll.total_votes} {poll.total_votes === 1 ? 'vote' : 'votes'}
        {poll.allow_multiple ? ' · Multiple choice' : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    minWidth: 240,
    maxWidth: 300,
    backgroundColor: chatColors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: chatColors.border,
    padding: 14,
    ...chatShadow,
  },
  question: {
    fontFamily: chatFonts.semiBold,
    fontSize: 14,
    color: chatColors.text,
    marginBottom: 10,
    lineHeight: 20,
  },
  status: {
    fontFamily: chatFonts.regular,
    fontSize: 12,
    color: chatColors.textMuted,
    fontStyle: 'italic',
    marginBottom: 8,
  },
  optionRow: {
    borderRadius: 40,
    borderWidth: 1,
    borderColor: chatColors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
    backgroundColor: chatColors.bg,
  },
  optionRowVoted: {
    borderColor: chatColors.teal,
    backgroundColor: 'rgba(15,166,166,0.08)',
  },
  optionMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  radio: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: chatColors.textMuted,
  },
  radioVoted: {
    backgroundColor: chatColors.teal,
    borderColor: chatColors.teal,
  },
  optionText: {
    fontFamily: chatFonts.semiBold,
    fontSize: 13,
    color: chatColors.teal,
    flex: 1,
  },
  voteCount: {
    fontFamily: chatFonts.semiBold,
    fontSize: 12,
    color: chatColors.textMuted,
    minWidth: 20,
    textAlign: 'right',
  },
  voters: {
    fontFamily: chatFonts.regular,
    fontSize: 11,
    color: chatColors.textMuted,
    marginTop: 4,
    marginLeft: 22,
  },
  footer: {
    ...chatTypography.timestamp,
    marginTop: 6,
    textAlign: 'right',
  },
});
