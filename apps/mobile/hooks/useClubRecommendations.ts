import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

// The persistent club-match batch shown inside Home → Events.
//
// The batch lives in the database (club_recommendation_batches), NOT in local
// state: the count promised on the account-creation screen has to be the same
// count the user sees after verifying — possibly on a different device, after a
// reinstall, or on Android having signed up on iPhone.
//
// The server also self-heals the batch on read: a club that was deleted,
// deactivated, or already joined is dropped and replaced by the next
// best-ranked club, so the original count is preserved.

export interface RecommendedClub {
  id: string;
  name: string;
  avatar_url: string | null;
  cover_image_url: string | null;
}

export interface ClubRecommendationBatch {
  batch_id: string;
  count: number;
  source: 'onboarding' | 'interest_update';
  clubs: RecommendedClub[];
}

export type ClubRecommendationOutcome =
  | { kind: 'matches'; batch: ClubRecommendationBatch }
  | { kind: 'all_joined' }
  | { kind: 'none_available' };

export const clubRecommendationsKey = (userId?: string) =>
  ['clubRecommendations', userId] as const;

async function fetchClubRecommendations(): Promise<ClubRecommendationBatch | null> {
  const { data, error } = await supabase.rpc('get_my_club_recommendations');
  if (error) throw error;
  if (!data) return null; // no active batch: dismissed, completed, or never created
  return data as ClubRecommendationBatch;
}

export function useClubRecommendations(userId?: string) {
  return useQuery({
    queryKey: clubRecommendationsKey(userId),
    queryFn: fetchClubRecommendations,
    enabled: !!userId,
    // The batch only changes on join / dismiss / new survey — all of which
    // invalidate it explicitly. Keeping it fresh avoids a refetch (and the
    // resulting flicker) when Home regains focus after visiting a club.
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useDismissClubRecommendations(userId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (batchId: string) => {
      const { error } = await supabase.rpc('dismiss_club_recommendation_batch', {
        p_batch_id: batchId,
      });
      if (error) throw error;
    },
    // Hide the section immediately; the RPC is idempotent, so a double tap or a
    // retry is harmless.
    onMutate: async () => {
      const key = clubRecommendationsKey(userId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ClubRecommendationBatch | null>(key);
      queryClient.setQueryData(key, null);
      return { previous };
    },
    onError: (_err, _batchId, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(clubRecommendationsKey(userId), context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: clubRecommendationsKey(userId) });
    },
  });
}

/**
 * Rebuilds the batch from the user's freshly saved interests/activities.
 * Supersedes whatever came before — dismissed, completed, or still active — so
 * saving the survey always brings the matches section back.
 */
export function useRegenerateClubRecommendations(userId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<ClubRecommendationOutcome> => {
      const { error } = await supabase.rpc('regenerate_my_club_recommendations');
      if (error) throw error;
      const { data, error: outcomeError } = await supabase.rpc('get_my_club_recommendation_outcome');
      if (outcomeError) throw outcomeError;
      return data as ClubRecommendationOutcome;
    },
    onSuccess: (outcome) => {
      queryClient.setQueryData(clubRecommendationsKey(userId), outcome.kind === 'matches' ? outcome.batch : null);
    },
  });
}
