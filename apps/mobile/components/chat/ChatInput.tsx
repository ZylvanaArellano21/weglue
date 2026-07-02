import { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
  Modal,
  ScrollView,
  Switch,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PollDraft {
  question: string;
  options: string[];
  allowMultiple: boolean;
  startDate: string;
  endDate: string;
}

interface SendPayload {
  content: string;
  attachmentUrl?: string;
  attachmentType?: 'image' | 'file';
}

interface SendPollPayload {
  question: string;
  options: string[];
  allowMultiple: boolean;
  startAt?: string;
  endAt?: string;
}

interface Props {
  /** Whether this input is restricted (e.g. announcements channel — officers only). */
  isRestricted?: boolean;
  isOfficer?: boolean;
  disabled?: boolean;
  onSend: (payload: SendPayload) => Promise<void>;
  onSendPoll?: (payload: SendPollPayload) => Promise<void>;
}

function formatDateInput(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

// ─── Poll creation sheet ──────────────────────────────────────────────────────

function PollSheet({
  visible,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (payload: SendPollPayload) => Promise<void>;
}) {
  const [draft, setDraft] = useState<PollDraft>({
    question: '',
    options: ['', ''],
    allowMultiple: false,
    startDate: formatDateInput(new Date()),
    endDate: formatDateInput(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
  });
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!draft.question.trim()) { Alert.alert('Add a question'); return; }
    const opts = draft.options.filter((o) => o.trim());
    if (opts.length < 2) { Alert.alert('Add at least 2 options'); return; }

    setSubmitting(true);
    try {
      await onSubmit({
        question: draft.question.trim(),
        options: opts,
        allowMultiple: draft.allowMultiple,
        startAt: draft.startDate || undefined,
        endAt: draft.endDate || undefined,
      });
      onClose();
      setDraft({
        question: '',
        options: ['', ''],
        allowMultiple: false,
        startDate: formatDateInput(new Date()),
        endDate: formatDateInput(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
      });
    } catch {
      Alert.alert('Failed to send poll. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={pollStyles.overlay}>
        <View style={pollStyles.sheet}>
          <View style={pollStyles.handle} />
          <Text style={pollStyles.sheetTitle}>Create Poll</Text>

          <ScrollView showsVerticalScrollIndicator={false}>
            <TextInput
              style={pollStyles.questionInput}
              placeholder="Ask a question…"
              placeholderTextColor="#9CA3AF"
              value={draft.question}
              onChangeText={(t) => setDraft((d) => ({ ...d, question: t }))}
              multiline
            />

            {draft.options.map((opt, idx) => (
              <View key={idx} style={pollStyles.optionRow}>
                <TextInput
                  style={pollStyles.optionInput}
                  placeholder={`Option ${idx + 1}`}
                  placeholderTextColor="#9CA3AF"
                  value={opt}
                  onChangeText={(t) => {
                    const next = [...draft.options];
                    next[idx] = t;
                    setDraft((d) => ({ ...d, options: next }));
                  }}
                />
                {draft.options.length > 2 && (
                  <TouchableOpacity
                    onPress={() =>
                      setDraft((d) => ({
                        ...d,
                        options: d.options.filter((_, i) => i !== idx),
                      }))
                    }
                  >
                    <Ionicons name="remove-circle" size={20} color="#EF4444" />
                  </TouchableOpacity>
                )}
              </View>
            ))}

            {draft.options.length < 8 && (
              <TouchableOpacity
                style={pollStyles.addOption}
                onPress={() =>
                  setDraft((d) => ({ ...d, options: [...d.options, ''] }))
                }
              >
                <Ionicons name="add-circle-outline" size={18} color="#0FA6A6" />
                <Text style={pollStyles.addOptionLabel}>Add option</Text>
              </TouchableOpacity>
            )}

            <View style={pollStyles.toggleRow}>
              <Text style={pollStyles.toggleLabel}>Allow multiple choices</Text>
              <Switch
                value={draft.allowMultiple}
                onValueChange={(v) => setDraft((d) => ({ ...d, allowMultiple: v }))}
                trackColor={{ true: '#0FA6A6' }}
              />
            </View>

            <TouchableOpacity
              style={[pollStyles.submitBtn, submitting && pollStyles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={pollStyles.submitLabel}>Send Poll</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={pollStyles.cancelBtn} onPress={onClose}>
              <Text style={pollStyles.cancelLabel}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Main input bar ───────────────────────────────────────────────────────────

/**
 * Chat input bar.
 * NO microphone. NO voice messages.
 * Supports: text, image picker, file (future), poll creation.
 */
export function ChatInput({
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

  if (!canPost) {
    return (
      <View style={styles.restrictedBanner}>
        <Ionicons name="megaphone-outline" size={16} color="#9CA3AF" />
        <Text style={styles.restrictedText}>Officers only</Text>
      </View>
    );
  }

  async function handleSend() {
    const trimmed = text.trim();
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

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.bar}>
        {/* Attach / Poll */}
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => Alert.alert('Attach', 'Choose source', [
            { text: 'Camera', onPress: () => handlePickImage('camera') },
            { text: 'Photo Library', onPress: () => handlePickImage('library') },
            ...(onSendPoll ? [{ text: 'Poll', onPress: () => setPollVisible(true) }] : []),
            { text: 'Cancel', style: 'cancel' },
          ])}
          disabled={disabled || sending}
        >
          <Ionicons name="attach" size={22} color="#6B7280" />
        </TouchableOpacity>

        <TextInput
          ref={inputRef}
          style={styles.input}
          placeholder="Message…"
          placeholderTextColor="#9CA3AF"
          value={text}
          onChangeText={setText}
          multiline
          maxLength={2000}
          editable={!disabled && !sending}
          returnKeyType="default"
        />

        <TouchableOpacity
          style={[styles.sendBtn, (!text.trim() || sending) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!text.trim() || sending || disabled}
        >
          {sending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="send" size={16} color="#fff" />
          )}
        </TouchableOpacity>
      </View>

      {onSendPoll && (
        <PollSheet
          visible={pollVisible}
          onClose={() => setPollVisible(false)}
          onSubmit={async (payload) => {
            await onSendPoll(payload);
          }}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#FEFCF0',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    gap: 8,
  },
  iconBtn: {
    padding: 6,
    marginBottom: 2,
  },
  input: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontFamily: 'Zain_400Regular',
    fontSize: 15,
    color: '#1A1A1A',
    maxHeight: 120,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#0FA6A6',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  sendBtnDisabled: {
    backgroundColor: '#D1D5DB',
  },
  restrictedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    backgroundColor: '#FEFCF0',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  restrictedText: {
    fontFamily: 'Zain_400Regular',
    fontSize: 14,
    color: '#9CA3AF',
  },
});

const pollStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: '#FEFCF0',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '80%',
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#D1D5DB',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitle: {
    fontFamily: 'Zain_700Bold',
    fontSize: 18,
    color: '#1A1A1A',
    marginBottom: 16,
    textAlign: 'center',
  },
  questionInput: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 14,
    fontFamily: 'Zain_400Regular',
    fontSize: 15,
    color: '#1A1A1A',
    marginBottom: 12,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  optionInput: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: 'Zain_400Regular',
    fontSize: 14,
    color: '#1A1A1A',
  },
  addOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    marginBottom: 8,
  },
  addOptionLabel: {
    fontFamily: 'Zain_400Regular',
    fontSize: 14,
    color: '#0FA6A6',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: 12,
  },
  toggleLabel: {
    fontFamily: 'Zain_400Regular',
    fontSize: 15,
    color: '#374151',
  },
  submitBtn: {
    backgroundColor: '#0FA6A6',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitLabel: {
    fontFamily: 'Zain_700Bold',
    fontSize: 15,
    color: '#fff',
  },
  cancelBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  cancelLabel: {
    fontFamily: 'Zain_400Regular',
    fontSize: 15,
    color: '#6B7280',
  },
});
