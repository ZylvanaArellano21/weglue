import { useState } from 'react';
import { Alert, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  submitReport,
  REPORT_SUCCESS_MESSAGE,
  REPORT_RECEIVED_MESSAGE,
  type ReportEntityType,
} from '../../services/reportService';

// The app-wide three-dot report menu. Every entity (club, event, post, user,
// message, chat) uses this same flow: tap ⋯ → confirm → report row + support
// email → one consistent success confirmation. Placement is the caller's job
// (each context positions it so it never overlaps titles or action buttons);
// behavior is identical everywhere.

const ENTITY_LABEL: Record<ReportEntityType, string> = {
  club: 'club',
  event: 'event',
  post: 'post',
  user: 'user',
  message: 'message',
  chat: 'chat',
};

export interface ReportButtonProps {
  entityType: ReportEntityType;
  entityId: string;
  entityName?: string | null;
  clubId?: string | null;
  /** Icon-only styling knobs so each context stays proportional. */
  size?: number;
  color?: string;
  backgroundColor?: string;
  style?: StyleProp<ViewStyle>;
}

export function openReportFlow(options: {
  entityType: ReportEntityType;
  entityId: string;
  entityName?: string | null;
  clubId?: string | null;
  /**
   * Supplied ONLY when reporting a `user`, to offer "Report and block" in the
   * same step. Reporting someone is the moment they most want the contact to
   * stop, and making them find a second menu afterwards is a poor safety flow.
   *
   * Blocking runs FIRST and independently of the report: if the report request
   * fails (offline, email transport), the block must still take effect, because
   * the block is the part that actually protects the student.
   */
  onBlock?: () => void;
}): void {
  const label = ENTITY_LABEL[options.entityType];
  const canBlock = options.entityType === 'user' && typeof options.onBlock === 'function';

  Alert.alert('Report', `Do you want to report this ${label}?`, [
    { text: 'Cancel', style: 'cancel' },
    ...(canBlock
      ? [
          {
            text: 'Report and block',
            style: 'destructive' as const,
            onPress: () => {
              options.onBlock?.();
              submitReport({
                entityType: options.entityType,
                entityId: options.entityId,
                entityName: options.entityName ?? null,
                clubId: options.clubId ?? null,
              }).catch(() => {
                // The block already happened and is what matters here. Report
                // failure is surfaced quietly so the confirmation the student
                // sees is about the protection they just gained.
              });
            },
          },
        ]
      : []),
    {
      text: 'Report',
      style: 'destructive',
      onPress: () => {
        submitReport({
          entityType: options.entityType,
          entityId: options.entityId,
          entityName: options.entityName ?? null,
          clubId: options.clubId ?? null,
        })
          .then((result) => {
            // Truthful state: "sent" only when the support email actually
            // went out; otherwise confirm receipt (the report row is stored
            // and the email failure is recorded server-side for retry).
            if (result.emailed) {
              Alert.alert('Report sent', REPORT_SUCCESS_MESSAGE);
            } else {
              Alert.alert('Report received', REPORT_RECEIVED_MESSAGE);
            }
          })
          .catch(() => {
            Alert.alert(
              'Something went wrong',
              'Your report could not be sent. Please check your connection and try again.',
            );
          });
      },
    },
  ]);
}

export function ReportButton({
  entityType,
  entityId,
  entityName,
  clubId,
  size = 20,
  color = '#000000',
  backgroundColor = 'rgba(255,255,255,0.85)',
  style,
}: ReportButtonProps) {
  // Guard against double-taps while the confirm dialog is opening.
  const [busy, setBusy] = useState(false);

  return (
    <TouchableOpacity
      onPress={() => {
        if (busy) return;
        setBusy(true);
        openReportFlow({ entityType, entityId, entityName, clubId });
        setTimeout(() => setBusy(false), 400);
      }}
      activeOpacity={0.7}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={`Report this ${ENTITY_LABEL[entityType]}`}
      style={[
        {
          backgroundColor,
          borderRadius: 20,
          padding: 8,
        },
        style,
      ]}
    >
      <Ionicons name="ellipsis-horizontal" size={size} color={color} />
    </TouchableOpacity>
  );
}
