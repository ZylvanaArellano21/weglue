import { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AttachmentSheet } from './AttachmentSheet';
import type { AttachmentDraft } from '../../hooks/useConversation';
import { chatColors, chatFonts, chatShadow, chatSizes } from './chatTheme';

interface Props {
  mode?: 'group' | 'direct';
  isRestricted?: boolean;
  isOfficer?: boolean;
  /** Authoritative per-channel posting permission (Bug 19). When provided it
   * overrides the isRestricted/isOfficer fallback. */
  canPost?: boolean;
  /** Explanation shown to blocked users in place of the composer. */
  blockedReason?: string;
  disabled?: boolean;
  /** Must return immediately (optimistic pipeline handles delivery). */
  onSendText: (content: string) => void;
  /** Returns {ok:false,error} for rejected files (size cap etc.). */
  onSendAttachment: (draft: AttachmentDraft) => { ok: boolean; error?: string };
  onAttachmentError?: (message: string) => void;
  onOpenPoll?: () => void;
}

/**
 * Chat composer — no microphone (store compliance).
 * Empty input → attachment controls (paperclip / poll / image shortcut).
 * Typed text → the attachment icons give way to a Send button.
 * Sending never blocks the input: the field clears immediately, the keyboard
 * stays open, and delivery/retry is the send pipeline's job.
 */
export function ChatInput({
  mode = 'group',
  isRestricted = false,
  isOfficer = false,
  canPost,
  blockedReason,
  disabled = false,
  onSendText,
  onSendAttachment,
  onAttachmentError,
  onOpenPoll,
}: Props) {
  const [text, setText] = useState('');
  const [attachOpen, setAttachOpen] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const effectiveCanPost = canPost !== undefined ? canPost : isRestricted ? isOfficer : true;
  const showPoll = mode === 'group' && !!onOpenPoll;
  const hasText = text.trim().length > 0;

  if (!effectiveCanPost) {
    return (
      <View style={styles.restrictedBanner}>
        <Ionicons name="megaphone-outline" size={16} color={chatColors.textMuted} />
        <Text style={styles.restrictedText}>{blockedReason ?? 'Officers only'}</Text>
      </View>
    );
  }

  function handleSend() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setText('');
    // Keyboard stays open: no blur, no await.
    onSendText(trimmed);
  }

  return (
    <>
      <View style={styles.bar}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          placeholder="Message..."
          placeholderTextColor={chatColors.text}
          value={text}
          onChangeText={setText}
          multiline
          maxLength={2000}
          editable={!disabled}
        />

        <View style={styles.actions}>
          {hasText ? (
            <TouchableOpacity
              style={styles.sendBtn}
              onPress={handleSend}
              disabled={disabled}
              accessibilityLabel="Send message"
            >
              <Ionicons name="arrow-up" size={18} color={chatColors.cream} />
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={() => setAttachOpen(true)}
                disabled={disabled}
                accessibilityLabel="Attach"
              >
                <Ionicons name="attach" size={20} color={chatColors.text} />
              </TouchableOpacity>

              {showPoll && (
                <TouchableOpacity
                  style={styles.iconBtn}
                  onPress={onOpenPoll}
                  disabled={disabled}
                  accessibilityLabel="Create poll"
                >
                  <Ionicons name="list" size={20} color={chatColors.text} />
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      </View>

      <AttachmentSheet
        visible={attachOpen}
        onClose={() => setAttachOpen(false)}
        onPicked={(draft) => {
          setAttachOpen(false);
          const res = onSendAttachment(draft);
          if (!res.ok && res.error) onAttachmentError?.(res.error);
        }}
        onError={(message) => onAttachmentError?.(message)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: chatSizes.inputBarHeight,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: chatColors.bg,
    borderTopLeftRadius: chatSizes.inputBarRadius,
    borderTopRightRadius: chatSizes.inputBarRadius,
    ...chatShadow,
  },
  input: {
    flex: 1,
    fontFamily: chatFonts.regular,
    fontSize: 14,
    letterSpacing: 0.38,
    color: chatColors.text,
    maxHeight: 100,
    paddingVertical: 4,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginLeft: 8,
  },
  iconBtn: {
    padding: 6,
  },
  sendBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: chatColors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  restrictedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    backgroundColor: chatColors.bg,
    borderTopWidth: 1,
    borderTopColor: chatColors.border,
  },
  restrictedText: {
    fontFamily: chatFonts.regular,
    fontSize: 14,
    color: chatColors.textMuted,
  },
});
