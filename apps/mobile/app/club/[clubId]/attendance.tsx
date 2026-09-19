import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAuthStore } from '@weglue/shared';
import { useClubProfile } from '../../../hooks/useClubProfile';
import { useOfficerStore } from '../../../store/officerStore';
import { QrShareScreen } from '../../../components/share/QrShareScreen';

// ─── QR attendance (club ⋯ → QR attendance) ─────────────────────────────────
// One permanent link per club — the same QR works for every event. Deliberately
// simple per spec: club identity, the code, Download. No event history, no
// open/close controls, no other club-management affordances live here.
// Reuses the exact QrShareScreen every other QR surface in the app uses, so
// Download/Share/Copy-link behave identically to Club Profile's own QR.

export type ClubAttendanceParams = { clubId: string };

const CREAM = '#FEFCF0';
const TEAL = '#0FA6A6';
const INK = '#1A1A1A';

export default function ClubAttendanceScreen() {
  const { clubId } = useLocalSearchParams<ClubAttendanceParams>();
  const router = useRouter();
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const { officerClubIds } = useOfficerStore();
  const isOfficer = !!clubId && officerClubIds.includes(clubId);
  const { data: club, isLoading } = useClubProfile(clubId, userId);

  const checkinUrl = `https://weglue.app/checkin/${clubId}`;

  if (!isOfficer) {
    // Defence in depth — the ⋯ menu never offers this route to a non-officer,
    // but a stale link/back-navigation must not leak it either.
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: CREAM, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontSize: 15, color: '#5F5D5D', fontFamily: 'Inter_400Regular', textAlign: 'center' }}>
          Only club officers and advisors can view this.
        </Text>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} style={{ marginTop: 16 }}>
          <Text style={{ color: TEAL, fontFamily: 'Inter_600SemiBold', fontSize: 15 }}>Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (isLoading || !club) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: CREAM, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={TEAL} />
      </SafeAreaView>
    );
  }

  // QrShareScreen is itself a full-screen Modal with its own close (X), safe
  // areas and Download/Share/Copy actions — this route just supplies it with
  // the club's permanent check-in URL and stays mounted underneath so
  // router.back() (from onClose) has a screen to return to.
  return (
    <View style={{ flex: 1, backgroundColor: CREAM }}>
      <QrShareScreen
        visible
        onClose={() => router.back()}
        title={club.name}
        subtitle="Attendance QR"
        url={checkinUrl}
        shareLabel="Share"
        shareMessage={`Scan to check in to ${club.name} events:`}
        fileName={`${club.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-attendance-qr`}
      />
    </View>
  );
}
