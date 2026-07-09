import { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Image,
  Dimensions,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { useClubProfile } from '../../../../hooks/useClubProfile';
import { useJoinClubMutation } from '../../../../hooks/useClubMembership';
import { useLeaveClubFlow } from '../../../../hooks/useLeaveClubFlow';
import { useOfficerStore } from '../../../../store/officerStore';
import { Avatar } from '../../../../components/shared/Avatar';
import { AvatarStack } from '../../../../components/shared/AvatarStack';
import { Skeleton } from '../../../../components/shared/SkeletonLoader';
import { useToast } from '../../../../components/Toast';
import { PhotoGalleryModal } from '../../../../components/club/PhotoGalleryModal';
import { LeaveClubModals } from '../../../../components/club/LeaveClubModals';
import type { ClubUpcomingEvent, ClubPhoto, ClubOfficer } from '../../../../services/clubService';
import { openClubChat, openOfficerChat, openDirectChatWith } from '../../../../lib/chatNavigation';
import { todayInAppTz } from '../../../../lib/timezone';

const SCREEN_WIDTH = Dimensions.get('window').width;
const PHOTO_SIZE = (SCREEN_WIDTH - 32 - 8) / 3;
const CREAM = '#FEFCF0';
const TEAL = '#0FA6A6';
const ALERT_RED = '#F02719';
const MUTED = '#5F5D5D';
const INK = '#000000';

const CARD_SHADOW = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.25,
  shadowRadius: 5,
  elevation: 3,
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatTime(timeStr: string): string {
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

function formatMeetingTime(start: string | null, end: string | null): string {
  if (!start) return '';
  const formatted = formatTime(start);
  return end ? `${formatted} - ${formatTime(end)}` : formatted;
}

// ─── Mini Calendar ────────────────────────────────────────────────────────────
function MiniCalendar({
  events,
  onDayPress,
}: {
  events: ClubUpcomingEvent[];
  onDayPress: (eventId: string) => void;
}) {
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());

  const eventIdByDate = new Map<string, string>();
  for (const e of events) {
    if (!eventIdByDate.has(e.event_date)) eventIdByDate.set(e.event_date, e.id);
  }
  const todayStr = todayInAppTz();

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const monthName = new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const days: (number | null)[] = Array(firstDay === 0 ? 6 : firstDay - 1).fill(null);
  for (let d = 1; d <= daysInMonth; d++) days.push(d);
  while (days.length % 7 !== 0) days.push(null);

  const DAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  return (
    <View
      style={{
        backgroundColor: CREAM,
        borderRadius: 10,
        padding: 14,
        ...CARD_SHADOW,
      }}
    >
      {/* Month nav */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <TouchableOpacity onPress={prevMonth} activeOpacity={0.7} hitSlop={{ top: 8, left: 8, right: 8, bottom: 8 }}>
          <Ionicons name="chevron-back" size={18} color={MUTED} />
        </TouchableOpacity>
        <Text style={{ fontSize: 13, fontWeight: '700', color: INK, fontFamily: 'Inter_700Bold' }}>
          {monthName}
        </Text>
        <TouchableOpacity onPress={nextMonth} activeOpacity={0.7} hitSlop={{ top: 8, left: 8, right: 8, bottom: 8 }}>
          <Ionicons name="chevron-forward" size={18} color={MUTED} />
        </TouchableOpacity>
      </View>

      {/* Day labels */}
      <View style={{ flexDirection: 'row', marginBottom: 6 }}>
        {DAY_LABELS.map((d) => (
          <Text
            key={d}
            style={{
              flex: 1,
              textAlign: 'center',
              fontSize: 10,
              color: MUTED,
              fontFamily: 'Inter_500Medium',
            }}
          >
            {d}
          </Text>
        ))}
      </View>

      {/* Days grid */}
      {Array.from({ length: days.length / 7 }, (_, row) => (
        <View key={row} style={{ flexDirection: 'row', marginBottom: 2 }}>
          {days.slice(row * 7, row * 7 + 7).map((day, col) => {
            if (!day) return <View key={col} style={{ flex: 1 }} />;

            const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isToday = dateStr === todayStr;
            const eventId = eventIdByDate.get(dateStr);
            const hasEvent = !!eventId;

            return (
              <Pressable
                key={col}
                disabled={!hasEvent}
                onPress={() => eventId && onDayPress(eventId)}
                style={({ pressed }) => ({
                  flex: 1,
                  alignItems: 'center',
                  paddingVertical: 2,
                  borderRadius: 13,
                  backgroundColor:
                    hasEvent && pressed ? 'rgba(15,166,166,0.18)' : 'transparent',
                })}
              >
                <View
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 13,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: isToday ? TEAL : 'transparent',
                    ...(hasEvent && !isToday
                      ? { borderWidth: 1, borderColor: 'rgba(15,166,166,0.35)' }
                      : {}),
                  }}
                >
                  <Text
                    style={{
                      fontSize: 11,
                      color: isToday ? CREAM : INK,
                      fontFamily: isToday ? 'Inter_700Bold' : hasEvent ? 'Inter_600SemiBold' : 'Inter_400Regular',
                    }}
                  >
                    {day}
                  </Text>
                </View>
                {hasEvent && (
                  <View
                    style={{
                      width: 4,
                      height: 4,
                      borderRadius: 2,
                      backgroundColor: TEAL,
                      marginTop: 1,
                    }}
                  />
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// ─── Upcoming Event Row ───────────────────────────────────────────────────────
function UpcomingEventRow({ event, clubId }: { event: ClubUpcomingEvent; clubId: string }) {
  const router = useRouter();
  const isRestricted = event.visibility === 'members' || event.visibility === 'specific';
  const locationText = [event.building, event.room, event.location].filter(Boolean).join(', ');

  return (
    <TouchableOpacity
      onPress={() =>
        router.push({
          pathname: '/(tabs)/clubs/[clubId]/events/[eventId]',
          params: { clubId, eventId: event.id },
        })
      }
      activeOpacity={0.7}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: CREAM,
        borderRadius: 10,
        marginBottom: 10,
        overflow: 'hidden',
        ...CARD_SHADOW,
      }}
    >
      <View style={{ width: 70, height: 70, backgroundColor: '#E5E7EB' }}>
        {event.cover_image_url ? (
          <Image source={{ uri: event.cover_image_url }} style={{ width: 70, height: 70 }} resizeMode="cover" />
        ) : (
          <View style={{ width: 70, height: 70, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E5E7EB' }}>
            <Ionicons name="calendar-outline" size={24} color={MUTED} />
          </View>
        )}
        {isRestricted && (
          <View
            style={{
              position: 'absolute',
              top: 4,
              left: 4,
              backgroundColor: ALERT_RED,
              borderRadius: 10,
              paddingHorizontal: 6,
              paddingVertical: 3,
            }}
          >
            <Text style={{ fontSize: 10, color: CREAM, fontFamily: 'Inter_700Bold' }}>
              Members Only
            </Text>
          </View>
        )}
      </View>
      <View style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 10 }}>
        <Text
          style={{ fontSize: 13, fontWeight: '700', color: INK, fontFamily: 'Inter_700Bold', marginBottom: 4 }}
          numberOfLines={1}
        >
          {event.emoji ? `${event.emoji} ` : ''}{event.title}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 4, marginBottom: 2 }}>
          <Ionicons name="calendar-outline" size={11} color={MUTED} style={{ marginTop: 1 }} />
          <View>
            <Text style={{ fontSize: 11, color: MUTED, fontFamily: 'Inter_500Medium' }}>
              {formatDate(event.event_date)}
            </Text>
            <Text style={{ fontSize: 11, color: MUTED, fontFamily: 'Inter_500Medium' }}>
              {formatTime(event.start_time)} - {formatTime(event.end_time)}
            </Text>
          </View>
        </View>
        {locationText ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name="location-outline" size={11} color={MUTED} />
            <Text style={{ fontSize: 11, color: MUTED, fontFamily: 'Inter_500Medium' }} numberOfLines={1}>
              {locationText}
            </Text>
          </View>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={MUTED} style={{ marginRight: 12 }} />
    </TouchableOpacity>
  );
}

// ─── Officer Row ──────────────────────────────────────────────────────────────
function OfficerRow({ officer }: { officer: ClubOfficer }) {
  const router = useRouter();

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
      <TouchableOpacity
        onPress={() => {
          if (officer.user_id) {
            router.push({ pathname: '/profile/[userId]', params: { userId: officer.user_id } });
          }
        }}
        activeOpacity={0.7}
      >
        <Avatar uri={officer.avatar_url} size={46} username={officer.display_name} />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <TouchableOpacity
          onPress={() => {
            if (officer.user_id) {
              router.push({ pathname: '/profile/[userId]', params: { userId: officer.user_id } });
            }
          }}
          activeOpacity={0.7}
        >
          <Text style={{ fontSize: 14, fontWeight: '700', color: INK, fontFamily: 'Inter_700Bold' }}>
            {officer.display_name}
          </Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 13, color: TEAL, fontFamily: 'Inter_500Medium' }}>
          {officer.role_title}
        </Text>
      </View>
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => { if (officer.user_id) void openDirectChatWith(officer.user_id); }}
        style={{
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: 20,
          backgroundColor: CREAM,
          ...CARD_SHADOW,
        }}
      >
        <Text style={{ fontSize: 13, color: TEAL, fontFamily: 'Inter_600SemiBold' }}>Message</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function ClubProfileScreen() {
  const { clubId } = useLocalSearchParams<{ clubId: string }>();
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const router = useRouter();
  const { show, ToastComponent } = useToast();
  const { officerClubIds } = useOfficerStore();

  const [photoViewerVisible, setPhotoViewerVisible] = useState(false);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);

  const { data: club, isLoading, isError, refetch } = useClubProfile(clubId, userId);
  const { mutate: join, isPending: joining } = useJoinClubMutation(userId);
  const {
    target: leaveTarget,
    isPending: leaving,
    requestLeave,
    cancel: cancelLeave,
    confirm: confirmLeave,
  } = useLeaveClubFlow(userId, show);

  // Pull-to-refresh state kept separate from first-load state so a background
  // refetch never swaps rendered content back to skeletons.
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const isOfficer = !!clubId && officerClubIds.includes(clubId);

  const handleJoinLeave = () => {
    if (club?.is_member && clubId) {
      void requestLeave(clubId, club.name);
    } else if (clubId) {
      join(clubId, {
        onSuccess: () => show(`Joined ${club?.name ?? 'club'}! 🎉`),
        onError: () => show('Failed to join club.', 'error'),
      });
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: CREAM }} edges={['top']}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 16 }} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={26} color={INK} />
        </TouchableOpacity>
        <View style={{ padding: 16, gap: 16 }}>
          <Skeleton width="100%" height={200} borderRadius={0} />
          <Skeleton width={200} height={22} />
          <Skeleton width={120} height={14} />
          <Skeleton width="100%" height={48} borderRadius={24} />
          <Skeleton width="100%" height={80} borderRadius={12} />
          <Skeleton width="100%" height={80} borderRadius={12} />
        </View>
      </SafeAreaView>
    );
  }

  if (!club) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: CREAM }} edges={['top']}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 16 }} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={26} color={INK} />
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <Text style={{ color: MUTED, fontSize: 15, fontFamily: 'Inter_400Regular', marginBottom: 16 }}>
            {isError ? "Couldn't load this club." : 'Club not found.'}
          </Text>
          {isError && (
            <TouchableOpacity
              onPress={() => refetch()}
              activeOpacity={0.8}
              style={{
                paddingHorizontal: 22,
                paddingVertical: 10,
                borderRadius: 22,
                backgroundColor: TEAL,
              }}
            >
              <Text style={{ color: CREAM, fontSize: 14, fontFamily: 'Inter_600SemiBold' }}>
                Try again
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
    );
  }

  const eventDates = club.upcoming_events.map((e) => e.event_date);

  function handlePhotoPress(photo: ClubPhoto) {
    const idx = club!.photos.findIndex((p) => p.id === photo.id);
    setSelectedPhotoIndex(idx >= 0 ? idx : 0);
    setPhotoViewerVisible(true);
  }

  function handleOpenPost(postId: string) {
    setPhotoViewerVisible(false);
    router.push({ pathname: '/post/[postId]', params: { postId } });
  }

  function handleCalendarDayPress(eventId: string) {
    router.push({
      pathname: '/(tabs)/clubs/[clubId]/events/[eventId]',
      params: { clubId: clubId!, eventId },
    });
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: CREAM }} edges={['top']}>
      {ToastComponent}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={TEAL} />
        }
      >
        {/* ── Banner + back arrow ───────────────────────────── */}
        <View style={{ position: 'relative' }}>
          {club.banner_url ? (
            <Image
              source={{ uri: club.banner_url }}
              style={{ width: '100%', height: 200 }}
              resizeMode="cover"
            />
          ) : (
            <View style={{ width: '100%', height: 200, backgroundColor: '#D1D5DB' }} />
          )}

          {/* Back arrow */}
          <TouchableOpacity
            onPress={() => router.back()}
            activeOpacity={0.7}
            style={{
              position: 'absolute',
              top: 12,
              left: 12,
              backgroundColor: 'rgba(255,255,255,0.85)',
              borderRadius: 20,
              padding: 8,
            }}
          >
            <Ionicons name="chevron-back" size={22} color={INK} />
          </TouchableOpacity>

          {/* Report ⋯ button */}
          <TouchableOpacity
            onPress={() => Alert.alert('Report', 'Do you want to report this club?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Report', style: 'destructive' },
            ])}
            activeOpacity={0.7}
            style={{
              position: 'absolute',
              top: 12,
              right: isOfficer ? 60 : 12,
              backgroundColor: 'rgba(255,255,255,0.85)',
              borderRadius: 20,
              padding: 8,
            }}
          >
            <Ionicons name="ellipsis-horizontal" size={20} color={INK} />
          </TouchableOpacity>

          {/* Officer edit button */}
          {isOfficer && (
            <TouchableOpacity
              onPress={() =>
                router.push({
                  pathname: '/(tabs)/clubs/[clubId]/edit',
                  params: { clubId: clubId! },
                })
              }
              activeOpacity={0.7}
              style={{
                position: 'absolute',
                top: 12,
                right: 12,
                backgroundColor: TEAL,
                borderRadius: 20,
                paddingHorizontal: 14,
                paddingVertical: 8,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <Ionicons name="pencil" size={14} color={CREAM} />
              <Text style={{ fontSize: 13, fontWeight: '600', color: CREAM, fontFamily: 'Inter_600SemiBold' }}>
                Edit
              </Text>
            </TouchableOpacity>
          )}

          {/* Club avatar overlapping banner */}
          <View
            style={{
              position: 'absolute',
              bottom: -34,
              left: 16,
              borderWidth: 3,
              borderColor: CREAM,
              borderRadius: 38,
              overflow: 'hidden',
            }}
          >
            <Avatar uri={club.avatar_url} size={68} username={club.name} />
          </View>
        </View>

        {/* ── Club name + member count ───────────────────────── */}
        <View style={{ paddingHorizontal: 16, paddingTop: 46, marginBottom: 12 }}>
          <Text
            style={{ fontSize: 22, fontWeight: '800', color: INK, fontFamily: 'Zain_800ExtraBold' }}
          >
            {club.name}
          </Text>
          <TouchableOpacity
            onPress={() =>
              router.push({ pathname: '/(tabs)/clubs/[clubId]/members', params: { clubId: clubId! } })
            }
            activeOpacity={0.7}
            hitSlop={{ top: 4, bottom: 4, left: 0, right: 20 }}
          >
            <Text
              style={{
                fontSize: 12,
                color: MUTED,
                fontFamily: 'Inter_400Regular',
                marginTop: 2,
                lineHeight: 20,
                letterSpacing: 0.38,
              }}
            >
              {club.member_count} Members
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── Action buttons ─────────────────────────────────── */}
        <View style={{ paddingHorizontal: 16, marginBottom: 14 }}>
          {/* Join / Joined + Chat row */}
          <View style={{ flexDirection: 'row', gap: 12, marginBottom: isOfficer ? 10 : 0 }}>
            <TouchableOpacity
              onPress={handleJoinLeave}
              disabled={joining || leaving}
              activeOpacity={0.85}
              style={{
                flex: 1,
                paddingVertical: 12,
                borderRadius: 25,
                backgroundColor: club.is_member ? 'rgba(15,166,166,0.1)' : TEAL,
                borderWidth: club.is_member ? 1.5 : 0,
                borderColor: TEAL,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: joining || leaving ? 0.65 : 1,
              }}
            >
              <Text
                style={{
                  fontSize: 15,
                  fontWeight: '600',
                  color: club.is_member ? TEAL : CREAM,
                  fontFamily: 'Inter_600SemiBold',
                }}
              >
                {club.is_member ? 'Joined ✓' : 'Join'}
              </Text>
            </TouchableOpacity>

            {club.is_member && (
              <TouchableOpacity
                onPress={() => void openClubChat(clubId!)}
                activeOpacity={0.85}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 25,
                  backgroundColor: 'transparent',
                  borderWidth: 1.5,
                  borderColor: TEAL,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <Ionicons name="chatbubble-outline" size={16} color={TEAL} />
                <Text style={{ fontSize: 15, fontWeight: '600', color: TEAL, fontFamily: 'Inter_600SemiBold' }}>
                  Chat
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Admin Chat button — officers only */}
          {isOfficer && (
            <TouchableOpacity
              onPress={() => void openOfficerChat(clubId!)}
              activeOpacity={0.85}
              style={{
                paddingVertical: 12,
                borderRadius: 25,
                borderWidth: 1.5,
                borderColor: TEAL,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <Ionicons name="star-outline" size={16} color={TEAL} />
              <Text style={{ fontSize: 15, fontWeight: '600', color: TEAL, fontFamily: 'Inter_600SemiBold' }}>
                Admin Chat
              </Text>
            </TouchableOpacity>
          )}

          {/* Non-member hint */}
          {!club.is_member && (
            <View
              style={{
                marginTop: 12,
                backgroundColor: 'rgba(15,166,166,0.08)',
                borderRadius: 10,
                padding: 12,
                borderWidth: 1,
                borderColor: 'rgba(15,166,166,0.2)',
              }}
            >
              <Text style={{ fontSize: 13, color: TEAL, textAlign: 'center', fontFamily: 'Inter_500Medium' }}>
                Join this club to chat and see upcoming events
              </Text>
            </View>
          )}
        </View>

        {/* ── Gluemates Row ──────────────────────────────────── */}
        {club.gluemates_count > 0 && (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() =>
              router.push({
                pathname: '/(tabs)/clubs/[clubId]/members',
                params: { clubId: clubId!, filter: 'gluemates' },
              })
            }
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 16,
              marginBottom: 20,
              gap: 8,
            }}
          >
            <AvatarStack
              avatars={club.gluemates.map((g) => ({ id: g.id, avatar_url: g.avatar_url }))}
              size={28}
              overlap={12}
              borderWidth={1.5}
            />
            <Text
              style={{
                fontSize: 12,
                color: INK,
                fontFamily: 'Inter_700Bold',
                letterSpacing: 0.38,
              }}
            >
              {club.gluemates_count} Gluemates
            </Text>
          </TouchableOpacity>
        )}

        {/* ── About Section ──────────────────────────────────── */}
        <View style={{ paddingHorizontal: 16, marginBottom: 24 }}>
          <Text
            style={{
              fontSize: 14,
              fontWeight: '700',
              color: INK,
              fontFamily: 'Inter_700Bold',
              marginBottom: 8,
            }}
          >
            About
          </Text>
          {club.description ? (
            <Text
              style={{
                fontSize: 13,
                color: INK,
                fontFamily: 'Inter_600SemiBold',
                lineHeight: 20,
                marginBottom: club.goals.length > 0 ? 8 : 0,
              }}
            >
              {club.description}
            </Text>
          ) : null}
          {club.goals.map((goal) => (
            <View key={goal.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
              <View
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 3,
                  backgroundColor: TEAL,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginTop: 1,
                }}
              >
                <Ionicons name="checkmark" size={12} color={CREAM} />
              </View>
              <Text style={{ flex: 1, fontSize: 13, color: INK, fontFamily: 'Inter_600SemiBold', lineHeight: 18 }}>
                {goal.goal_text}
              </Text>
            </View>
          ))}
        </View>

        {/* ── Meeting Schedule ───────────────────────────────── */}
        {club.meeting_day && (
          <View style={{ paddingHorizontal: 16, marginBottom: 24 }}>
            <Text
              style={{
                fontSize: 14,
                fontWeight: '700',
                color: INK,
                fontFamily: 'Inter_700Bold',
                marginBottom: 8,
              }}
            >
              Meeting Schedule
            </Text>
            <View
              style={{
                backgroundColor: CREAM,
                borderRadius: 10,
                padding: 14,
                ...CARD_SHADOW,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Ionicons name="calendar-outline" size={16} color={TEAL} />
                <Text style={{ fontSize: 13, color: INK, fontFamily: 'Inter_700Bold' }}>
                  {club.meeting_day}{' '}
                  {formatMeetingTime(club.meeting_time_start, club.meeting_time_end)}
                </Text>
              </View>
              {(club.meeting_building || club.meeting_room || club.meeting_location) && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="location-outline" size={16} color={TEAL} />
                  <Text style={{ fontSize: 13, color: INK, fontFamily: 'Inter_700Bold' }}>
                    {[club.meeting_building, club.meeting_room, club.meeting_location]
                      .filter(Boolean)
                      .join(', ')}
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* ── Upcoming Events ────────────────────────────────── */}
        {club.upcoming_events.length > 0 && (
          <View style={{ paddingHorizontal: 16, marginBottom: 24 }}>
            <Text
              style={{
                fontSize: 14,
                fontWeight: '700',
                color: INK,
                fontFamily: 'Inter_700Bold',
                marginBottom: 10,
              }}
            >
              Upcoming Events
            </Text>
            {club.upcoming_events.map((event) => (
              <UpcomingEventRow key={event.id} event={event} clubId={clubId!} />
            ))}
          </View>
        )}

        {/* ── Photos that Glue ───────────────────────────────── */}
        {club.photos.length > 0 && (
          <View style={{ paddingHorizontal: 16, marginBottom: 24 }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 10,
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '700', color: INK, fontFamily: 'Inter_700Bold' }}>
                Photos that Glue
              </Text>
              <TouchableOpacity
                onPress={() =>
                  router.push({
                    pathname: '/(tabs)/clubs/[clubId]/photos',
                    params: { clubId: clubId! },
                  })
                }
                activeOpacity={0.7}
              >
                <Text style={{ fontSize: 13, color: TEAL, fontFamily: 'Inter_500Medium' }}>See all</Text>
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
              {club.photos.slice(0, 9).map((photo) => (
                <TouchableOpacity
                  key={photo.id}
                  onPress={() => handlePhotoPress(photo)}
                  activeOpacity={0.85}
                >
                  <Image
                    source={{ uri: photo.url }}
                    style={{ width: PHOTO_SIZE, height: PHOTO_SIZE, borderRadius: 8, backgroundColor: '#E5E7EB' }}
                    resizeMode="cover"
                  />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* ── Mini Calendar ──────────────────────────────────── */}
        {eventDates.length > 0 && (
          <View style={{ paddingHorizontal: 16, marginBottom: 24 }}>
            <Text
              style={{
                fontSize: 14,
                fontWeight: '700',
                color: INK,
                fontFamily: 'Inter_700Bold',
                marginBottom: 10,
              }}
            >
              Calendar
            </Text>
            <MiniCalendar events={club.upcoming_events} onDayPress={handleCalendarDayPress} />
          </View>
        )}

        {/* ── Officers ───────────────────────────────────────── */}
        {club.officers.length > 0 && (
          <View style={{ paddingHorizontal: 16, marginBottom: 24 }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: INK, fontFamily: 'Inter_700Bold', marginBottom: 10 }}>
              Officers
            </Text>
            {club.officers.map((officer) => (
              <OfficerRow key={officer.id} officer={officer} />
            ))}
          </View>
        )}
      </ScrollView>

      {/* ── Photo Gallery Modal — swipes through all "Photos that Glue", tagged-post
          photos show caption/likes/comments and can open the full post ── */}
      <PhotoGalleryModal
        visible={photoViewerVisible}
        photos={club.photos}
        initialIndex={selectedPhotoIndex}
        viewerUserId={userId ?? ''}
        onClose={() => setPhotoViewerVisible(false)}
        onOpenPost={handleOpenPost}
      />

      <LeaveClubModals
        target={leaveTarget}
        loading={leaving}
        onConfirm={() => confirmLeave(() => router.back())}
        onCancel={cancelLeave}
      />
    </SafeAreaView>
  );
}
