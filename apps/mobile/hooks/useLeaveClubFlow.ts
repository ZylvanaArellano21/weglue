import { useCallback, useState } from 'react';
import { useOfficerStore, refreshOfficerStatus } from '../store/officerStore';
import { getClubOfficerCount, OnlyOfficerError } from '../services/clubService';
import { useLeaveClubMutation } from './useClubMembership';

// Which confirmation a "leave club" tap should surface:
//   normal  → plain member leave confirm
//   officer → officer leave confirm (explains the permissions they'll lose)
//   blocked → sole-officer note (leaving is not allowed yet)
export type LeaveMode = 'normal' | 'officer' | 'blocked';

export interface LeaveTarget {
  clubId: string;
  clubName: string;
  mode: LeaveMode;
}

type ToastFn = (message: string, type?: 'success' | 'error' | 'info') => void;

// Centralizes the officer-aware leave flow so Home event cards and the Club
// Profile screen behave identically. Officer status comes from the real
// club_members source (officerStore + a live officer count), and the actual
// mutation is enforced again server-side by the leave_club RPC (migration 029),
// so a former officer can never keep permissions through stale UI/cache.
export function useLeaveClubFlow(userId: string | undefined, showToast: ToastFn) {
  const { officerClubIds } = useOfficerStore();
  const { mutate: leaveMutate, isPending } = useLeaveClubMutation(userId);
  const [target, setTarget] = useState<LeaveTarget | null>(null);
  const [checking, setChecking] = useState(false);

  const requestLeave = useCallback(
    async (clubId: string, clubName: string) => {
      const isOfficer = officerClubIds.includes(clubId);
      if (!isOfficer) {
        setTarget({ clubId, clubName, mode: 'normal' });
        return;
      }
      // Officer: check whether they're the last one before choosing the modal.
      setChecking(true);
      try {
        const count = await getClubOfficerCount(clubId);
        setTarget({ clubId, clubName, mode: count <= 1 ? 'blocked' : 'officer' });
      } catch {
        // Network hiccup: fall back to the officer confirm. The RPC still
        // blocks a sole officer, so the club can never be orphaned.
        setTarget({ clubId, clubName, mode: 'officer' });
      } finally {
        setChecking(false);
      }
    },
    [officerClubIds],
  );

  const cancel = useCallback(() => setTarget(null), []);

  const confirm = useCallback(
    (onLeft?: () => void) => {
      if (!target) return;
      const { clubId, clubName, mode } = target;
      // 'blocked' has no destructive action — its confirm button just dismisses.
      if (mode === 'blocked') {
        setTarget(null);
        return;
      }
      setTarget(null);
      leaveMutate(clubId, {
        onSuccess: (result) => {
          if (result === 'left') {
            showToast(`You left ${clubName}.`);
            void refreshOfficerStatus(userId);
            onLeft?.();
          } else if (result === 'blocked_only_officer') {
            // Race backstop (another officer left first). Nothing was mutated.
            showToast(
              "You're the only officer of this club. Assign another officer before leaving.",
              'error',
            );
          }
        },
        onError: (err) => {
          showToast(
            err instanceof OnlyOfficerError ? err.message : 'Failed to leave club.',
            'error',
          );
        },
      });
    },
    [target, leaveMutate, showToast, userId],
  );

  return { target, checking, isPending, requestLeave, cancel, confirm };
}
