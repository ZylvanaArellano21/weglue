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
import { useAndroidKeyboardHeight } from '../../lib/useAndroidKeyboardHeight';
import * as Clipboard from 'expo-clipboard';
import type { ThreadMessage } from '../../services/messagingService';
import { chatColors, chatFonts, chatShadow, chatTypography } from './chatTheme';
import { QuickReactionBar, EmojiPickerSheet } from './ReactionPicker';

// ─── Long-press message action menu ─────────────────────────────────────────
// Own content:   Copy (text) · Unsend for everyone · Delete for me
// Others':       Copy (text) · Delete for me · Report
// Officers/group admin additionally get "Delete for everyone" on others'
// messages in chats they moderate (server re-validates in delete-message).

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
  /** Resolves true when the report is durably saved; false keeps the sheet
   * open with the reason + details preserved so the user can retry. */
  onReport: (messageId: string, reason: string, details?: string) => Promise<boolean>;
  onSaveMedia?: (messageId: string) => void;
  /** The viewer's own reaction on this message, if any. */
  myReaction?: string | null;
  /** Set (emoji) / clear (null) the viewer's reaction. Absent → no reaction UI. */
  onReact?: (messageId: string, emoji: string | null) => void;
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
  myReaction,
  onReact,
}: Props) {
  // Android: lift the report sheet above the keyboard (iOS keeps KAV padding).
  const { height: androidKeyboardHeight } = useAndroidKeyboardHeight();
  const [reporting, setReporting] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const visible = !!message;
  const isText = message?.message_type === 'text';
  const isMedia = message?.message_type === 'image' || message?.message_type === 'video';

  function close() {
    setReporting(false);
    setReason(null);
    setDetails('');
    setSubmitting(false);
    setSubmitError(false);
    setSubmitted(false);
    setEmojiPickerOpen(false);
    onClose();
  }

  function react(emoji: string | null) {
    if (message && onReact) onReact(message.id, emoji);
    close();
  }

  async function handleCopy() {
    if (message?.content) await Clipboard.setStringAsync(message.content);
    close();
  }

  async function submitReport() {
    // Prevent duplicate reports from repeated taps; keep the user's work on
    // failure and offer retry rather than closing and erasing it.
    if (!message || !reason || submitting || submitted) return;
    setSubmitting(true);
    setSubmitError(false);
    const ok = await onReport(message.id, reason, details.trim() || undefined);
    setSubmitting(false);
    if (ok) {
      setSubmitted(true);
      setTimeout(close, 1100);
    } else {
      setSubmitError(true);
    }
  }

  return (
    <>
    {/* iOS presents one modal at a time — while the full emoji keyboard is up,
        the action sheet's own modal steps aside so the keyboard is on top. */}
    <Modal visible={visible && !emojiPickerOpen} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.overlay} onPress={close}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={Platform.OS === 'android' ? { marginBottom: androidKeyboardHeight } : undefined}
        >
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.handle} />

            {!reporting && onReact ? (
              <QuickReactionBar
                current={myReaction}
                onReact={(e) => react(myReaction === e ? null : e)}
                onOpenFullPicker={() => setEmojiPickerOpen(true)}
              />
            ) : null}

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
                  editable={!submitting && !submitted}
                />
                {submitError && (
                  <Text style={styles.reportError}>
                    Couldn't submit right now. Your report was kept — tap Try again.
                  </Text>
                )}
                {submitted && <Text style={styles.reportSuccess}>Report submitted.</Text>}
                <TouchableOpacity
                  style={[styles.submitBtn, (!reason || submitting || submitted) && styles.submitBtnDisabled]}
                  disabled={!reason || submitting || submitted}
                  onPress={submitReport}
                >
                  <Text style={styles.submitLabel}>
                    {submitting
                      ? 'Submitting…'
                      : submitted
                        ? 'Report submitted'
                        : submitError
                          ? 'Try again'
                          : 'Submit report'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>

    <EmojiPickerSheet
      visible={emojiPickerOpen}
      current={myReaction}
      onPick={(e) => react(myReaction === e ? null : e)}
      onClose={close}
    />
    </>
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
  reportError: {
    fontFamily: chatFonts.regular,
    fontSize: 12,
    color: '#C62828',
    marginTop: 10,
  },
  reportSuccess: {
    fontFamily: chatFonts.semiBold,
    fontSize: 12,
    color: chatColors.teal,
    marginTop: 10,
  },
  submitLabel: {
    fontFamily: chatFonts.semiBold,
    fontSize: 14,
    color: chatColors.cream,
  },
});
