import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  getNotificationPreferences,
  updateNotificationPreference,
  type NotificationPreferences,
} from '../services/notificationService';

export function useNotificationPreferences(userId: string | undefined) {
  return useQuery({
    queryKey: ['notificationPreferences', userId],
    queryFn: () => getNotificationPreferences(userId!),
    enabled: !!userId,
    staleTime: 30 * 1000,
  });
}

export function useUpdateNotificationPreference(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<NotificationPreferences>) => {
      const current =
        queryClient.getQueryData<NotificationPreferences>(['notificationPreferences', userId]) ??
        DEFAULT_NOTIFICATION_PREFERENCES;
      return updateNotificationPreference(userId!, current, patch);
    },
    // Optimistic: a toggle must not visibly lag its own tap.
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: ['notificationPreferences', userId] });
      const previous = queryClient.getQueryData<NotificationPreferences>([
        'notificationPreferences',
        userId,
      ]);
      queryClient.setQueryData<NotificationPreferences>(
        ['notificationPreferences', userId],
        (old) => ({ ...(old ?? DEFAULT_NOTIFICATION_PREFERENCES), ...patch }),
      );
      return { previous };
    },
    onError: (_err, _patch, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['notificationPreferences', userId], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['notificationPreferences', userId] });
    },
  });
}
