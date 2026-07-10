import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '@weglue/shared';
import { useLeaveClubStore } from '../../store/leaveClubStore';
import { refreshOfficerStatus } from '../../store/officerStore';
import {
  getClubOfficerCount,
  getIsClubOfficer,
  OnlyOfficerError,
} from '../../services/clubService';
import { useLeaveClubMutation } from '../../hooks/useClubMembership';
import { LeaveClubModals, type LeaveTarget } from './LeaveClubModals';
import { useToast } from '../Toast';
import { supabase } from '../../lib/supabase';

// The ONE place a leave-club confirmation can render. Mounted once in the
// root layout; every screen raises requests through requestLeaveClub()
// (store/leaveClubStore.ts). Eligibility is decided against club_members on
// the server BEFORE any modal mounts, so the sole-officer note and the leave
// confirmation are mutually exclusive by construction — nothing is ever
// queued or hidden underneath. The leave_club RPC re-checks on the server,
// so even a stale client can never orphan a club.
export function LeaveClubHost() {
  const userId = useAuthStore((s) => s.session?.user.id);
  const request = useLeaveClubStore((s) => s.request);
  const setRequest = useLeaveClubStore((s) => s.setRequest);
  const { show, ToastComponent } = useToast();
  const { mutate: leaveMutate, isPending } = useLeaveClubMutation(userId);

  const [target, setTarget] = useState<LeaveTarget | null>(null);

  // A new request → verify against the server, then mount exactly one modal.
  useEffect(() => {
    if (!request) {
      setTarget(null);
      return;
    }
    let cancelled = false;

    (async () => {
      let clubName = request.clubName ?? '';
      try {
        if (!clubName) {
          const { data } = await supabase
            .from('clubs')
            .select('name')
            .eq('id', request.clubId)
            .maybeSingle();
          clubName = (data as { name?: string } | null)?.name ?? '';
        }
        // Server truth first: role from club_members, then (officers only)
        // the live officer count to detect the sole-officer case.
        const isOfficer = userId ? await getIsClubOfficer(userId, request.clubId) : false;
        if (cancelled) return;
        if (!isOfficer) {
          setTarget({ clubId: request.clubId, clubName, mode: 'normal' });
          return;
        }
        const count = await getClubOfficerCount(request.clubId);
        if (cancelled) return;
        setTarget({
          clubId: request.clubId,
          clubName,
          mode: count <= 1 ? 'blocked' : 'officer',
        });
      } catch {
        if (cancelled) return;
        // Network hiccup: show the officer-style confirmation (the stricter
        // copy). The RPC still blocks a sole officer server-side.
        setTarget({ clubId: request.clubId, clubName, mode: 'officer' });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [request, userId]);

  const finish = useCallback(() => {
    setTarget(null);
    setRequest(null);
  }, [setRequest]);

  const handleConfirm = useCallback(() => {
    if (!target || !request) return;
    const { clubId, clubName, mode } = target;
    // 'blocked' has no destructive action — its confirm button just dismisses.
    if (mode === 'blocked') {
      finish();
      return;
    }
    const onLeft = request.onLeft;
    finish();
    leaveMutate(clubId, {
      onSuccess: (result) => {
        if (result === 'left') {
          show(`You left ${clubName || 'the club'}.`);
          void refreshOfficerStatus(userId);
          onLeft?.();
        } else if (result === 'blocked_only_officer') {
          // Race backstop (another officer left first). Nothing was mutated —
          // surface the sole-officer note, never a failure toast.
          setTarget({ clubId, clubName, mode: 'blocked' });
          setRequest({ clubId, clubName });
        }
      },
      onError: (err) => {
        if (err instanceof OnlyOfficerError) {
          setTarget({ clubId, clubName, mode: 'blocked' });
          setRequest({ clubId, clubName });
        } else {
          show('Failed to leave club.', 'error');
        }
      },
    });
  }, [target, request, finish, leaveMutate, show, userId, setRequest]);

  return (
    <>
      {ToastComponent}
      <LeaveClubModals
        target={target}
        loading={isPending}
        onConfirm={handleConfirm}
        onCancel={finish}
      />
    </>
  );
}
