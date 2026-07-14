import { useCallback, useMemo, useRef, useState } from 'react';
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
  Keyboard,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

/** UI-only cap. There is no max-options constraint in the database (checked:
 *  poll_options / club_poll_options have none), so this is the single source of
 *  truth for the limit and is intentionally preserved from the previous build. */
const MAX_OPTIONS = 8;
const MIN_OPTIONS = 2;

/** iOS renders UISwitch noticeably larger than the design calls for (and larger
 *  still on recent iOS). A mild scale brings it back in proportion with the rest
 *  of the screen without swapping in a custom control; Android's switch is
 *  already correctly proportioned, so it is left at native size. The row keeps a
 *  44pt touch target regardless — the visual shrinks, the hit area does not. */
const SWITCH_SCALE = Platform.OS === 'ios' ? 0.85 : 1;

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
 * Full-screen poll composer.
 *
 * SAFE AREA — the header is padded from `useSafeAreaInsets()`, deliberately NOT
 * from <SafeAreaView>. This screen lives inside a React Native <Modal>, which
 * mounts into its own native view hierarchy; safe-area-context's <SafeAreaView>
 * is a *native* view that measures its own parent, and inside a Modal it lays
 * out at y=0 on the first frame before correcting itself (verified in-sim:
 * headerY=0 then headerY=62 with contextInsets.top=62 the whole time). On some
 * devices that correction is what the user actually ends up seeing — the ✕ and
 * Send sitting on top of the clock and the battery. The insets *hook* reads
 * React context, so it is right on the very first frame on every device.
 */
export function PollComposer({ visible, onClose, onSubmit }: Props) {
  const insets = useSafeAreaInsets();

  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [startAt, setStartAt] = useState<Date | null>(null);
  const [endAt, setEndAt] = useState<Date | null>(null);
  // `temp` is the picker's working value — the whole point of Bug 1. The old
  // code committed straight from onChange, so a user who opened the picker,
  // saw today's date sitting under the selection bar, and pressed Done WITHOUT
  // spinning the wheel saved nothing: the spinner only emits onChange when the
  // value actually changes. `temp` is seeded with exactly what the native picker
  // is showing, so Done always has something real to commit, moved or not.
  // `min` is captured at open time so the seed matches the picker's own clamping.
  const [picker, setPicker] = useState<null | {
    field: 'start' | 'end';
    mode: 'date' | 'time';
    temp: Date;
    min: Date;
  }>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  const optionRefs = useRef<(TextInput | null)[]>([]);
  // Swallows the second of two taps fired in the same instant, so a double-tap
  // on "Add option" adds exactly one option.
  const lastAddRef = useRef(0);

  function reset() {
    setQuestion('');
    setOptions(['', '']);
    setAllowMultiple(false);
    setStartAt(null);
    setEndAt(null);
    setError(null);
  }

  const filledOptions = useMemo(
    () => options.map((o) => o.trim()).filter(Boolean),
    [options],
  );

  // Send is disabled until the poll is structurally valid. Date problems are not
  // part of this (they are reported in the banner) so the user always has a way
  // to find out *why* a date was rejected instead of facing a dead button.
  const canSend = question.trim().length > 0 && filledOptions.length >= MIN_OPTIONS;

  function validate(): string | null {
    if (!question.trim()) return 'Add a question.';
    if (filledOptions.length < MIN_OPTIONS) return `Add at least ${MIN_OPTIONS} options.`;
    // Blank start+end = poll starts now, never expires (matches helper text).
    // 60s grace so "now" isn't rejected as past.
    if (startAt && startAt.getTime() < Date.now() - 60_000) return "Start can't be in the past.";
    if (endAt && !startAt && endAt.getTime() <= Date.now()) return 'End must be in the future.';
    if (startAt && endAt && endAt <= startAt) return 'End must be after start.';
    return null;
  }

  async function handleSend() {
    if (submitting) return; // no duplicate submissions
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
        options: filledOptions, // blank extra options never reach the server
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

  const addOption = useCallback(() => {
    const now = Date.now();
    if (now - lastAddRef.current < 350) return;
    lastAddRef.current = now;

    setOptions((prev) => {
      if (prev.length >= MAX_OPTIONS) return prev;
      const next = [...prev, ''];
      // Focusing the new field is what reveals it: RN scrolls a focused input
      // inside a ScrollView into view above the keyboard, so the new option can
      // never be added off-screen or underneath the keyboard.
      requestAnimationFrame(() => optionRefs.current[next.length - 1]?.focus());
      return next;
    });
  }, []);

  function removeOption(idx: number) {
    setOptions((prev) => prev.filter((_, i) => i !== idx));
    optionRefs.current.splice(idx, 1);
  }

  function openPicker(field: 'start' | 'end', mode: 'date' | 'time') {
    // Close the keyboard first, or the inline picker would come up behind it.
    Keyboard.dismiss();

    const existing = field === 'start' ? startAt : endAt;
    // Same bounds the picker itself enforces: start can't be in the past, and
    // end can't precede start.
    const min = field === 'end' ? (startAt ?? new Date()) : new Date();
    // Seed with what the picker will actually display: the saved value if there
    // is one, otherwise "now" pushed forward to the minimum (which is what the
    // native picker clamps to). This is the value Done commits when the user
    // never touches the wheel.
    const seed = existing ?? (Date.now() < min.getTime() ? new Date(min) : new Date());

    setPicker({ field, mode, temp: seed, min });
  }

  /** Folds a picker's working value into its field, touching only the component
   *  that was being edited — picking a Start time never disturbs the Start date,
   *  and never touches End at all (and vice versa). All dates stay local Date
   *  objects; the conversion to UTC happens once, at submit. */
  function commitPickerWith(p: NonNullable<typeof picker>) {
    const current = p.field === 'start' ? startAt : endAt;
    const next = new Date(current ?? p.temp);
    if (p.mode === 'date') {
      next.setFullYear(p.temp.getFullYear(), p.temp.getMonth(), p.temp.getDate());
    } else {
      next.setHours(p.temp.getHours(), p.temp.getMinutes(), 0, 0);
    }

    if (p.field === 'start') setStartAt(next);
    else setEndAt(next);
    setPicker(null);
  }

  /** iOS Done. Commits whatever the wheel is showing — including the seeded
   *  default when the user never moved it, which is the Bug 1 fix. */
  function commitPicker() {
    if (picker) commitPickerWith(picker);
  }

  /** Cancel: drop the working value, leave the saved one (or empty) untouched. */
  function cancelPicker() {
    setPicker(null);
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

  function onPickerChange(event: any, selected?: Date) {
    const p = picker;
    if (!p) return;

    if (Platform.OS === 'android') {
      // Android's picker is a modal dialog that owns its own OK / Cancel and
      // fires onChange exactly once: 'set' with the displayed value (so OK
      // without moving the wheel already carries the default), 'dismissed' on
      // cancel or back. Route those through the same commit/cancel paths so both
      // platforms have identical semantics.
      if (event?.type === 'set' && selected) {
        setPicker({ ...p, temp: selected });
        // setPicker is async, so commit from a locally-built picker rather than
        // reading state we just queued.
        commitPickerWith({ ...p, temp: selected });
      } else {
        cancelPicker();
      }
      return;
    }

    // iOS: the inline spinner streams changes as the wheel turns. Only the
    // working value moves — nothing is saved until Done.
    if (selected) setPicker({ ...p, temp: selected });
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      {/* Plain View + hook insets (see the note on the component): correct on the
          first frame, on every notch / Dynamic Island / Android status bar. */}
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={12}
            style={styles.headerSide}
            accessibilityRole="button"
            accessibilityLabel="Close poll"
          >
            <Ionicons name="close" size={24} color={chatColors.text} />
          </TouchableOpacity>

          {/* Absolutely centered so the title stays optically centred no matter
              how wide Send gets (localisation, loading spinner). */}
          <View style={styles.headerTitleWrap} pointerEvents="none">
            <Text style={styles.headerTitle}>Poll</Text>
          </View>

          <View style={[styles.headerSide, styles.headerSideRight]}>
            <TouchableOpacity
              style={[styles.sendBtn, (!canSend || submitting) && styles.sendBtnDisabled]}
              onPress={handleSend}
              disabled={!canSend || submitting}
              accessibilityRole="button"
              accessibilityLabel="Send poll"
              accessibilityState={{ disabled: !canSend || submitting, busy: submitting }}
            >
              {submitting ? (
                <ActivityIndicator size="small" color={chatColors.cream} />
              ) : (
                <Text style={styles.sendLabel}>Send</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <KeyboardAvoidingView
          style={styles.flex}
          // 'padding' on iOS shrinks the scroll viewport by the keyboard height;
          // 'height' is the Android equivalent that works inside a Modal, where
          // windowSoftInputMode=adjustResize does not reach.
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            ref={scrollRef}
            style={styles.flex}
            contentContainerStyle={[
              styles.content,
              // Clears the iOS home indicator / Android navigation bar.
              { paddingBottom: insets.bottom + 24 },
            ]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
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
              accessibilityLabel="Poll question"
            />

            <Text style={styles.label}>Poll options</Text>
            {options.map((opt, idx) => (
              <View key={idx} style={styles.optionRow}>
                <TextInput
                  ref={(r) => {
                    optionRefs.current[idx] = r;
                  }}
                  style={styles.optionInput}
                  value={opt}
                  placeholder={`Option ${idx + 1}`}
                  placeholderTextColor={chatColors.textMuted}
                  onChangeText={(t) => {
                    setOptions((prev) => {
                      const next = [...prev];
                      next[idx] = t;
                      return next;
                    });
                  }}
                  maxLength={100}
                  returnKeyType="next"
                  accessibilityLabel={`Poll option ${idx + 1}`}
                />
                {options.length > MIN_OPTIONS && (
                  <TouchableOpacity
                    onPress={() => removeOption(idx)}
                    hitSlop={12}
                    style={styles.removeOption}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove option ${idx + 1}`}
                  >
                    <Ionicons name="close-circle" size={20} color={chatColors.textMuted} />
                  </TouchableOpacity>
                )}
              </View>
            ))}

            {options.length < MAX_OPTIONS && (
              <TouchableOpacity
                style={styles.addOptionRow}
                onPress={addOption}
                accessibilityRole="button"
                accessibilityLabel="Add option"
              >
                <Ionicons name="add" size={16} color={chatColors.teal} />
                <Text style={styles.addOptionText}>Add option</Text>
              </TouchableOpacity>
            )}

            <View style={styles.toggleRow}>
              <Text style={styles.label}>Multiple options</Text>
              <View style={styles.switchWrap}>
                <Switch
                  value={allowMultiple}
                  onValueChange={setAllowMultiple}
                  trackColor={{ true: chatColors.teal, false: chatColors.border }}
                  thumbColor={chatColors.white}
                  ios_backgroundColor={chatColors.border}
                  style={{ transform: [{ scale: SWITCH_SCALE }] }}
                  accessibilityRole="switch"
                  accessibilityLabel="Allow selecting multiple options"
                  accessibilityState={{ checked: allowMultiple }}
                />
              </View>
            </View>

            <Text style={styles.label}>Duration</Text>
            {(['start', 'end'] as const).map((field) => {
              const value = field === 'start' ? startAt : endAt;
              const name = field === 'start' ? 'Start' : 'End';
              return (
                <View key={field} style={styles.durationRow}>
                  <Text style={styles.durationLabel}>{name}</Text>
                  <View style={styles.dateTimeGroup}>
                    <TouchableOpacity
                      style={styles.dateChip}
                      onPress={() => openPicker(field, 'date')}
                      accessibilityRole="button"
                      accessibilityLabel={`${name} date${value ? `, ${fmtDate(value)}` : ', not set'}`}
                    >
                      <Text
                        style={[styles.chipText, !value && styles.chipPlaceholder]}
                        numberOfLines={1}
                      >
                        {fmtDate(value)}
                      </Text>
                    </TouchableOpacity>
                    <View style={styles.chipDivider} />
                    <TouchableOpacity
                      style={styles.timeChip}
                      onPress={() => openPicker(field, 'time')}
                      accessibilityRole="button"
                      accessibilityLabel={`${name} time${value ? `, ${fmtTime(value)}` : ', not set'}`}
                    >
                      <Text
                        style={[styles.chipText, !value && styles.chipPlaceholder]}
                        numberOfLines={1}
                      >
                        {fmtTime(value)}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {/* Reserves its slot whether or not a value is set, so the
                      chips never shift sideways when one is chosen or cleared. */}
                  <View style={styles.clearSlot}>
                    {value && (
                      <TouchableOpacity
                        onPress={() => (field === 'start' ? setStartAt(null) : setEndAt(null))}
                        hitSlop={12}
                        accessibilityRole="button"
                        accessibilityLabel={`Clear ${name.toLowerCase()}`}
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
          <View style={[styles.pickerWrap, { paddingBottom: insets.bottom }]}>
            {Platform.OS === 'ios' && (
              // Android's dialog brings its own OK/Cancel; only iOS's inline
              // spinner needs us to supply them.
              <View style={styles.iosPickerHeader}>
                <TouchableOpacity
                  onPress={cancelPicker}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel, keep the previous value"
                >
                  <Text style={styles.iosPickerCancel}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={commitPicker}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel="Done, save this date and time"
                >
                  <Text style={styles.iosPickerDone}>Done</Text>
                </TouchableOpacity>
              </View>
            )}
            <DateTimePicker
              // Driven by the working value, not the saved one, so the wheel
              // reflects what Done is about to commit.
              value={picker.temp}
              mode={picker.mode}
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              // Never let the wheel land on a past instant: start ≥ now, end ≥
              // start (or now). Date mode only meaningfully bounds the day.
              minimumDate={picker.min}
              onChange={onPickerChange}
            />
          </View>
        )}
      </View>
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
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: chatColors.borderSearch,
  },
  // Equal-width sides keep the absolutely-centred title honest, and the 44pt
  // minimum keeps ✕ / Send comfortably tappable even though the icon is compact.
  headerSide: {
    minWidth: 72,
    minHeight: 44,
    justifyContent: 'center',
  },
  headerSideRight: { alignItems: 'flex-end' },
  headerTitleWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    ...chatTypography.chatTitle,
    fontSize: 18,
  },
  sendBtn: {
    backgroundColor: chatColors.teal,
    borderRadius: 40,
    paddingHorizontal: 16,
    paddingVertical: 7,
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
    ...chatShadow,
  },
  sendBtnDisabled: { opacity: 0.45 },
  sendLabel: {
    fontFamily: chatFonts.semiBold,
    fontSize: 12,
    color: chatColors.cream,
    letterSpacing: 0.38,
  },

  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 8,
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
    marginTop: 2,
  },

  // minHeight + padding (never a fixed height): the field is compact at rest,
  // still a comfortable touch target, and grows instead of clipping when the
  // text wraps or the user has larger accessibility text.
  questionInput: {
    backgroundColor: chatColors.pollSheet,
    borderRadius: 24,
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontFamily: chatFonts.regular,
    fontSize: 15,
    lineHeight: 20,
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
    borderRadius: 24,
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 10,
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
    paddingVertical: 6,
    alignSelf: 'flex-start',
    minHeight: 36,
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
    marginTop: 4,
    minHeight: 44,
  },
  switchWrap: {
    minHeight: 44,
    justifyContent: 'center',
  },

  durationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    minHeight: 44,
  },
  durationLabel: {
    fontFamily: chatFonts.semiBold,
    fontSize: 15,
    color: chatColors.text,
    flexGrow: 1,
    flexShrink: 1,
  },
  // The joined Date|Time pill. flexShrink lets it compress on narrow devices
  // instead of pushing the row off-screen.
  dateTimeGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 40,
    backgroundColor: chatColors.pollSheet,
    flexShrink: 1,
    ...chatShadow,
  },
  dateChip: {
    minHeight: 36,
    minWidth: 84,
    flexShrink: 1,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeChip: {
    minHeight: 36,
    minWidth: 76,
    flexShrink: 1,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipDivider: {
    width: 1,
    alignSelf: 'stretch',
    marginVertical: 6,
    backgroundColor: chatColors.border,
  },
  clearSlot: {
    width: 26,
    alignItems: 'flex-end',
  },
  chipText: {
    fontFamily: chatFonts.medium,
    fontSize: 13,
    color: chatColors.text,
  },
  chipPlaceholder: {
    color: chatColors.textMuted,
  },
  durationHint: {
    fontFamily: chatFonts.regular,
    fontSize: 11,
    color: chatColors.textMuted,
    fontStyle: 'italic',
    marginTop: 2,
  },

  pickerWrap: {
    backgroundColor: chatColors.bg,
    borderTopWidth: 1,
    borderTopColor: chatColors.border,
  },
  iosPickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    minHeight: 44,
  },
  iosPickerCancel: {
    fontFamily: chatFonts.medium,
    fontSize: 14,
    color: chatColors.textMuted,
  },
  iosPickerDone: {
    fontFamily: chatFonts.semiBold,
    fontSize: 14,
    color: chatColors.teal,
  },
});
