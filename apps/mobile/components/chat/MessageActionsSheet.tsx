import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import type { ThreadMessage } from '../../services/messagingService';
import { chatColors, chatFonts, chatShadow, chatTypography } from './chatTheme';

// ─── Long-press message action menu ─────────────────────────────────────────
// Own content:   Copy (text) · Unsend for everyone · Delete for me
// Others':       Copy (text) · Delete for me · Report
// Officers/group admin additionally get "Delete for everyone" on others'
// messages in chats they moderate (server re-validates in unsend_message).

export const REPORT_REASONS = [
  'Spam',
  'Harassment or bullying',
  'Hate speech',
  'Inappropriate content',
  'Impersonation',
  'Other',
] as const;

interface Props {
  message: ThreadMessage | null;
  isOwn: boolean;
  canModerate: boolean;
  onClose: () => void;
  onUnsend: (messageId: string) => void;
  onDeleteForMe: (messageId: string) => void;
  onReport: (messageId: string, reason: string, details?: string) => void;
  onSaveMedia?: (messageId: string) => void;
}

export function MessageActionsSheet({
  message,
  isOwn,
  canModerate,
  onClose,
  onUnsend,
  onDeleteForMe,
  onReport,
  onSaveMedia,
}: Props) {
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');

  const visible = !!message;
  const isText = message?.message_type === 'text';
  const isMedia = message?.message_type === 'image' || message?.message_type === 'video';

  function close() {
    setReporting(false);
    setReason(null);
    setDetails('');
    onClose();
  }

  async function handleCopy() {
    if (message?.content) await Clipboard.setStringAsync(message.content);
    close();
  }

  function submitReport() {
    if (!message || !reason) return;
    onReport(message.id, reason, details.trim() || undefined);
    close();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.overlay} onPress={close}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.handle} />

            {!reporting ? (
              <>
                {isText && !!message?.content && (
                  <ActionRow icon="copy-outline" label="Copy" onPress={handleCopy} />
                )}
                {isMedia && onSaveMedia && (
                  <ActionRow
                    icon="download-outline"
                    label="Save"
                    onPress={() => {
                      onSaveMedia(message!.id);
                      close();
                    }}
                  />
                )}
                <ActionRow
                  icon="eye-off-outline"
                  label="Delete for me"
                  onPress={() => {
                    onDeleteForMe(message!.id);
                    close();
                  }}
                />
                {(isOwn || canModerate) && (
                  <ActionRow
                    icon="arrow-undo-outline"
                    label={isOwn ? 'Unsend for everyone' : 'Delete for everyone'}
                    destructive
                    onPress={() => {
                      onUnsend(message!.id);
                      close();
                    }}
                  />
                )}
                {!isOwn && (
                  <ActionRow
                    icon="flag-outline"
                    label="Report"
                    destructive
                    onPress={() => setReporting(true)}
                  />
                )}
                <TouchableOpacity style={styles.cancelRow} onPress={close}>
                  <Text style={styles.cancelLabel}>Cancel</Text>
                </TouchableOpacity>
              </>
            ) : (
              <View style={styles.reportWrap}>
                <Text style={styles.reportTitle}>Report message</Text>
                <Text style={styles.reportSub}>
                  Your report is confidential. The sender won't know who reported them.
                </Text>
                {REPORT_REASONS.map((r) => (
                  <TouchableOpacity
                    key={r}
                    style={[styles.reasonRow, reason === r && styles.reasonRowActive]}
                    onPress={() => setReason(r)}
                    activeOpacity={0.75}
                  >
                    <View style={[styles.radio, reason === r && styles.radioActive]} />
                    <Text style={styles.reasonLabel}>{r}</Text>
                  </TouchableOpacity>
                ))}
                <TextInput
                  style={styles.detailsInput}
                  placeholder="Add details (optional)"
                  placeholderTextColor={chatColors.textMuted}
                  value={details}
                  onChangeText={setDetails}
                  multiline
                  maxLength={500}
                />
                <TouchableOpacity
                  style={[styles.submitBtn, !reason && styles.submitBtnDisabled]}
                  disabled={!reason}
                  onPress={submitReport}
                >
                  <Text style={styles.submitLabel}>Submit report</Text>
                </TouchableOpacity>
              </View>
            )}
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

function ActionRow({
  icon,
  label,
  destructive,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  destructive?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <Ionicons name={icon} size={21} color={destructive ? '#C62828' : chatColors.text} />
      <Text style={[styles.rowLabel, destructive && styles.rowLabelDestructive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    backgroundColor: chatColors.bg,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingBottom: 28,
    ...chatShadow,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: chatColors.textMuted,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 22,
    paddingVertical: 15,
  },
  rowLabel: {
    ...chatTypography.infoRow,
  },
  rowLabelDestructive: {
    color: '#C62828',
  },
  cancelRow: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 4,
  },
  cancelLabel: {
    fontFamily: chatFonts.semiBold,
    fontSize: 14,
    color: chatColors.textMuted,
  },
  reportWrap: {
    paddingHorizontal: 22,
    paddingTop: 6,
  },
  reportTitle: {
    ...chatTypography.chatTitle,
    fontSize: 18,
    marginBottom: 4,
  },
  reportSub: {
    fontFamily: chatFonts.regular,
    fontSize: 12,
    color: chatColors.textMuted,
    marginBottom: 12,
    lineHeight: 17,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  reasonRowActive: {},
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: chatColors.textMuted,
  },
  radioActive: {
    borderColor: chatColors.teal,
    backgroundColor: chatColors.teal,
  },
  reasonLabel: {
    fontFamily: chatFonts.regular,
    fontSize: 14,
    color: chatColors.text,
  },
  detailsInput: {
    backgroundColor: chatColors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: chatColors.border,
    minHeight: 70,
    padding: 12,
    fontFamily: chatFonts.regular,
    fontSize: 13,
    color: chatColors.text,
    marginTop: 8,
    textAlignVertical: 'top',
  },
  submitBtn: {
    backgroundColor: chatColors.teal,
    borderRadius: 40,
    alignItems: 'center',
    paddingVertical: 13,
    marginTop: 14,
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitLabel: {
    fontFamily: chatFonts.semiBold,
    fontSize: 14,
    color: chatColors.cream,
  },
});
