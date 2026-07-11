import { useState } from 'react';
import { Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { followUser, unfollowUser } from '../../services/followService';
import { useInvalidateFollowSurfaces, type RelationState } from '../../hooks/useFollowStates';

// ─── Shared relationship chip ────────────────────────────────────────────────
// Renders the correct state (Follow / Following / Follow Back / Requested /
// Gluemate) and mutates through the ONE existing follow system so every
// surface (profiles, home, search, club lists, chat info) stays in sync.

interface Props {
  viewerId: string;
  targetUserId: string;
  state: RelationState;
  onChanged?: (next: RelationState) => void;
}

const LABELS: Record<RelationState, string> = {
  gluemate: 'Gluemate',
  following: 'Following',
  requested: 'Requested',
  follow_back: 'Follow Back',
  follow: 'Follow',
};

export function FollowStateButton({ viewerId, targetUserId, state, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const invalidate = useInvalidateFollowSurfaces();

  const outlined = state === 'gluemate' || state === 'following' || state === 'requested';

  async function handlePress() {
    if (busy) return;
    setBusy(true);
    try {
      if (state === 'following' || state === 'gluemate' || state === 'requested') {
        await unfollowUser(viewerId, targetUserId);
        onChanged?.(state === 'gluemate' ? 'follow_back' : 'follow');
      } else {
        await followUser(viewerId, targetUserId);
        onChanged?.(state === 'follow_back' ? 'gluemate' : 'following');
      }
      invalidate();
    } finally {
      setBusy(false);
    }
  }

  return (
    <TouchableOpacity
      onPress={handlePress}
      disabled={busy}
      activeOpacity={0.8}
      style={[styles.base, outlined ? styles.outlined : styles.filled]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={outlined ? '#0FA6A6' : '#fff'} />
      ) : (
        <Text style={[styles.label, outlined ? styles.labelOutlined : styles.labelFilled]}>
          {LABELS[state]}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    minWidth: 86,
    alignItems: 'center',
  },
  filled: {
    backgroundColor: '#0FA6A6',
  },
  outlined: {
    borderWidth: 1.5,
    borderColor: '#0FA6A6',
    backgroundColor: 'transparent',
  },
  label: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.38,
  },
  labelFilled: {
    color: '#fff',
  },
  labelOutlined: {
    color: '#0FA6A6',
  },
});
