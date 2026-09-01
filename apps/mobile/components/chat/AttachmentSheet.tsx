import { useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { pickMedia, useWeGlueMediaFlow } from '../../lib/media/pickMedia';
import type { AttachmentDraft } from '../../hooks/useConversation';
import {
  MAX_FILE_BYTES,
  isSupportedDocument,
  UNSUPPORTED_DOC_MESSAGE,
} from '../../lib/chatAttachments';
import { chatColors, chatFonts, chatShadow } from './chatTheme';

interface Props {
  visible: boolean;
  /** Group chats also offer Poll; single chats do not. */
  isGroup?: boolean;
  onClose: () => void;
  onPicked: (draft: AttachmentDraft) => void;
  /** Present only for group chats. */
  onPoll?: () => void;
  onError: (message: string) => void;
}

/**
 * We Glue attachment sheet — WhatsApp structure, We Glue identity.
 * Group chats: Camera · Photos · Documents · Poll.
 * Single chats: Camera · Photos · Documents.
 * (No Link option — links are pasted straight into the message field.)
 */
export function AttachmentSheet({ visible, isGroup = false, onClose, onPicked, onPoll, onError }: Props) {
  // ─── Why pickers are deferred until the sheet is really gone ───────────────
  //
  // This sheet is a react-native <Modal>, which on iOS is a real
  // UIViewController presented over the app. expo-document-picker presents its
  // UIDocumentPickerViewController from `currentViewController()` — i.e. the
  // TOPMOST one, which is this sheet.
  //
  // The old code called onClose() and then immediately awaited
  // getDocumentAsync(). onClose() only *starts* the modal's animated dismissal,
  // so the picker was asked to present from a view controller that was already
  // being dismissed. UIKit silently refuses: the picker never appears and its
  // promise never settles. Worse, the native module had already stored its
  // `pickingContext`, and it only clears that in the delegate callbacks — which
  // now never fire. So `pickingContext` stays non-nil forever and EVERY later
  // tap on Files throws PickingInProgressException. That is the "Files does
  // nothing, then the app breaks" report.
  //
  // Fix: never present a picker in the same tick as the dismissal. Park the
  // action and run it only once the modal is genuinely gone — on iOS that is
  // Modal's onDismiss (fired after the dismissal animation completes). Android
  // pickers are Intent-based and have no presenting-VC to race, so they run as
  // soon as the sheet closes.
  //
  // All three rows go through this path, not just Files: Camera and Photo
  // Library present view controllers the same way and were racing the same
  // dismissal.
  const pendingAction = useRef<(() => Promise<void>) | null>(null);
  const busy = useRef(false);

  const flushPending = useCallback(() => {
    const action = pendingAction.current;
    pendingAction.current = null;
    if (!action) return;
    void action().finally(() => {
      busy.current = false;
    });
  }, []);

  /** Closes the sheet, then runs `action` once it is fully dismissed. */
  const runAfterDismiss = useCallback(
    (action: () => Promise<void>) => {
      // Re-entrancy guard: a double tap must not queue two pickers.
      if (busy.current) return;
      busy.current = true;
      pendingAction.current = action;
      onClose();
      if (Platform.OS !== 'ios') {
        // Android: no presenting view controller to race.
        flushPending();
      }
      // iOS: flushed by <Modal onDismiss>.
    },
    [onClose, flushPending],
  );

  async function pickCamera() {
    // Android: shared We Glue camera + confirm preview. Use Photo hands the
    // confirmed image straight to the existing optimistic-send pipeline via
    // onPicked, so nothing sends merely because the shutter was tapped.
    if (useWeGlueMediaFlow) {
      const picked = await pickMedia({ source: 'camera', quality: 0.85 });
      if (!picked) return;
      onPicked({
        localUri: picked.uri,
        kind: 'image',
        name: picked.fileName,
        size: picked.fileSize,
        mime: picked.mimeType,
      });
      return;
    }
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Camera access needed',
        'To take a picture, allow camera access for We Glue in Settings.',
      );
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.85 });
    if (result.canceled || !result.assets[0]) return;
    const a = result.assets[0];
    onPicked({
      localUri: a.uri,
      kind: 'image',
      name: a.fileName ?? 'photo.jpg',
      size: a.fileSize ?? null,
      mime: a.mimeType ?? 'image/jpeg',
    });
  }

  async function pickLibrary() {
    // Android: official system photo picker (allows video) + a We Glue confirm
    // preview for images. Video keeps its existing path (no preview) so video
    // sending is unchanged.
    if (useWeGlueMediaFlow) {
      const picked = await pickMedia({ source: 'library', quality: 0.85, allowVideo: true });
      if (!picked) return;
      onPicked({
        localUri: picked.uri,
        kind: picked.kind,
        name: picked.fileName,
        size: picked.fileSize,
        mime: picked.mimeType,
      });
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Photo library access needed',
        'To share photos and videos, allow photo access for We Glue in Settings.',
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 0.85,
      videoMaxDuration: 120,
    });
    if (result.canceled || !result.assets[0]) return;
    const a = result.assets[0];
    const isVideo = a.type === 'video';
    onPicked({
      localUri: a.uri,
      kind: isVideo ? 'video' : 'image',
      name: a.fileName ?? (isVideo ? 'video.mp4' : 'photo.jpg'),
      size: a.fileSize ?? null,
      mime: a.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg'),
    });
  }

  async function pickFile() {
    let result: DocumentPicker.DocumentPickerResult;
    try {
      // '*/*' lets iOS browse Files / iCloud Drive / On My iPhone / providers
      // and Android its document provider (Drive, Downloads, local storage).
      // copyToCacheDirectory copies the selection into our own cache and hands
      // back a stable file:// uri — without it Android returns a content:// uri
      // backed by a provider we may lose permission to read, and iOS returns a
      // security-scoped url that goes stale.
      result = await DocumentPicker.getDocumentAsync({
        multiple: false,
        copyToCacheDirectory: true,
        type: '*/*',
      });
    } catch {
      // A genuine failure to present the picker. Never fires on a normal
      // cancel — cancellation resolves with { canceled: true }.
      onError('Could not open the file picker. Please try again.');
      return;
    }

    // Cancelling quietly closes — that is not an error.
    if (result.canceled || !result.assets?.[0]) return;

    const a = result.assets[0];

    // Reject types Storage would reject anyway. Without this the upload fails
    // with an opaque error and Retry can never succeed, because retrying does
    // not change the file's type.
    if (!isSupportedDocument(a.mimeType, a.name)) {
      onError(UNSUPPORTED_DOC_MESSAGE);
      return;
    }
    if (a.size != null && a.size > MAX_FILE_BYTES) {
      onError('This file is larger than 25 MB. Choose a smaller file and try again.');
      return;
    }
    // A 0-byte result means the provider (Drive, a cloud file, a removed SD
    // card) could not actually give us the contents. Uploading it would create
    // an empty, unopenable attachment.
    if (a.size === 0) {
      onError("This file is empty or couldn't be read. Try choosing it again.");
      return;
    }

    onPicked({
      localUri: a.uri,
      kind: 'file',
      name: a.name,
      size: a.size ?? null,
      mime: a.mimeType ?? 'application/octet-stream',
    });
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      // iOS only: fires once the sheet's view controller is fully dismissed, so
      // the picker presents from a stable top view controller instead of one
      // that is mid-dismissal.
      onDismiss={flushPending}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />

          <View style={styles.grid}>
            <TouchableOpacity
              style={styles.tile}
              onPress={() => runAfterDismiss(pickCamera)}
              activeOpacity={0.7}
            >
              <View style={styles.iconWrap}>
                <Ionicons name="camera" size={24} color={chatColors.teal} />
              </View>
              <Text style={styles.tileLabel}>Camera</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.tile}
              onPress={() => runAfterDismiss(pickLibrary)}
              activeOpacity={0.7}
            >
              <View style={styles.iconWrap}>
                <Ionicons name="images" size={24} color={chatColors.teal} />
              </View>
              <Text style={styles.tileLabel}>Photos</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.tile}
              onPress={() => runAfterDismiss(pickFile)}
              activeOpacity={0.7}
            >
              <View style={styles.iconWrap}>
                <Ionicons name="document-text" size={24} color={chatColors.teal} />
              </View>
              <Text style={styles.tileLabel}>Documents</Text>
            </TouchableOpacity>

            {isGroup && onPoll ? (
              <TouchableOpacity style={styles.tile} onPress={onPoll} activeOpacity={0.7}>
                <View style={styles.iconWrap}>
                  <Ionicons name="stats-chart" size={24} color={chatColors.teal} />
                </View>
                <Text style={styles.tileLabel}>Poll</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          <TouchableOpacity style={styles.cancelRow} onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.cancelLabel}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  tile: {
    width: '25%',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 8,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(15,166,166,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: {
    fontFamily: chatFonts.medium,
    fontSize: 12,
    color: chatColors.text,
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
});
