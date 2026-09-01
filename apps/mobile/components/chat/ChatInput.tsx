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
import { PhotoTrayModal } from '../media/PhotoTray';
import type { AttachmentDraft } from '../../hooks/useConversation';
import { pickPhotos } from '../../lib/media/pickPhotos';
import type { PickedMedia } from '../../lib/media/types';
import { useComposerBottomInset } from '../../lib/useComposerBottomInset';
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
  /** Grouped photo send (1..5). */
  onSendPhotos: (photos: { uri: string }[], caption?: string) => { ok: boolean; error?: string };
  onAttachmentError?: (message: string) => void;
  onOpenPoll?: () => void;
}

/**
 * Chat composer — WhatsApp interaction structure, We Glue identity.
 * `+` attachment button on the left, a rounded typing capsule in the middle,
 * a teal send action on the right once there is text. No microphone. Camera
 * lives only inside the `+` menu. Poll (group chats) also lives in the `+` menu.
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
  onSendPhotos,
  onAttachmentError,
  onOpenPoll,
}: Props) {
  const [text, setText] = useState('');
  const [attachOpen, setAttachOpen] = useState(false);
  const [trayPhotos, setTrayPhotos] = useState<PickedMedia[]>([]);
  const [trayOpen, setTrayOpen] = useState(false);
  const inputRef = useRef<TextInput>(null);
  // Keeps the composer off the home indicator when the keyboard is closed and
  // off the keyboard when it is open. The bar is opaque, so this padding is
  // painted in the chat surface colour rather than exposing anything behind.
  const bottomInset = useComposerBottomInset();

  const effectiveCanPost = canPost !== undefined ? canPost : isRestricted ? isOfficer : true;
  const isGroup = mode === 'group';
  const hasText = text.trim().length > 0;

  if (!effectiveCanPost) {
    return (
      <View style={[styles.restrictedBanner, { paddingBottom: 14 + bottomInset }]}>
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

  async function handlePickPhotos() {
    setAttachOpen(false);
    const picked = await pickPhotos(5);
    if (picked.length === 0) return;
    // A carousel is images-only. A lone video goes straight to the existing
    // single-attachment send; a mixed selection keeps just the images.
    const images = picked.filter((p) => p.kind === 'image');
    if (images.length === 0 && picked[0]?.kind === 'video') {
      const v = picked[0];
      const res = onSendAttachment({
        localUri: v.uri,
        kind: 'video',
        name: v.fileName,
        size: v.fileSize,
        mime: v.mimeType,
      });
      if (!res.ok && res.error) onAttachmentError?.(res.error);
      return;
    }
    if (images.length < picked.length) {
      onAttachmentError?.('A photo carousel can only contain images. The video was left out.');
    }
    setTrayPhotos(images);
    setTrayOpen(true);
  }

  function handleSendPhotos() {
    const res = onSendPhotos(trayPhotos.map((p) => ({ uri: p.uri })));
    setTrayOpen(false);
    setTrayPhotos([]);
    if (!res.ok && res.error) onAttachmentError?.(res.error);
  }

  return (
    <>
      <View style={[styles.bar, { paddingBottom: 10 + bottomInset }]}>
        <TouchableOpacity
          style={styles.plusBtn}
          onPress={() => setAttachOpen(true)}
          disabled={disabled}
          accessibilityLabel="Add attachment"
        >
          <Ionicons name="add" size={24} color={chatColors.teal} />
        </TouchableOpacity>

        <View style={styles.capsule}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder="Message"
            placeholderTextColor={chatColors.textMuted}
            value={text}
            onChangeText={setText}
            multiline
            maxLength={2000}
            editable={!disabled}
          />
        </View>

        {hasText ? (
          <TouchableOpacity
            style={styles.sendBtn}
            onPress={handleSend}
            disabled={disabled}
            accessibilityLabel="Send message"
          >
            <Ionicons name="arrow-up" size={20} color={chatColors.white} />
          </TouchableOpacity>
        ) : null}
      </View>

      <AttachmentSheet
        visible={attachOpen}
        isGroup={isGroup}
        onClose={() => setAttachOpen(false)}
        onPicked={(draft) => {
          setAttachOpen(false);
          const res = onSendAttachment(draft);
          if (!res.ok && res.error) onAttachmentError?.(res.error);
        }}
        onPickPhotos={handlePickPhotos}
        onPoll={onOpenPoll ? () => { setAttachOpen(false); onOpenPoll(); } : undefined}
        onError={(message) => onAttachmentError?.(message)}
      />

      <PhotoTrayModal
        visible={trayOpen}
        photos={trayPhotos}
        onChange={setTrayPhotos}
        onCancel={() => { setTrayOpen(false); setTrayPhotos([]); }}
        onConfirm={handleSendPhotos}
        onAddMore={async () => {
          const more = await pickPhotos(5 - trayPhotos.length);
          if (more.length) setTrayPhotos((prev) => [...prev, ...more].slice(0, 5));
        }}
        confirmLabel="Send"
        aspectRatio={1}
      />
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    minHeight: chatSizes.inputBarHeight,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    backgroundColor: chatColors.bg,
  },
  plusBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  capsule: {
    flex: 1,
    minHeight: 38,
    justifyContent: 'center',
    backgroundColor: chatColors.composerCapsule,
    borderRadius: chatSizes.composerCapsuleRadius,
    paddingHorizontal: 14,
    paddingVertical: 6,
    ...chatShadow,
  },
  input: {
    fontFamily: chatFonts.regular,
    fontSize: 15,
    color: chatColors.text,
    maxHeight: 110,
    padding: 0,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: chatColors.teal,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
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
