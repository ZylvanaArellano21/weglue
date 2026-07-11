import { View, Text, TouchableOpacity, Modal, Pressable, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import type { AttachmentDraft } from '../../hooks/useConversation';
import { MAX_FILE_BYTES } from '../../lib/chatAttachments';
import { chatColors, chatFonts, chatShadow, chatTypography } from './chatTheme';

interface Props {
  visible: boolean;
  onClose: () => void;
  onPicked: (draft: AttachmentDraft) => void;
  onError: (message: string) => void;
}

/**
 * We Glue attachment bottom sheet: Camera · Photo Library · Files.
 * (No Link option — links are pasted straight into the message field.)
 * Shared by all four conversation types.
 */
export function AttachmentSheet({ visible, onClose, onPicked, onError }: Props) {
  async function pickCamera() {
    onClose();
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
    onClose();
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
    onClose();
    let result: DocumentPicker.DocumentPickerResult;
    try {
      // '*/*' lets iOS browse Files / iCloud Drive / On My iPhone / providers
      // and Android its document provider. copyToCacheDirectory gives us a
      // stable file:// uri to upload from.
      result = await DocumentPicker.getDocumentAsync({
        multiple: false,
        copyToCacheDirectory: true,
        type: '*/*',
      });
    } catch {
      // Genuine failure to present the picker (never fires on a normal cancel).
      onError('Could not open the file picker. Please try again.');
      return;
    }
    // Cancelling quietly closes — not an error.
    if (result.canceled || !result.assets?.[0]) return;
    const a = result.assets[0];
    if (a.size != null && a.size > MAX_FILE_BYTES) {
      onError('This file is larger than 25 MB. Choose a smaller file and try again.');
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
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />

          <TouchableOpacity style={styles.row} onPress={pickCamera} activeOpacity={0.7}>
            <View style={styles.iconWrap}>
              <Ionicons name="camera-outline" size={22} color={chatColors.teal} />
            </View>
            <Text style={styles.rowLabel}>Camera</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.row} onPress={pickLibrary} activeOpacity={0.7}>
            <View style={styles.iconWrap}>
              <Ionicons name="images-outline" size={22} color={chatColors.teal} />
            </View>
            <Text style={styles.rowLabel}>Photo Library</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.row} onPress={pickFile} activeOpacity={0.7}>
            <View style={styles.iconWrap}>
              <Ionicons name="document-outline" size={22} color={chatColors.teal} />
            </View>
            <Text style={styles.rowLabel}>Files</Text>
          </TouchableOpacity>

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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 22,
    paddingVertical: 15,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(15,166,166,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {
    ...chatTypography.infoRow,
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
