import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  ScrollView,
  Switch,
  Alert,
  ActivityIndicator,
  StyleSheet,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { chatColors, chatFonts, chatShadow, chatTypography } from './chatTheme';

export interface SendPollPayload {
  question: string;
  options: string[];
  allowMultiple: boolean;
  startAt?: string;
  endAt?: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onSubmit: (payload: SendPollPayload) => Promise<void>;
}

function formatDateInput(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

export function PollSheet({ visible, onClose, onSubmit }: Props) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '', '']);
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setQuestion('');
    setOptions(['', '', '']);
    setAllowMultiple(false);
    setStartDate('');
    setStartTime('');
    setEndDate('');
    setEndTime('');
  }

  async function handleSubmit() {
    if (!question.trim()) {
      Alert.alert('Add a question');
      return;
    }
    const opts = options.map((o) => o.trim()).filter(Boolean);
    if (opts.length < 2) {
      Alert.alert('Add at least 2 options');
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        question: question.trim(),
        options: opts,
        allowMultiple,
        startAt: startDate.trim() || undefined,
        endAt: endDate.trim() || undefined,
      });
      reset();
      onClose();
    } catch {
      Alert.alert('Failed to send poll. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={chatColors.text} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Poll</Text>
            <TouchableOpacity
              style={[styles.sendBtn, submitting && styles.sendBtnDisabled]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator size="small" color={chatColors.cream} />
              ) : (
                <Text style={styles.sendLabel}>Send</Text>
              )}
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            <Text style={styles.label}>Ask a question</Text>
            <TextInput
              style={styles.questionInput}
              placeholder=""
              value={question}
              onChangeText={setQuestion}
              multiline
              maxLength={200}
            />

            <Text style={styles.label}>Poll options</Text>
            {options.map((opt, idx) => (
              <TextInput
                key={idx}
                style={styles.optionInput}
                placeholder=""
                value={opt}
                onChangeText={(t) => {
                  const next = [...options];
                  next[idx] = t;
                  setOptions(next);
                }}
                maxLength={100}
              />
            ))}
            {options.length < 8 && (
              <TouchableOpacity
                style={styles.addOptionRow}
                onPress={() => setOptions([...options, ''])}
              >
                <Text style={styles.addOptionText}>Add option</Text>
              </TouchableOpacity>
            )}

            <View style={styles.toggleRow}>
              <Text style={styles.label}>Allow multiple answers</Text>
              <Switch
                value={allowMultiple}
                onValueChange={setAllowMultiple}
                trackColor={{ true: chatColors.teal, false: chatColors.border }}
                thumbColor={chatColors.white}
              />
            </View>

            <Text style={styles.label}>Duration</Text>
            <View style={styles.durationRow}>
              <Text style={styles.durationLabel}>Start</Text>
              <View style={styles.dateTimeGroup}>
                <TextInput
                  style={styles.dateInput}
                  placeholder="MM/D/Y"
                  placeholderTextColor={chatColors.text}
                  value={startDate}
                  onChangeText={setStartDate}
                />
                <TextInput
                  style={styles.timeInput}
                  placeholder=":"
                  placeholderTextColor={chatColors.text}
                  value={startTime}
                  onChangeText={setStartTime}
                />
              </View>
            </View>
            <View style={styles.durationRow}>
              <Text style={styles.durationLabel}>End</Text>
              <View style={styles.dateTimeGroup}>
                <TextInput
                  style={styles.dateInput}
                  placeholder="MM/D/Y"
                  placeholderTextColor={chatColors.text}
                  value={endDate}
                  onChangeText={setEndDate}
                />
                <TextInput
                  style={styles.timeInput}
                  placeholder=":"
                  placeholderTextColor={chatColors.text}
                  value={endTime}
                  onChangeText={setEndTime}
                />
              </View>
            </View>
          </ScrollView>
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
    backgroundColor: chatColors.pollSheet,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: '82%',
    ...chatShadow,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: chatColors.textMuted,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: chatColors.borderSearch,
  },
  headerTitle: {
    ...chatTypography.chatTitle,
    fontSize: 20,
  },
  sendBtn: {
    backgroundColor: chatColors.teal,
    borderRadius: 40,
    paddingHorizontal: 16,
    paddingVertical: 6,
    minWidth: 63,
    alignItems: 'center',
    ...chatShadow,
  },
  sendBtnDisabled: { opacity: 0.6 },
  sendLabel: {
    fontFamily: chatFonts.semiBold,
    fontSize: 12,
    color: chatColors.cream,
    letterSpacing: 0.38,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
    gap: 10,
  },
  label: {
    fontFamily: chatFonts.semiBold,
    fontSize: 15,
    color: chatColors.text,
    letterSpacing: 0.38,
    marginTop: 4,
  },
  questionInput: {
    backgroundColor: chatColors.pollSheet,
    borderRadius: 40,
    minHeight: 60,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: chatFonts.regular,
    fontSize: 15,
    color: chatColors.text,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  optionInput: {
    backgroundColor: chatColors.pollSheet,
    borderRadius: 40,
    minHeight: 60,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: chatFonts.regular,
    fontSize: 15,
    color: chatColors.text,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  addOptionRow: {
    paddingVertical: 8,
  },
  addOptionText: {
    fontFamily: chatFonts.regular,
    fontSize: 12,
    fontStyle: 'italic',
    color: chatColors.text,
    letterSpacing: 0.38,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  durationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  durationLabel: {
    fontFamily: chatFonts.semiBold,
    fontSize: 15,
    color: chatColors.text,
    width: 48,
  },
  dateTimeGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
  },
  dateInput: {
    backgroundColor: chatColors.pollSheet,
    borderTopLeftRadius: 40,
    borderBottomLeftRadius: 40,
    height: 31,
    width: 82,
    paddingHorizontal: 10,
    fontFamily: chatFonts.regular,
    fontSize: 15,
    fontStyle: 'italic',
    color: chatColors.text,
    textAlign: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  timeInput: {
    backgroundColor: chatColors.pollSheet,
    borderTopRightRadius: 40,
    borderBottomRightRadius: 40,
    height: 31,
    width: 82,
    paddingHorizontal: 10,
    fontFamily: chatFonts.medium,
    fontSize: 15,
    color: chatColors.text,
    textAlign: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
});
