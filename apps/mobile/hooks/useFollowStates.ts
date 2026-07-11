import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

// ─── Shared follow-state resolution ─────────────────────────────────────────
// One source of truth for relationship chips everywhere (chat info People,
// members lists, search, profiles). States:
//   gluemate   — mutual accepted follows
//   following  — I follow them (accepted)
//   requested  — my follow is pending their approval
//   follow_back— they follow me, I don't follow them
//   follow     — no relationship

export type RelationState = 'gluemate' | 'following' | 'requested' | 'follow_back' | 'follow';

export interface FollowStateMap {
  [userId: string]: RelationState;
}

export function computeRelation(
  mine: { status: string } | undefined,
  theirs: { status: string } | undefined,
): RelationState {
  const iFollow = mine?.status === 'accepted';
  const iRequested = mine?.status === 'pending';
  const theyFollow = theirs?.status === 'accepted';
  if (iFollow && theyFollow) return 'gluemate';
  if (iFollow) return 'following';
  if (iRequested) return 'requested';
  if (theyFollow) return 'follow_back';
  return 'follow';
}

export async function fetchFollowStates(viewerId: string, userIds: string[]): Promise<FollowStateMap> {
  if (userIds.length === 0) return {};
  const [{ data: outgoing }, { data: incoming }] = await Promise.all([
    supabase
      .from('follows')
      .select('following_id, status')
      .eq('follower_id', viewerId)
      .in('following_id', userIds),
    supabase
      .from('follows')
      .select('follower_id, status')
      .eq('following_id', viewerId)
      .in('follower_id', userIds),
  ]);

  const mine = new Map<string, { status: string }>();
  for (const r of (outgoing ?? []) as any[]) mine.set(r.following_id, { status: r.status });
  const theirs = new Map<string, { status: string }>();
  for (const r of (incoming ?? []) as any[]) theirs.set(r.follower_id, { status: r.status });

  const map: FollowStateMap = {};
  for (const id of userIds) {
    map[id] = computeRelation(mine.get(id), theirs.get(id));
  }
  return map;
}

export function useFollowStates(viewerId: string | undefined, userIds: string[]) {
  const key = [...userIds].sort().join(',');
  return useQuery({
    queryKey: ['followStates', viewerId, key],
    queryFn: () => fetchFollowStates(viewerId!, userIds),
    enabled: !!viewerId && userIds.length > 0,
    staleTime: 15 * 1000,
  });
}

/** Invalidate every surface that renders relationship state. */
export function useInvalidateFollowSurfaces() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['followStates'] });
    queryClient.invalidateQueries({ queryKey: ['userProfile'] });
    queryClient.invalidateQueries({ queryKey: ['clubMembers'] });
    queryClient.invalidateQueries({ queryKey: ['search'] });
    queryClient.invalidateQueries({ queryKey: ['suggestedPeople'] });
  };
}
