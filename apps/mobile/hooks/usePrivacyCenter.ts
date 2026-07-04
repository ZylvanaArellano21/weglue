import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getPrivacySettings,
  setPrivateAccount,
  setHideInterests,
  setHideEvents,
  type PrivacySettings,
} from '../services/privacyService';

export function usePrivacySettings(userId: string | undefined) {
  return useQuery({
    queryKey: ['privacySettings', userId],
    queryFn:  () => getPrivacySettings(userId!),
    enabled:  !!userId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSetPrivateAccount(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (isPrivate: boolean) => setPrivateAccount(userId!, isPrivate),
    onMutate: async (isPrivate) => {
      await queryClient.cancelQueries({ queryKey: ['privacySettings', userId] });
      const prev = queryClient.getQueryData<PrivacySettings>(['privacySettings', userId]);
      if (prev) {
        queryClient.setQueryData<PrivacySettings>(['privacySettings', userId], {
          ...prev,
          is_private: isPrivate,
        });
      }
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) {
        queryClient.setQueryData(['privacySettings', userId], context.prev);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['privacySettings', userId] });
    },
  });
}

export function useSetHideInterests(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (hide: boolean) => setHideInterests(userId!, hide),
    onMutate: async (hide) => {
      await queryClient.cancelQueries({ queryKey: ['privacySettings', userId] });
      const prev = queryClient.getQueryData<PrivacySettings>(['privacySettings', userId]);
      if (prev) {
        queryClient.setQueryData<PrivacySettings>(['privacySettings', userId], {
          ...prev,
          hide_interests: hide,
        });
      }
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) {
        queryClient.setQueryData(['privacySettings', userId], context.prev);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['privacySettings', userId] });
    },
  });
}

export function useSetHideEvents(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (hide: boolean) => setHideEvents(userId!, hide),
    onMutate: async (hide) => {
      await queryClient.cancelQueries({ queryKey: ['privacySettings', userId] });
      const prev = queryClient.getQueryData<PrivacySettings>(['privacySettings', userId]);
      if (prev) {
        queryClient.setQueryData<PrivacySettings>(['privacySettings', userId], {
          ...prev,
          hide_events: hide,
        });
      }
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) {
        queryClient.setQueryData(['privacySettings', userId], context.prev);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['privacySettings', userId] });
    },
  });
}
