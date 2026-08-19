import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createSafeChannel, removeSafeChannel } from '../lib/realtime';
import { refreshOfficerStatus } from '../store/officerStore';
import { clearPermissionSensitiveStudentContent } from '../lib/studentSynchronization';

// ─── App-wide club/role/channel realtime sync (Bug 19) ──────────────────────
// Keeps officer status, club-chat access, conversation titles, channel lists
// and posting permissions live across devices without a manual refresh, app
// restart, logout or re-navigation. Mounted once at the tabs layout. All work
// is targeted cache invalidation + an officer-status refresh — never polling.
export function useClubRealtimeSync(userId: string | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;

    const invalidateClubState = () => {
      clearPermissionSensitiveStudentContent(queryClient);
      queryClient.invalidateQueries({ queryKey: ['myChats'] });
      queryClient.invalidateQueries({ queryKey: ['conversationHub'] });
      queryClient.invalidateQueries({ queryKey: ['clubChannels'] });
      queryClient.invalidateQueries({ queryKey: ['chatDetails'] });
      queryClient.invalidateQueries({ queryKey: ['clubMembers'] });
      queryClient.invalidateQueries({ queryKey: ['clubDetail'] });
      queryClient.invalidateQueries({ queryKey: ['clubs'] });
      queryClient.invalidateQueries({ queryKey: ['joinedClubs'] });
    };

    const invalidateChannels = () => {
      queryClient.invalidateQueries({ queryKey: ['conversationHub'] });
      queryClient.invalidateQueries({ queryKey: ['clubChannels'] });
      queryClient.invalidateQueries({ queryKey: ['chatDetails'] });
      // Fix 5 — this was missing, so a permission change (mode or the
      // certain-people list) never reached an already-open Chat Info /
      // Permissions screen on another device: it reads its own
      // ['channelMeta', channelId] query, keyed separately from the three
      // above, with a 60s staleTime and nothing else invalidating it.
      queryClient.invalidateQueries({ queryKey: ['channelMeta'] });
    };

    const channel = createSafeChannel('club-sync', [
      // My own membership/role row: promoted, demoted, added, removed. Refresh
      // officer status so officer-gated UI (Add Channel, permission controls,
      // Officers chat access) flips within ~1s, and rewire every club query.
      {
        event: '*',
        schema: 'public',
        table: 'club_members',
        filter: `user_id=eq.${userId}`,
        callback: () => {
          void refreshOfficerStatus(userId);
          invalidateClubState();
        },
      },
      // Club rename → Members/Officers conversation titles everywhere.
      { event: 'UPDATE', schema: 'public', table: 'clubs', callback: invalidateClubState },
      // Channel added / renamed / deleted / permission changed anywhere in a
      // conversation I'm in → hub rows, thread headers and info stay current.
      { event: '*', schema: 'public', table: 'conversation_channels', callback: invalidateChannels },
      // Certain-people posting rights changed for anyone in a channel I can
      // see (RLS still scopes delivery) → re-derive on next thread open.
      // Deliberately unfiltered by user_id: an officer editing SOMEONE
      // ELSE's access, or checking the saved state from a second device,
      // needs this too — not just a change to the viewer's own row.
      {
        event: '*',
        schema: 'public',
        table: 'channel_posters',
        callback: invalidateChannels,
      },
    ]);

    return () => removeSafeChannel(channel);
  }, [userId, queryClient]);
}
