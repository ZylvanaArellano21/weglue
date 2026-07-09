import { useCallback, useState } from 'react';
import { useOfficerStore, refreshOfficerStatus } from '../store/officerStore';
import { getClubOfficerCount, getIsClubOfficer, OnlyOfficerError } from '../services/clubService';
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

// Centralizes the officer-aware leave flow so Home event cards, both event
// detail screens, and the Club Profile screen behave identically. Exactly ONE
// target (→ one modal) can exist at a time, so the sole-officer note can never
// stack on top of a leave confirmation. Officer status is verified against
// club_members server-side on every request — a stale officer cache can no
// longer pick the wrong modal — and the actual mutation is enforced again by
// the leave_club RPC (migration 029), so a sole officer can never leave.
export function useLeaveClubFlow(userId: string | undefined, showToast: ToastFn) {
  const { officerClubIds } = useOfficerStore();
  const { mutate: leaveMutate, isPending } = useLeaveClubMutation(userId);
  const [target, setTarget] = useState<LeaveTarget | null>(null);
  const [checking, setChecking] = useState(false);

  const requestLeave = useCallback(
    async (clubId: string, clubName: string) => {
      setChecking(true);
      try {
        // Server truth first: role from club_members, then (officers only)
        // the live officer count to detect the sole-officer case.
        const isOfficer = userId ? await getIsClubOfficer(userId, clubId) : false;
        if (!isOfficer) {
          setTarget({ clubId, clubName, mode: 'normal' });
          return;
        }
        const count = await getClubOfficerCount(clubId);
        setTarget({ clubId, clubName, mode: count <= 1 ? 'blocked' : 'officer' });
      } catch {
        // Network hiccup: fall back to the cached officer list. The RPC still
        // blocks a sole officer, so the club can never be orphaned.
        const cachedOfficer = officerClubIds.includes(clubId);
        setTarget({ clubId, clubName, mode: cachedOfficer ? 'officer' : 'normal' });
      } finally {
        setChecking(false);
      }
    },
    [userId, officerClubIds],
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
