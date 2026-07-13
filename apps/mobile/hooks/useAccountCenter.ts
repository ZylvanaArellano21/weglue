import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  changeEmail,
  changePassword,
  changeUsername,
  checkUsernameAvailability,
  deleteOwnAccount,
  type ChangeEmailResult,
  type ChangePasswordResult,
  type ChangeUsernameResult,
  type UsernameAvailability,
} from '../services/accountService';
import { supabase } from '../lib/supabase';
import {
  rememberTokenForRevocation,
  tearDownAuthenticatedSession,
} from '../lib/sessionCleanup';

// Username availability — debounced 400ms to avoid hammering the DB
export function useUsernameAvailability(
  currentUserId: string | undefined,
  username: string,
) {
  const [availability, setAvailability] = useState<UsernameAvailability | null>(null);
  const [checking, setChecking] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!currentUserId || !username.trim()) {
      setAvailability(null);
      return;
    }

    setChecking(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const result = await checkUsernameAvailability(username.trim(), currentUserId);
        setAvailability(result);
      } finally {
        setChecking(false);
      }
    }, 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [username, currentUserId]);

  return { availability, checking };
}

export function useChangeUsername(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation<ChangeUsernameResult, Error, string>({
    mutationFn: (newUsername: string) => changeUsername(userId!, newUsername),
    onSuccess: (result) => {
      if (result.success) {
        queryClient.invalidateQueries({ queryKey: ['ownProfile', userId] });
      }
    },
  });
}

export function useChangeEmail(userId: string | undefined) {
  return useMutation<ChangeEmailResult, Error, string>({
    mutationFn: (newEmail: string) => changeEmail(userId!, newEmail),
  });
}

export function useChangePassword() {
  return useMutation<ChangePasswordResult, Error, { newPassword: string; confirmPassword: string }>({
    mutationFn: ({ newPassword, confirmPassword }) =>
      changePassword(newPassword, confirmPassword),
  });
}

// Account deletion — two-step confirmation enforced by the hook
export function useDeleteAccount(userId: string | undefined) {
  const queryClient = useQueryClient();

  const [confirmStep, setConfirmStep] = useState<0 | 1 | 2>(0);

  const resetConfirmation = useCallback(() => setConfirmStep(0), []);
  const advanceToStep1    = useCallback(() => setConfirmStep(1), []);
  const advanceToStep2    = useCallback(() => setConfirmStep(2), []);

  const mutation = useMutation<void, Error, void>({
    mutationFn: async () => {
      if (!userId) throw new Error('Not authenticated');
      if (confirmStep !== 2) throw new Error('Deletion confirmation steps not completed');

      // Capture the token up front: after the server deletes the account the
      // session is void, and teardown needs something to revoke.
      const { data } = await supabase.auth.getSession();
      rememberTokenForRevocation(data.session?.access_token);

      // Throws unless the account (data AND auth record) is really gone. On a
      // throw we fall through to onError and change NOTHING locally — the
      // account stays intact and usable, which is the whole point.
      await deleteOwnAccount();

      // Only now, with deletion server-confirmed, do we touch local state.
      // AWAITED — the old code fired sign-out with `void` and navigated
      // immediately, so the router raced the session clear: the guard still saw
      // a session and bounced back into the app, and a relaunch mid-flight
      // restored the dead session. Awaiting the single shared teardown closes
      // that race, and it runs the same path as logout.
      await tearDownAuthenticatedSession(queryClient, userId);
    },
  });

  return {
    confirmStep,
    advanceToStep1,
    advanceToStep2,
    resetConfirmation,
    executeDeletion: mutation.mutateAsync,
    isDeleting: mutation.isPending,
    deletionError: mutation.error,
  };
}
