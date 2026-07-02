import { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { PollSheet, type SendPollPayload } from './PollSheet';
import { chatColors, chatFonts, chatShadow, chatSizes, chatTypography } from './chatTheme';

interface SendPayload {
  content: string;
  attachmentUrl?: string;
  attachmentType?: 'image' | 'file';
}

interface Props {
  mode?: 'group' | 'direct';
  isRestricted?: boolean;
  isOfficer?: boolean;
  disabled?: boolean;
  onSend: (payload: SendPayload) => Promise<void>;
  onSendPoll?: (payload: SendPollPayload) => Promise<void>;
}

/**
 * Chat input bar — NO microphone icon (store compliance).
 * Group: clip + poll (officers) + image. Direct: clip + image only.
 */
export function ChatInput({
  mode = 'group',
  isRestricted = false,
  isOfficer = false,
  disabled = false,
  onSend,
  onSendPoll,
}: Props) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [pollVisible, setPollVisible] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const canPost = isRestricted ? isOfficer : true;
  const showPoll = mode === 'group' && !!onSendPoll;

  if (!canPost) {
    return (
      <View style={styles.restrictedBanner}>
        <Ionicons name="megaphone-outline" size={16} color={chatColors.textMuted} />
        <Text style={styles.restrictedText}>Officers only</Text>
      </View>
    );
  }

  async function handleSend(content?: string) {
    const trimmed = (content ?? text).trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await onSend({ content: trimmed });
      setText('');
    } catch {
      Alert.alert('Failed to send message');
    } finally {
      setSending(false);
    }
  }

  async function handlePickImage(source: 'camera' | 'library') {
    const perm =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!perm.granted) {
      Alert.alert(
        `${source === 'camera' ? 'Camera' : 'Photo library'} access needed`,
        'Please enable access in Settings.',
      );
      return;
    }

    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.8 });

    if (!result.canceled && result.assets[0]) {
      setSending(true);
      try {
        await onSend({
          content: '',
          attachmentUrl: result.assets[0].uri,
          attachmentType: 'image',
        });
      } catch {
        Alert.alert('Failed to send image');
      } finally {
        setSending(false);
      }
    }
  }

  function showAttachMenu() {
    Alert.alert('Attach', 'Choose source', [
      { text: 'Camera', onPress: () => handlePickImage('camera') },
      { text: 'Photo Library', onPress: () => handlePickImage('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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
          editable={!disabled && !sending}
          onSubmitEditing={() => handleSend()}
          blurOnSubmit={false}
        />

        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={showAttachMenu}
            disabled={disabled || sending}
            accessibilityLabel="Attach file"
          >
            <Ionicons name="attach" size={20} color={chatColors.text} />
          </TouchableOpacity>

          {showPoll && (
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => setPollVisible(true)}
              disabled={disabled || sending}
              accessibilityLabel="Create poll"
            >
              <Ionicons name="list" size={20} color={chatColors.text} />
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => handlePickImage('library')}
            disabled={disabled || sending}
            accessibilityLabel="Send image"
          >
            <Ionicons name="image-outline" size={20} color={chatColors.text} />
          </TouchableOpacity>

          {sending && <ActivityIndicator size="small" color={chatColors.teal} />}
        </View>
      </View>

      {showPoll && (
        <PollSheet
          visible={pollVisible}
          onClose={() => setPollVisible(false)}
          onSubmit={async (payload) => {
            await onSendPoll!(payload);
          }}
        />
      )}
    </KeyboardAvoidingView>
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
    fontSize: 12,
    fontStyle: 'italic',
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
