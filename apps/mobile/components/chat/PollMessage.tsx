import { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getClubPoll, votePoll } from '../../services/clubPollService';
import { useRealtimePoll } from '../../hooks/useRealtimeMessages';

interface Props {
  pollId: string;
  messageId: string;
  userId: string;
  isOwn: boolean;
}

/**
 * Renders a poll inline in the chat thread.
 * Live vote counts and voter names update in real-time via Realtime subscription.
 * Respects allow_multiple and start_at/end_at — voting disabled outside window.
 */
export function PollMessage({ pollId, messageId: _messageId, userId, isOwn }: Props) {
  const queryClient = useQueryClient();
  const [votingOptionId, setVotingOptionId] = useState<string | null>(null);

  const { data: poll, isLoading } = useQuery({
    queryKey: ['poll', pollId, userId],
    queryFn: () => getClubPoll(pollId, userId),
    staleTime: 10 * 1000,
  });

  // Real-time vote updates
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
      <View style={[styles.container, isOwn && styles.containerOwn]}>
        <ActivityIndicator size="small" color={isOwn ? '#fff' : '#0FA6A6'} />
      </View>
    );
  }

  const maxVotes = Math.max(...poll.options.map((o) => o.vote_count), 1);

  return (
    <View style={[styles.container, isOwn && styles.containerOwn]}>
      <Text style={[styles.label, isOwn && styles.labelOwn]}>POLL</Text>
      <Text style={[styles.question, isOwn && styles.questionOwn]}>{poll.question}</Text>

      {!isActive && (
        <Text style={[styles.statusLabel, isOwn && styles.statusLabelOwn]}>
          {poll.end_at && now > new Date(poll.end_at) ? 'Poll ended' : 'Poll not started'}
        </Text>
      )}

      {poll.options.map((option) => {
        const pct = poll.total_votes > 0
          ? Math.round((option.vote_count / poll.total_votes) * 100)
          : 0;
        const isVoting = votingOptionId === option.id;

        return (
          <TouchableOpacity
            key={option.id}
            style={[
              styles.optionRow,
              option.user_voted && styles.optionRowVoted,
              !isActive && styles.optionRowDisabled,
            ]}
            onPress={() => handleVote(option.id)}
            disabled={!isActive || !!votingOptionId}
            activeOpacity={0.75}
          >
            {/* Background fill bar */}
            <View
              style={[
                styles.fillBar,
                {
                  width: `${pct}%`,
                  backgroundColor: option.user_voted
                    ? (isOwn ? 'rgba(255,255,255,0.35)' : '#0FA6A620')
                    : (isOwn ? 'rgba(255,255,255,0.15)' : '#F3F4F6'),
                },
              ]}
            />

            <View style={styles.optionContent}>
              {isVoting ? (
                <ActivityIndicator size="small" color={isOwn ? '#fff' : '#0FA6A6'} />
              ) : (
                <View
                  style={[
                    styles.checkbox,
                    option.user_voted && styles.checkboxVoted,
                    isOwn && option.user_voted && styles.checkboxVotedOwn,
                  ]}
                />
              )}
              <Text
                style={[styles.optionText, isOwn && styles.optionTextOwn]}
                numberOfLines={2}
              >
                {option.option_text}
              </Text>
              <Text style={[styles.pct, isOwn && styles.pctOwn]}>{pct}%</Text>
            </View>

            {/* Voter names */}
            {option.voter_usernames.length > 0 && (
              <Text style={[styles.voters, isOwn && styles.votersOwn]} numberOfLines={1}>
                {option.voter_usernames.slice(0, 3).join(', ')}
                {option.voter_usernames.length > 3
                  ? ` +${option.voter_usernames.length - 3}`
                  : ''}
              </Text>
            )}
          </TouchableOpacity>
        );
      })}

      <Text style={[styles.totalVotes, isOwn && styles.totalVotesOwn]}>
        {poll.total_votes} {poll.total_votes === 1 ? 'vote' : 'votes'}
        {poll.allow_multiple ? ' · Multiple choice' : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minWidth: 220,
    maxWidth: 280,
  },
  containerOwn: {},
  label: {
    fontFamily: 'Zain_700Bold',
    fontSize: 10,
    letterSpacing: 1,
    color: '#0FA6A6',
    marginBottom: 4,
  },
  labelOwn: {
    color: 'rgba(255,255,255,0.7)',
  },
  question: {
    fontFamily: 'Zain_700Bold',
    fontSize: 14,
    color: '#1A1A1A',
    marginBottom: 10,
    lineHeight: 20,
  },
  questionOwn: {
    color: '#fff',
  },
  statusLabel: {
    fontFamily: 'Zain_400Regular',
    fontSize: 12,
    color: '#9CA3AF',
    marginBottom: 8,
    fontStyle: 'italic',
  },
  statusLabelOwn: {
    color: 'rgba(255,255,255,0.6)',
  },
  optionRow: {
    position: 'relative',
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  optionRowVoted: {
    borderColor: '#0FA6A6',
  },
  optionRowDisabled: {
    opacity: 0.7,
  },
  fillBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    borderRadius: 8,
  },
  optionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  checkbox: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#D1D5DB',
  },
  checkboxVoted: {
    backgroundColor: '#0FA6A6',
    borderColor: '#0FA6A6',
  },
  checkboxVotedOwn: {
    backgroundColor: '#fff',
    borderColor: '#fff',
  },
  optionText: {
    fontFamily: 'Zain_400Regular',
    fontSize: 13,
    color: '#1A1A1A',
    flex: 1,
  },
  optionTextOwn: {
    color: '#fff',
  },
  pct: {
    fontFamily: 'Zain_700Bold',
    fontSize: 12,
    color: '#6B7280',
  },
  pctOwn: {
    color: 'rgba(255,255,255,0.8)',
  },
  voters: {
    fontFamily: 'Zain_400Regular',
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 3,
  },
  votersOwn: {
    color: 'rgba(255,255,255,0.6)',
  },
  totalVotes: {
    fontFamily: 'Zain_400Regular',
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 4,
    textAlign: 'right',
  },
  totalVotesOwn: {
    color: 'rgba(255,255,255,0.6)',
  },
});
