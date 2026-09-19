import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { supabase } from '../../../lib/supabase';
import { setPendingCheckin } from '../../../lib/pendingCheckin';

// ─── Scanned-QR landing (club-level, before an event is known) ─────────────
// Resolves the club's currently active check-in window(s) server-side
// (resolve_club_active_checkins — the single source of truth for the
// 15-min-before/after rule, no timezone math on-device):
//   0 active  → "no check-in right now" + View [Club] (the exact club profile)
//   1 active  → straight to that event's check-in screen
//   2+ active → let the student pick which event

export type CheckinResolverParams = { clubId: string };

interface ActiveCheckin {
  event_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
}

const CREAM = '#FEFCF0';
const TEAL = '#0FA6A6';
const INK = '#1A1A1A';
const MUTED = '#5F5D5D';

export default function CheckinResolverScreen() {
  const { clubId } = useLocalSearchParams<CheckinResolverParams>();
  const router = useRouter();
  const { session, isLoading: authLoading } = useAuthStore();
  const [state, setState] = useState<'loading' | 'none' | 'many' | 'error'>('loading');
  const [events, setEvents] = useState<ActiveCheckin[]>([]);

  useEffect(() => {
    if (authLoading || !clubId) return;
    if (!session) {
      void setPendingCheckin({ clubId }).then(() => router.replace('/auth/login'));
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('resolve_club_active_checkins', { p_club_id: clubId });
      if (cancelled) return;
      if (error) {
        setState('error');
        return;
      }
      const active = (data ?? []) as ActiveCheckin[];
      if (active.length === 0) {
        setState('none');
      } else if (active.length === 1) {
        router.replace({
          pathname: '/checkin/[clubId]/[eventId]',
          params: { clubId: clubId!, eventId: active[0].event_id },
        });
      } else {
        setEvents(active);
        setState('many');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, session, clubId]);

  if (authLoading || state === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: CREAM, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={TEAL} />
      </SafeAreaView>
    );
  }

  if (state === 'none' || state === 'error') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: CREAM, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Ionicons name="qr-code-outline" size={48} color="#D1D5DB" />
        <Text style={{ marginTop: 16, fontSize: 17, fontWeight: '700', color: INK, fontFamily: 'Zain_700Bold', textAlign: 'center' }}>
          {state === 'error' ? "Couldn't check for active events" : 'No check-in is open right now'}
        </Text>
        <Text style={{ marginTop: 6, fontSize: 14, color: MUTED, fontFamily: 'Inter_400Regular', textAlign: 'center' }}>
          {state === 'error'
            ? 'Please try scanning the code again.'
            : 'Check-in opens 15 minutes before an event starts.'}
        </Text>
        <TouchableOpacity
          onPress={() => router.replace({ pathname: '/club/[clubId]', params: { clubId: clubId! } })}
          activeOpacity={0.8}
          style={{ marginTop: 24, backgroundColor: TEAL, borderRadius: 24, paddingHorizontal: 24, paddingVertical: 12 }}
        >
          <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600', fontFamily: 'Inter_600SemiBold' }}>
            View Club
          </Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: CREAM }} edges={['top']}>
      <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 }}>
        <Text style={{ fontSize: 20, fontWeight: '700', color: INK, fontFamily: 'Zain_700Bold' }}>
          Which event are you checking into?
        </Text>
        <Text style={{ marginTop: 4, fontSize: 14, color: MUTED, fontFamily: 'Inter_400Regular' }}>
          More than one event is open right now.
        </Text>
      </View>
      <View style={{ paddingHorizontal: 16, gap: 10 }}>
        {events.map((e) => (
          <TouchableOpacity
            key={e.event_id}
            onPress={() =>
              router.replace({ pathname: '/checkin/[clubId]/[eventId]', params: { clubId: clubId!, eventId: e.event_id } })
            }
            activeOpacity={0.8}
            style={{ backgroundColor: '#fff', borderRadius: 14, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Text style={{ fontSize: 15, fontWeight: '600', color: INK, fontFamily: 'Inter_600SemiBold', flex: 1 }} numberOfLines={2}>
              {e.title}
            </Text>
            <Ionicons name="chevron-forward" size={20} color={MUTED} />
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}
