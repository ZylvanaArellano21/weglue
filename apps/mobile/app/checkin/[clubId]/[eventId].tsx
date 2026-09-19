import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { supabase } from '../../../lib/supabase';
import { setPendingCheckin } from '../../../lib/pendingCheckin';
import { useToast } from '../../../components/Toast';

// ─── Check-in form ───────────────────────────────────────────────────────────
// Reached either directly (scanned a resolved single-active-event QR, tapped
// from the multi-event picker, or the club QR link with only one event open)
// or via resumePendingCheckin after a signed-out visit completes auth. Collects
// ONLY Student ID + school email — never anything the event card/Going button
// already covers. Editable while the window stays open; read-only after.

export type CheckinFormParams = { clubId: string; eventId: string };

interface EventSummary {
  title: string;
  club_name: string;
}

const CREAM = '#FEFCF0';
const TEAL = '#0FA6A6';
const INK = '#1A1A1A';
const MUTED = '#5F5D5D';

export default function CheckinFormScreen() {
  const { clubId, eventId } = useLocalSearchParams<CheckinFormParams>();
  const router = useRouter();
  const { session, isLoading: authLoading } = useAuthStore();
  const userId = session?.user.id;
  const { show, ToastComponent } = useToast();

  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [event, setEvent] = useState<EventSummary | null>(null);
  const [windowOpen, setWindowOpen] = useState(false);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);

  const [studentId, setStudentId] = useState('');
  const [schoolEmail, setSchoolEmail] = useState('');
  const [saveForFuture, setSaveForFuture] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ studentId?: string; schoolEmail?: string }>({});

  useEffect(() => {
    if (authLoading || !clubId || !eventId) return;
    if (!session) {
      void setPendingCheckin({ clubId, eventId }).then(() => router.replace('/auth/login'));
      return;
    }
    let cancelled = false;
    (async () => {
      const [{ data: eventRow, error: eventError }, { data: activeRows }, { data: myRecord }] =
        await Promise.all([
          supabase.from('events').select('title, clubs!inner(name)').eq('id', eventId).maybeSingle(),
          supabase.rpc('resolve_club_active_checkins', { p_club_id: clubId }),
          supabase.from('event_attendance').select('student_id, school_email').eq('event_id', eventId).eq('user_id', userId!).maybeSingle(),
        ]);
      if (cancelled) return;
      if (eventError || !eventRow) {
        setPhase('error');
        return;
      }
      setEvent({ title: (eventRow as any).title, club_name: (eventRow as any).clubs.name });

      const isActive = ((activeRows ?? []) as { event_id: string }[]).some((r) => r.event_id === eventId);
      setWindowOpen(isActive);

      if (myRecord) {
        setStudentId(myRecord.student_id ?? '');
        setSchoolEmail(myRecord.school_email ?? '');
        setAlreadySubmitted(true);
      } else {
        // No submission yet for this event — prefill from this campus's saved
        // info, if the student has checked in anywhere on this campus before.
        // The RPC derives the caller's own campus server-side; the client
        // never supplies or guesses it.
        const { data: saved } = await supabase.rpc('get_saved_attendance_info');
        const savedRow = Array.isArray(saved) ? saved[0] : saved;
        if (!cancelled && savedRow) {
          setStudentId(savedRow.student_id ?? '');
          setSchoolEmail(savedRow.school_email ?? '');
        }
      }
      setPhase('ready');
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, session, clubId, eventId]);

  function validate(): boolean {
    const errors: { studentId?: string; schoolEmail?: string } = {};
    if (!studentId.trim()) errors.studentId = 'Student ID is required.';
    const email = schoolEmail.trim();
    if (!email) errors.schoolEmail = 'School email is required.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.schoolEmail = 'Enter a valid email address.';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit() {
    if (submitting || !validate()) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('submit_event_checkin', {
        p_event_id: eventId,
        p_student_id: studentId.trim(),
        p_school_email: schoolEmail.trim().toLowerCase(),
        p_save_for_future: saveForFuture,
      });
      if (error) {
        if (error.message?.includes('checkin_window_closed')) {
          show("Check-in has closed for this event.", 'error');
          setWindowOpen(false);
        } else if (error.message?.includes('campus_mismatch')) {
          show('This event is not available for check-in on your campus.', 'error');
        } else {
          show('Could not check in. Try again.', 'error');
        }
        return;
      }
      setAlreadySubmitted(true);
      show(alreadySubmitted ? 'Check-in updated!' : "You're checked in! 🎉", 'success');
    } catch {
      show('Could not check in. Try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  if (authLoading || phase === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: CREAM, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={TEAL} />
      </SafeAreaView>
    );
  }

  if (phase === 'error' || !event) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: CREAM, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontSize: 15, color: MUTED, fontFamily: 'Inter_400Regular', textAlign: 'center' }}>
          This event is no longer available.
        </Text>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} style={{ marginTop: 16 }}>
          <Text style={{ color: TEAL, fontFamily: 'Inter_600SemiBold', fontSize: 15 }}>Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: CREAM }} edges={['top']}>
      {ToastComponent}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
            <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} hitSlop={{ top: 10, left: 10, right: 10, bottom: 10 }}>
              <Ionicons name="chevron-back" size={26} color={INK} />
            </TouchableOpacity>
          </View>
          <Text style={{ fontSize: 22, fontWeight: '700', color: INK, fontFamily: 'Zain_700Bold', marginTop: 8 }}>
            {event.title}
          </Text>
          <Text style={{ fontSize: 14, color: MUTED, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
            {event.club_name}
          </Text>

          {!windowOpen ? (
            <View style={{ marginTop: 24, backgroundColor: '#fff', borderRadius: 14, padding: 18 }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: INK, fontFamily: 'Inter_600SemiBold' }}>
                {alreadySubmitted ? "You're checked in" : 'Check-in is closed'}
              </Text>
              <Text style={{ marginTop: 6, fontSize: 13, color: MUTED, fontFamily: 'Inter_400Regular' }}>
                {alreadySubmitted
                  ? 'Your check-in window for this event has closed, so it can no longer be edited.'
                  : 'This event is not currently accepting check-ins.'}
              </Text>
            </View>
          ) : (
            <View style={{ marginTop: 24, gap: 16 }}>
              <View>
                <Text style={{ fontSize: 13, fontWeight: '600', color: INK, fontFamily: 'Inter_600SemiBold', marginBottom: 6 }}>
                  Student ID
                </Text>
                <TextInput
                  value={studentId}
                  onChangeText={setStudentId}
                  placeholder="e.g. 123456789"
                  placeholderTextColor="#9CA3AF"
                  autoCapitalize="none"
                  style={{
                    backgroundColor: '#fff',
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    fontSize: 15,
                    fontFamily: 'Inter_400Regular',
                    color: INK,
                    borderWidth: fieldErrors.studentId ? 1 : 0,
                    borderColor: '#EF4444',
                  }}
                />
                {fieldErrors.studentId && (
                  <Text style={{ color: '#EF4444', fontSize: 12, marginTop: 4, fontFamily: 'Inter_400Regular' }}>
                    {fieldErrors.studentId}
                  </Text>
                )}
              </View>

              <View>
                <Text style={{ fontSize: 13, fontWeight: '600', color: INK, fontFamily: 'Inter_600SemiBold', marginBottom: 6 }}>
                  School email
                </Text>
                <TextInput
                  value={schoolEmail}
                  onChangeText={setSchoolEmail}
                  placeholder="you@university.edu"
                  placeholderTextColor="#9CA3AF"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  style={{
                    backgroundColor: '#fff',
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    fontSize: 15,
                    fontFamily: 'Inter_400Regular',
                    color: INK,
                    borderWidth: fieldErrors.schoolEmail ? 1 : 0,
                    borderColor: '#EF4444',
                  }}
                />
                {fieldErrors.schoolEmail && (
                  <Text style={{ color: '#EF4444', fontSize: 12, marginTop: 4, fontFamily: 'Inter_400Regular' }}>
                    {fieldErrors.schoolEmail}
                  </Text>
                )}
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 13, color: INK, fontFamily: 'Inter_400Regular', flex: 1, marginRight: 12 }}>
                  Save this information for future check-ins on this campus
                </Text>
                <Switch value={saveForFuture} onValueChange={setSaveForFuture} trackColor={{ true: TEAL }} />
              </View>

              <TouchableOpacity
                onPress={handleSubmit}
                disabled={submitting}
                activeOpacity={0.85}
                style={{
                  marginTop: 8,
                  backgroundColor: TEAL,
                  borderRadius: 24,
                  paddingVertical: 14,
                  alignItems: 'center',
                  opacity: submitting ? 0.7 : 1,
                }}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700', fontFamily: 'Inter_600SemiBold' }}>
                    {alreadySubmitted ? 'Update check-in' : 'Check in'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
