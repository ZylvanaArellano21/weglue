import { useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  BackHandler,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useHomeTabStore } from '../../store/homeTabStore';
import { useSidebarStore } from '../../store/sidebarStore';

/**
 * Celebratory results screen shown after an authenticated user saves their
 * interests/activities from the side menu.
 *
 * It intentionally mirrors the account-creation screen's celebration (🎉, the
 * big underlined teal count, the cream background) so saving a survey inside
 * the app feels like the same reward moment — not a settings toast. It shows
 * the COUNT only; the clubs themselves live on Home → Events, which is where
 * "See my matches" lands.
 */
export default function MatchResultsScreen() {
  const router = useRouter();
  const { count } = useLocalSearchParams<{ count?: string }>();
  const setActiveTab = useHomeTabStore((s) => s.setActiveTab);

  const matchCount = Number(count ?? 0);

  // This screen sits on top of the profile stack. Android Back would drop the
  // user back into the survey they just completed — send them to their matches
  // instead, which is the only forward path.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      goToMatches();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function goToMatches() {
    // Home, with Events selected — the new batch is already in the query cache
    // (the regenerate mutation seeded it), so the count and the club order here
    // and there are the same batch.
    setActiveTab('events');
    // This is a completed flow moving the user FORWARD, not a Back out of a
    // sidebar destination. Interests may have been launched from the sidebar,
    // which armed "reopen the drawer when we return to Home" — drop that, or the
    // sidebar would slide open on top of the matches the user just asked to see.
    // (Backing out of the survey BEFORE saving still restores the sidebar.)
    useSidebarStore.getState().clearReturn();
    router.dismissAll();
    router.replace('/(tabs)');
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.partyRow}>
          <Text style={styles.partyEmoji}>🎉</Text>
          <Text style={styles.congrats}>Congratulations!</Text>
          <Text style={styles.partyEmoji}>🎉</Text>
        </View>

        <Text style={styles.matchedText}>You matched with</Text>
        <Text style={styles.matchCount}>{matchCount} clubs!</Text>

        <Text style={styles.body}>
          We found new clubs based on your interests and activities. Your matches
          are waiting for you.
        </Text>
      </View>

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={goToMatches}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>See my matches</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FEFCF0' },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  partyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  partyEmoji: { fontSize: 28 },
  congrats: {
    fontSize: 30,
    fontFamily: 'Zain_700Bold',
    fontWeight: '700',
    color: '#000',
    textAlign: 'center',
  },
  matchedText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0FA6A6',
    textAlign: 'center',
  },
  matchCount: {
    fontSize: 44,
    fontWeight: '700',
    color: '#0FA6A6',
    textDecorationLine: 'underline',
    marginTop: 4,
    marginBottom: 20,
    textAlign: 'center',
  },
  body: {
    fontSize: 16,
    fontWeight: '500',
    color: '#000',
    textAlign: 'center',
    lineHeight: 24,
  },
  footer: { paddingHorizontal: 24, paddingBottom: 40 },
  primaryBtn: {
    height: 52,
    backgroundColor: '#0FA6A6',
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  primaryBtnText: { color: '#FEFCF0', fontSize: 16, fontWeight: '600' },
});
