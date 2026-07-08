import { ConfirmModal } from '../ConfirmModal';
import type { LeaveTarget } from '../../hooks/useLeaveClubFlow';

interface LeaveClubModalsProps {
  target: LeaveTarget | null;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// Renders the correct leave-club confirmation for the current target mode.
// Shared by Home event cards and the Club Profile screen so the copy and
// behavior stay in lockstep (iOS + Android identical).
export function LeaveClubModals({ target, loading, onConfirm, onCancel }: LeaveClubModalsProps) {
  const clubName = target?.clubName ?? 'this club';
  const mode = target?.mode ?? 'normal';

  if (mode === 'blocked') {
    // Task 13 — sole officer cannot leave until another officer exists.
    return (
      <ConfirmModal
        visible={!!target}
        title="You're the only officer"
        message={`You're the only officer of ${clubName}. Assign another officer before leaving so the club can still be managed.`}
        confirmLabel="Got it"
        hideCancel
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
  }

  if (mode === 'officer') {
    // Task 12 — officer leaving loses officer permissions.
    return (
      <ConfirmModal
        visible={!!target}
        title={`Leave ${clubName}?`}
        message={
          "If you leave this club, you won't be an officer anymore and you'll lose your officer permissions:\n\n" +
          '• Officer group chat\n' +
          '• Posting events for this club\n' +
          '• Tagging / hosting events as this club\n' +
          '• Editing the club\n' +
          '• Members-only events (if you leave the club)'
        }
        confirmLabel="Leave & give up officer"
        cancelLabel="Stay"
        destructive
        loading={loading}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
  }

  // Normal member leave.
  return (
    <ConfirmModal
      visible={!!target}
      title={`Are you sure you want to leave ${clubName}?`}
      message="You'll lose access to club chats and updates."
      confirmLabel="Yes, Leave"
      cancelLabel="No"
      destructive
      loading={loading}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
