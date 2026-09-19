import { memo, useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, Image, Dimensions, RefreshControl, ListRenderItem } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { useMyClubs } from '../../../hooks/useClubTab';
import { Skeleton } from '../../../components/shared/SkeletonLoader';
import type { ClubWithNextEvent } from '../../../services/clubTabService';
import { navigateToDiscover } from '../../../lib/discoverNavigation';
import { useTabBarBottomPadding } from '../../../lib/tabBar';
import { getResizedImageUrl } from '../../../lib/imageResize';

// Darkened meeting text for high contrast (was #9CA3AF light gray, which the
// design brief explicitly forbids for meeting schedules).
const META_COLOR = '#4A4A4A';
const ALERT_COLOR = '#F02719';

const SCREEN_WIDTH = Dimensions.get('window').width;
const CARD_WIDTH = (SCREEN_WIDTH - 32 - 10) / 2;

// ─── Strings ─────────────────────────────────────────────────────────────────
const STRINGS = {
  OFFICER_CLUB: 'Officer Club',
  MEMBER_CLUB: 'Member Club',
  EMPTY_TITLE: 'Your community is waiting for you',
  EMPTY_SUBTITLE: 'Join clubs that match your interests and connect with students on campus.',
  DISCOVER_CLUBS: 'Discover Clubs',
} as const;

function formatTime(t: string | null): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

function formatEventDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

// ─── Club Card ───────────────────────────────────────────────────────────────
const ClubCard = memo(function ClubCard({ club }: { club: ClubWithNextEvent }) {
  const router = useRouter();
  const isOfficer = !!club.officer_role;
  const hasEventThisWeek = !!club.next_event;

  return (
    <TouchableOpacity
      onPress={() =>
        router.push({ pathname: '/club/[clubId]', params: { clubId: club.id } })
      }
      activeOpacity={0.85}
      style={{
        width: CARD_WIDTH,
        backgroundColor: '#fff',
        borderRadius: 12,
        overflow: 'hidden',
        // Stronger, softer raised shadow so the whole card reads as 3D on iOS,
        // with matching Android elevation (iOS shadow* props are ignored there).
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.18,
        shadowRadius: 10,
        elevation: 6,
      }}
    >
      {/* Cover image */}
      <View style={{ width: '100%', height: CARD_WIDTH * 0.56, backgroundColor: '#E5E7EB', position: 'relative' }}>
        {club.avatar_url ? (
          <Image
            source={{ uri: getResizedImageUrl(club.avatar_url, CARD_WIDTH * 2, CARD_WIDTH * 0.56 * 2) ?? undefined }}
            style={{ width: '100%', height: '100%' }}
            resizeMode="cover"
            fadeDuration={0}
          />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E5E7EB' }}>
            <Text style={{ fontSize: 28 }}>🎓</Text>
          </View>
        )}

        {/* Officer badge */}
        {isOfficer && (
          <View
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: '#fff',
              borderRadius: 20,
              paddingHorizontal: 8,
              paddingVertical: 4,
              gap: 4,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.1,
              shadowRadius: 2,
              elevation: 2,
            }}
          >
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#F59E0B' }} />
            <Text style={{ fontSize: 10, fontWeight: '700', color: '#374151', fontFamily: 'Inter_700Bold' }}>
              {club.officer_role ?? 'Officer'}
            </Text>
          </View>
        )}
      </View>

      {/* Card body */}
      <View style={{ padding: 10 }}>
        <Text
          style={{
            fontSize: 13,
            fontWeight: '700',
            color: '#111827',
            fontFamily: 'Inter_700Bold',
            marginBottom: 4,
          }}
          numberOfLines={1}
        >
          {club.name}
        </Text>

        {/* Event this week — red alert state */}
        {hasEventThisWeek && club.next_event ? (
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 4, marginBottom: 2 }}>
            <Text style={{ fontSize: 12, color: ALERT_COLOR, lineHeight: 16 }}>⚠</Text>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontSize: 11.5,
                  color: ALERT_COLOR,
                  fontFamily: 'Inter_600SemiBold',
                  lineHeight: 16,
                }}
                numberOfLines={2}
              >
                {club.next_event.emoji ? `${club.next_event.emoji} ` : ''}{club.next_event.title}
              </Text>
              <Text style={{ fontSize: 10.5, color: ALERT_COLOR, fontFamily: 'Inter_500Medium', marginTop: 1 }}>
                {formatEventDate(club.next_event.event_date)}
              </Text>
            </View>
            {/* Small event indicator, bottom-right of the card */}
            <Ionicons name="notifications" size={14} color={ALERT_COLOR} style={{ marginTop: 1 }} />
          </View>
        ) : club.meeting_schedule ? (
          /* No event — darkened, high-contrast meeting info: day / time / place */
          <View>
            <Text style={{ fontSize: 11.5, color: META_COLOR, fontFamily: 'Inter_500Medium', lineHeight: 16 }} numberOfLines={1}>
              {club.meeting_schedule.day}
            </Text>
            {club.meeting_schedule.time_start ? (
              <Text style={{ fontSize: 11.5, color: META_COLOR, fontFamily: 'Inter_500Medium', lineHeight: 16 }} numberOfLines={1}>
                {formatTime(club.meeting_schedule.time_start)}
                {club.meeting_schedule.time_end ? ` - ${formatTime(club.meeting_schedule.time_end)}` : ''}
              </Text>
            ) : null}
            {club.meeting_schedule.room ? (
              <Text style={{ fontSize: 11.5, color: META_COLOR, fontFamily: 'Inter_500Medium', lineHeight: 16 }} numberOfLines={2}>
                {club.meeting_schedule.building
                  ? `Building ${club.meeting_schedule.building}, Room ${club.meeting_schedule.room}`
                  : `Room ${club.meeting_schedule.room}`}
              </Text>
            ) : null}
          </View>
        ) : (
          <Text style={{ fontSize: 11.5, color: META_COLOR, fontFamily: 'Inter_500Medium', fontStyle: 'italic', lineHeight: 16 }} numberOfLines={1}>
            Schedule coming soon
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
});

// ─── Section Header ──────────────────────────────────────────────────────────
function SectionHeader({ title }: { title: string }) {
  return (
    <Text
      style={{
        fontSize: 20,
        fontWeight: '800',
        color: '#111827',
        fontFamily: 'Zain_800ExtraBold',
        marginBottom: 12,
        marginTop: 16,
      }}
    >
      {title}
    </Text>
  );
}

// ─── Flattened list items ─────────────────────────────────────────────────────
// A FlatList needs one flat array to virtualize; section headers and club-card
// rows (2 per row, matching the existing grid visual) are flattened together,
// the same pattern already used for the Home events feed.
type ClubTabItem =
  | { type: 'header'; id: string; title: string }
  | { type: 'row'; id: string; clubs: ClubWithNextEvent[] };

function buildClubTabItems(
  officerClubs: ClubWithNextEvent[],
  memberClubs: ClubWithNextEvent[],
): ClubTabItem[] {
  const items: ClubTabItem[] = [];

  if (officerClubs.length > 0) {
    items.push({ type: 'header', id: 'header-officer', title: STRINGS.OFFICER_CLUB });
    for (let i = 0; i < officerClubs.length; i += 2) {
      items.push({ type: 'row', id: `officer-row-${i}`, clubs: officerClubs.slice(i, i + 2) });
    }
  }

  if (memberClubs.length > 0) {
    items.push({ type: 'header', id: 'header-member', title: STRINGS.MEMBER_CLUB });
    for (let i = 0; i < memberClubs.length; i += 2) {
      items.push({ type: 'row', id: `member-row-${i}`, clubs: memberClubs.slice(i, i + 2) });
    }
  }

  return items;
}

// ─── Main Screen ─────────────────────────────────────────────────────────────
export default function ClubsTabScreen() {
  const router = useRouter();
  // Selector, not `useAuthStore()`: a bare destructure re-renders this screen
  // on every unrelated store field change, not just when the session changes.
  const userId = useAuthStore((s) => s.session?.user.id);
  const bottomPad = useTabBarBottomPadding();
  const { data, isLoading, refetch } = useMyClubs(userId);

  // Pull-to-refresh state kept separate from first-load state so refreshing
  // never swaps the rendered grid back to skeletons.
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const hasOfficer = (data?.officer_clubs.length ?? 0) > 0;
  const hasMember = (data?.member_clubs.length ?? 0) > 0;
  const isEmpty = !isLoading && !hasOfficer && !hasMember;

  const items = useMemo(
    () => buildClubTabItems(data?.officer_clubs ?? [], data?.member_clubs ?? []),
    [data?.officer_clubs, data?.member_clubs],
  );

  const renderItem: ListRenderItem<ClubTabItem> = useCallback(({ item }) => {
    if (item.type === 'header') {
      return <SectionHeader title={item.title} />;
    }
    return (
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
        {item.clubs.map((club) => (
          <ClubCard key={club.id} club={club} />
        ))}
      </View>
    );
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FEFCF0' }} edges={['top']}>
      {/* Skeleton loading */}
      {isLoading && (
        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          <Skeleton width={140} height={26} borderRadius={8} />
          <View style={{ marginTop: 14, flexDirection: 'row', gap: 10 }}>
            <Skeleton width={CARD_WIDTH} height={CARD_WIDTH * 1.1} borderRadius={12} />
            <Skeleton width={CARD_WIDTH} height={CARD_WIDTH * 1.1} borderRadius={12} />
          </View>
          <View style={{ marginTop: 20 }}>
            <Skeleton width={120} height={26} borderRadius={8} />
          </View>
          <View style={{ marginTop: 14, flexDirection: 'row', gap: 10 }}>
            <Skeleton width={CARD_WIDTH} height={CARD_WIDTH * 1.1} borderRadius={12} />
            <Skeleton width={CARD_WIDTH} height={CARD_WIDTH * 1.1} borderRadius={12} />
          </View>
        </View>
      )}

      {/* Empty state */}
      {isEmpty && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 }}>
          <Text style={{ fontSize: 52, marginBottom: 20 }}>🎓</Text>
          <Text
            style={{
              fontSize: 18,
              fontWeight: '800',
              color: '#111827',
              fontFamily: 'Zain_800ExtraBold',
              textAlign: 'center',
              marginBottom: 10,
            }}
          >
            {STRINGS.EMPTY_TITLE}
          </Text>
          <Text
            style={{
              fontSize: 14,
              color: '#6B7280',
              fontFamily: 'Inter_400Regular',
              textAlign: 'center',
              lineHeight: 22,
              marginBottom: 28,
            }}
          >
            {STRINGS.EMPTY_SUBTITLE}
          </Text>
          <TouchableOpacity
            onPress={() => navigateToDiscover()}
            activeOpacity={0.85}
            style={{
              backgroundColor: '#0FA6A6',
              paddingHorizontal: 28,
              paddingVertical: 14,
              borderRadius: 30,
            }}
          >
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff', fontFamily: 'Inter_700Bold' }}>
              {STRINGS.DISCOVER_CLUBS}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Club lists */}
      {!isLoading && !isEmpty && (
        <FlatList<ClubTabItem>
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomPad, paddingTop: 16 }}
          windowSize={7}
          maxToRenderPerBatch={6}
          initialNumToRender={6}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="#0FA6A6"
            />
          }
        />
      )}
    </SafeAreaView>
  );
}
