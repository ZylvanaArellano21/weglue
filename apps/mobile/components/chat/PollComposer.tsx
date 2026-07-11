import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  ScrollView,
  Switch,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { chatColors, chatFonts, chatShadow, chatTypography } from './chatTheme';

// Explicit shadow usable in TextStyle contexts (chatShadow is typed ViewStyle,
// which TextInput style props reject).
const inputShadow = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.25,
  shadowRadius: 4,
  elevation: 4,
} as const;

export interface PollComposerPayload {
  question: string;
  options: string[];
  allowMultiple: boolean;
  startAt?: string; // ISO
  endAt?: string;   // ISO
}

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Resolves when the poll is accepted by the server; rejects on failure —
   * entered data is preserved either way until success. */
  onSubmit: (payload: PollComposerPayload) => Promise<void>;
}

/**
 * Full-screen keyboard-safe poll composer (replaces the old half-height
 * sheet whose fields the keyboard covered). Native date-time pickers replace
 * the old free-text MM/D/Y fields that produced unparseable timestamps.
 */
export function PollComposer({ visible, onClose, onSubmit }: Props) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [startAt, setStartAt] = useState<Date | null>(null);
  const [endAt, setEndAt] = useState<Date | null>(null);
  const [picker, setPicker] = useState<null | { field: 'start' | 'end'; mode: 'date' | 'time' }>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setQuestion('');
    setOptions(['', '']);
    setAllowMultiple(false);
    setStartAt(null);
    setEndAt(null);
    setError(null);
  }

  function validate(): string | null {
    if (!question.trim()) return 'Add a question.';
    const opts = options.map((o) => o.trim()).filter(Boolean);
    if (opts.length < 2) return 'Add at least 2 options.';
    // Blank start+end = poll starts now, never expires (matches helper text).
    // 60s grace so "now" isn't rejected as past.
    if (startAt && startAt.getTime() < Date.now() - 60_000) return "Start can't be in the past.";
    if (endAt && !startAt && endAt.getTime() <= Date.now()) return 'End must be in the future.';
    if (startAt && endAt && endAt <= startAt) return 'End must be after start.';
    return null;
  }

  async function handleSend() {
    if (submitting) return;
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({
        question: question.trim(),
        options: options.map((o) => o.trim()).filter(Boolean),
        allowMultiple,
        startAt: startAt?.toISOString(),
        endAt: endAt?.toISOString(),
      });
      reset();
      onClose();
    } catch (e: any) {
      // Preserve everything the user typed; offer retry via the same button.
      setError(e?.message ? `Could not send the poll: ${e.message}` : 'Could not send the poll. Tap Send to try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function fmtDate(d: Date | null): string {
    return d
      ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : 'Date';
  }
  function fmtTime(d: Date | null): string {
    return d
      ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : 'Time';
  }

  function onPickerChange(_event: any, selected?: Date) {
    const p = picker;
    if (Platform.OS === 'android') setPicker(null);
    if (!selected || !p) return;
    const base = p.field === 'start' ? startAt : endAt;
    const next = new Date(base ?? new Date());
    if (p.mode === 'date') {
      next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
    } else {
      next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
    }
    if (p.field === 'start') setStartAt(next);
    else setEndAt(next);
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={8} accessibilityLabel="Close poll composer">
            <Ionicons name="close" size={24} color={chatColors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Poll</Text>
          <TouchableOpacity
            style={[styles.sendBtn, submitting && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={chatColors.cream} />
            ) : (
              <Text style={styles.sendLabel}>Send</Text>
            )}
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {error && (
              <View style={styles.errorBanner}>
                <Ionicons name="alert-circle" size={16} color="#C62828" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Text style={styles.label}>Ask a question</Text>
            <TextInput
              style={styles.questionInput}
              value={question}
              onChangeText={setQuestion}
              multiline
              maxLength={200}
              placeholder="What do you want to ask?"
              placeholderTextColor={chatColors.textMuted}
            />

            <Text style={styles.label}>Poll options</Text>
            {options.map((opt, idx) => (
              <View key={idx} style={styles.optionRow}>
                <TextInput
                  style={styles.optionInput}
                  value={opt}
                  placeholder={`Option ${idx + 1}`}
                  placeholderTextColor={chatColors.textMuted}
                  onChangeText={(t) => {
                    const next = [...options];
                    next[idx] = t;
                    setOptions(next);
                  }}
                  maxLength={100}
                />
                {options.length > 2 && (
                  <TouchableOpacity
                    onPress={() => setOptions(options.filter((_, i) => i !== idx))}
                    hitSlop={8}
                    style={styles.removeOption}
                    accessibilityLabel={`Remove option ${idx + 1}`}
                  >
                    <Ionicons name="close-circle" size={20} color={chatColors.textMuted} />
                  </TouchableOpacity>
                )}
              </View>
            ))}
            {options.length < 8 && (
              <TouchableOpacity style={styles.addOptionRow} onPress={() => setOptions([...options, ''])}>
                <Ionicons name="add" size={16} color={chatColors.teal} />
                <Text style={styles.addOptionText}>Add option</Text>
              </TouchableOpacity>
            )}

            <View style={styles.toggleRow}>
              <Text style={styles.label}>Multiple options</Text>
              <Switch
                value={allowMultiple}
                onValueChange={setAllowMultiple}
                trackColor={{ true: chatColors.teal, false: chatColors.border }}
                thumbColor={chatColors.white}
              />
            </View>

            <Text style={styles.label}>Duration</Text>
            {(['start', 'end'] as const).map((field) => {
              const value = field === 'start' ? startAt : endAt;
              return (
                <View key={field} style={styles.durationRow}>
                  <Text style={styles.durationLabel}>{field === 'start' ? 'Start' : 'End'}</Text>
                  <View style={styles.dateTimeGroup}>
                    <TouchableOpacity
                      style={styles.dateChip}
                      onPress={() => setPicker({ field, mode: 'date' })}
                    >
                      <Text style={[styles.chipText, !value && styles.chipPlaceholder]}>{fmtDate(value)}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.timeChip}
                      onPress={() => setPicker({ field, mode: 'time' })}
                    >
                      <Text style={[styles.chipText, !value && styles.chipPlaceholder]}>{fmtTime(value)}</Text>
                    </TouchableOpacity>
                    {value && (
                      <TouchableOpacity
                        onPress={() => (field === 'start' ? setStartAt(null) : setEndAt(null))}
                        hitSlop={8}
                        style={styles.clearChip}
                      >
                        <Ionicons name="close-circle" size={18} color={chatColors.textMuted} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}
            <Text style={styles.durationHint}>
              Leave empty to start the poll now with no end time.
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>

        {picker && (
          <View style={Platform.OS === 'ios' ? styles.iosPickerWrap : undefined}>
            {Platform.OS === 'ios' && (
              <View style={styles.iosPickerHeader}>
                <TouchableOpacity onPress={() => setPicker(null)}>
                  <Text style={styles.iosPickerDone}>Done</Text>
                </TouchableOpacity>
              </View>
            )}
            <DateTimePicker
              value={(picker.field === 'start' ? startAt : endAt) ?? new Date()}
              mode={picker.mode}
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              // Never let the wheel land on a past instant: start ≥ now, end ≥
              // start (or now). Date mode only meaningfully bounds the day.
              minimumDate={picker.field === 'end' ? startAt ?? new Date() : new Date()}
              onChange={onPickerChange}
            />
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: chatColors.pollSheet },
  flex: { flex: 1 },
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
    paddingBottom: 48,
    gap: 10,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(198,40,40,0.08)',
    borderRadius: 12,
    padding: 10,
  },
  errorText: {
    fontFamily: chatFonts.regular,
    fontSize: 12,
    color: '#C62828',
    flex: 1,
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
    ...inputShadow,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  optionInput: {
    flex: 1,
    backgroundColor: chatColors.pollSheet,
    borderRadius: 40,
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: chatFonts.regular,
    fontSize: 15,
    color: chatColors.text,
    ...inputShadow,
  },
  removeOption: {
    marginLeft: 8,
  },
  addOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
  },
  addOptionText: {
    fontFamily: chatFonts.semiBold,
    fontSize: 13,
    color: chatColors.teal,
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
  },
  dateChip: {
    backgroundColor: chatColors.pollSheet,
    borderTopLeftRadius: 40,
    borderBottomLeftRadius: 40,
    height: 34,
    minWidth: 90,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    ...chatShadow,
  },
  timeChip: {
    backgroundColor: chatColors.pollSheet,
    borderTopRightRadius: 40,
    borderBottomRightRadius: 40,
    height: 34,
    minWidth: 82,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    ...chatShadow,
  },
  clearChip: {
    marginLeft: 8,
  },
  chipText: {
    fontFamily: chatFonts.medium,
    fontSize: 13,
    color: chatColors.text,
  },
  chipPlaceholder: {
    fontStyle: 'italic',
    color: chatColors.textMuted,
  },
  durationHint: {
    fontFamily: chatFonts.regular,
    fontSize: 11,
    color: chatColors.textMuted,
    fontStyle: 'italic',
  },
  iosPickerWrap: {
    backgroundColor: chatColors.bg,
    borderTopWidth: 1,
    borderTopColor: chatColors.border,
  },
  iosPickerHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  iosPickerDone: {
    fontFamily: chatFonts.semiBold,
    fontSize: 14,
    color: chatColors.teal,
  },
});
