"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  changeEmail,
  changePassword,
  changeUsername,
  checkUsernameAvailability,
  type ChangeEmailResult,
  type ChangePasswordResult,
  type ChangeUsernameResult,
  type UsernameAvailability,
} from "../accountCenter";

// Web port of apps/mobile/hooks/useAccountCenter.ts — same debounce, same
// invalidation, same typed results.

/** Username availability — debounced 400ms so typing doesn't hammer the DB. */
export function useUsernameAvailability(
  currentUserId: string | undefined,
  username: string
): { availability: UsernameAvailability | null; checking: boolean } {
  const [availability, setAvailability] = useState<UsernameAvailability | null>(null);
  const [checking, setChecking] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards against an out-of-order response overwriting a newer one.
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!currentUserId || !username.trim()) {
      setAvailability(null);
      setChecking(false);
      return;
    }

    setChecking(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const requestId = ++requestIdRef.current;

    debounceRef.current = setTimeout(async () => {
      try {
        const result = await checkUsernameAvailability(username.trim(), currentUserId);
        if (requestId === requestIdRef.current) setAvailability(result);
      } catch {
        if (requestId === requestIdRef.current) setAvailability(null);
      } finally {
        if (requestId === requestIdRef.current) setChecking(false);
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
      // The username appears in the profile page, the header dropdown, the
      // avatar picker heading, comments and chats — a full invalidation is the
      // safe way to guarantee no stale copy survives anywhere.
      if (result.success) void queryClient.invalidateQueries();
    },
  });
}

export function useChangeEmail(userId: string | undefined) {
  return useMutation<ChangeEmailResult, Error, string>({
    mutationFn: (newEmail: string) => changeEmail(userId!, newEmail),
  });
}

export function useChangePassword() {
  return useMutation<
    ChangePasswordResult,
    Error,
    { newPassword: string; confirmPassword: string }
  >({
    mutationFn: ({ newPassword, confirmPassword }) =>
      changePassword(newPassword, confirmPassword),
  });
}
