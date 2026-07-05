import { memo, useCallback, useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity, Image, Dimensions, RefreshControl, ListRenderItem } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@weglue/shared';
import { useMyClubs } from '../../../hooks/useClubTab';
import { Skeleton } from '../../../components/shared/SkeletonLoader';
import type { ClubWithNextEvent } from '../../../services/clubTabService';
import { navigateToDiscover } from '../../../lib/discoverNavigation';
import { getResizedImageUrl } from '../../../lib/imageResize';

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
        router.push({ pathname: '/(tabs)/clubs/[clubId]', params: { clubId: club.id } })
      }
      activeOpacity={0.85}
      style={{
        width: CARD_WIDTH,
        backgroundColor: '#fff',
        borderRadius: 12,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 6,
        elevation: 3,
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
            <Text style={{ fontSize: 11, color: '#F02719', lineHeight: 16 }}>⚠</Text>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontSize: 11,
                  color: '#F02719',
                  fontFamily: 'Inter_500Medium',
                  lineHeight: 16,
                }}
                numberOfLines={1}
              >
                {club.next_event.emoji ? `${club.next_event.emoji} ` : ''}{club.next_event.title}
              </Text>
              <Text style={{ fontSize: 10, color: '#F02719', fontFamily: 'Inter_400Regular' }}>
                {formatEventDate(club.next_event.event_date)}
              </Text>
            </View>
          </View>
        ) : club.meeting_schedule ? (
          /* No event — gray meeting info */
          <View>
            <Text style={{ fontSize: 11, color: '#9CA3AF', fontFamily: 'Inter_400Regular' }} numberOfLines={1}>
              {club.meeting_schedule.day}s{' '}
              {formatTime(club.meeting_schedule.time_start)}
              {club.meeting_schedule.time_end ? ` - ${formatTime(club.meeting_schedule.time_end)}` : ''}
            </Text>
            {club.meeting_schedule.room && (
              <Text style={{ fontSize: 11, color: '#9CA3AF', fontFamily: 'Inter_400Regular' }} numberOfLines={1}>
                {club.meeting_schedule.building
                  ? `${club.meeting_schedule.building} ${club.meeting_schedule.room}`
                  : club.meeting_schedule.room}
              </Text>
            )}
          </View>
        ) : null}
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
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const { data, isLoading, refetch } = useMyClubs(userId);

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
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, paddingTop: 16 }}
          windowSize={7}
          maxToRenderPerBatch={6}
          initialNumToRender={6}
          removeClippedSubviews
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={refetch}
              tintColor="#0FA6A6"
            />
          }
        />
      )}
    </SafeAreaView>
  );
}
