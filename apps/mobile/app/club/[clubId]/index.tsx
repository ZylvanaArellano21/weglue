import { useCallback, useState, type ReactNode } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  Dimensions,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { useClubProfile } from '../../../hooks/useClubProfile';
import { useJoinClubMutation } from '../../../hooks/useClubMembership';
import { useOfficerStore } from '../../../store/officerStore';
import { Avatar } from '../../../components/shared/Avatar';
import { AvatarStack } from '../../../components/shared/AvatarStack';
import { Skeleton } from '../../../components/shared/SkeletonLoader';
import { useToast } from '../../../components/Toast';
import { requestLeaveClub } from '../../../store/leaveClubStore';
import { ReportButton } from '../../../components/shared/ReportButton';
import type { ClubUpcomingEvent, ClubPhoto, ClubOfficer } from '../../../services/clubService';
import { openClubChat, openOfficerChat, openDirectChatWith } from '../../../lib/chatNavigation';
import { todayInAppTz } from '../../../lib/timezone';
import { formatEventLocation, openEventOrExplain } from '../../../lib/eventDisplay';
import { parseMeetingSchedule, groupScheduleForDisplay } from '../../../lib/meetingSchedule';

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

// ─── Section shell ────────────────────────────────────────────────────────────
// Permanent product rule: every club profile renders the same major sections.
// A section with no data keeps its title and shows a calm gray empty state so
// officers can see the space they can fill later — sections never disappear.
function Section({
  title,
  emptyText,
  isEmpty,
  headerRight,
  headerAction,
  children,
}: {
  title: string;
  emptyText: string;
  isEmpty: boolean;
  /** Controls that only make sense with content (e.g. "See all"). */
  headerRight?: ReactNode;
  /** Controls that must stay reachable even when the section is empty —
   *  an officer needs the club's "+ Post" action precisely when there are no
   *  photos yet. */
  headerAction?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <View style={{ paddingHorizontal: 16, marginBottom: 24 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <Text style={{ fontSize: 14, fontWeight: '700', color: INK, fontFamily: 'Inter_700Bold' }}>
          {title}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          {headerAction}
          {!isEmpty && headerRight}
        </View>
      </View>
      {isEmpty ? (
        <Text style={{ fontSize: 13, color: '#9CA3AF', fontFamily: 'Inter_400Regular' }}>
          {emptyText}
        </Text>
      ) : (
        children
      )}
    </View>
  );
}

// ─── Mini Calendar ────────────────────────────────────────────────────────────
// Figma "May 2023" calendar card, replicated exactly for every club profile:
// chunky month title on the left with both nav chevrons grouped on the right,
// bold weekday labels, a hairline-bordered table grid, adjacent-month days as
// gray-filled cells, today as a teal rounded square, and event days marked
// with a teal underline bar. Days with events (past or future) are tappable.
const CAL_GRID_LINE = '#EDEBE9';
const CAL_OUT_MONTH_BG = '#EFF0F4';
const CAL_OUT_MONTH_TEXT = '#9CA3AF';

function MiniCalendar({
  events,
  onDayPress,
}: {
  events: ClubUpcomingEvent[];
  onDayPress: (eventId: string) => void;
}) {
  // Anchor "this month" on the app timezone, not the device timezone.
  const [todayY, todayM] = todayInAppTz().split('-').map(Number);
  const [viewYear, setViewYear] = useState(todayY);
  const [viewMonth, setViewMonth] = useState(todayM - 1);

  // A members-only preview may mark a date, but it must not become a hidden
  // detail deep link for a non-member.
  const eventIdByDate = new Map<string, string>();
  for (const e of events) {
    if (e.can_open && !eventIdByDate.has(e.event_date)) {
      eventIdByDate.set(e.event_date, e.id);
    }
  }
  const todayStr = todayInAppTz();

  // Monday-first grid: getDay() is 0=Sunday, so (getDay()+6)%7 maps Monday→0
  // … Sunday→6. Pure calendar math on a local Date constructed from Y/M —
  // correct for months starting on any weekday.
  const leadingCount = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

  const monthName = new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  // Full grid incl. the design's gray adjacent-month cells: trailing days of
  // the previous month lead in, first days of the next month fill the last row.
  const cells: { day: number; inMonth: boolean }[] = [];
  for (let i = 0; i < leadingCount; i++) {
    cells.push({ day: daysInPrevMonth - leadingCount + 1 + i, inMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, inMonth: true });
  for (let d = 1; cells.length % 7 !== 0; d++) cells.push({ day: d, inMonth: false });

  const DAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  // Fixed one-seventh columns in absolute points (screen − section padding −
  // card padding, split 7 ways). Headers and day cells share the exact same
  // width so every date sits under its weekday and the first week can never
  // drift away from the rest of the month. Percentage widths are avoided on
  // purpose: they resolve inconsistently for cells inside the bordered grid.
  const CELL_WIDTH = Math.floor((SCREEN_WIDTH - 32 - 28) / 7);
  const GRID_WIDTH = CELL_WIDTH * 7;
  const HAIRLINE = StyleSheet.hairlineWidth;

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
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingTop: 16,
        paddingBottom: 18,
        ...CARD_SHADOW,
      }}
    >
      {/* Header: month title left, both chevrons grouped on the right */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
        }}
      >
        <Text style={{ fontSize: 19, fontWeight: '800', color: INK, fontFamily: 'Zain_800ExtraBold' }}>
          {monthName}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 22 }}>
          <TouchableOpacity onPress={prevMonth} activeOpacity={0.7} hitSlop={{ top: 10, left: 10, right: 8, bottom: 10 }}>
            <Ionicons name="chevron-back" size={16} color={INK} />
          </TouchableOpacity>
          <TouchableOpacity onPress={nextMonth} activeOpacity={0.7} hitSlop={{ top: 10, left: 8, right: 10, bottom: 10 }}>
            <Ionicons name="chevron-forward" size={16} color={INK} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Weekday labels — bold, dark, like the design */}
      <View style={{ flexDirection: 'row', width: GRID_WIDTH, alignSelf: 'center', marginBottom: 10 }}>
        {DAY_LABELS.map((d) => (
          <Text
            key={d}
            style={{
              width: CELL_WIDTH,
              textAlign: 'center',
              fontSize: 11,
              color: INK,
              fontFamily: 'Inter_700Bold',
            }}
          >
            {d}
          </Text>
        ))}
      </View>

      {/* Bordered table grid */}
      <View
        style={{
          width: GRID_WIDTH,
          alignSelf: 'center',
          borderTopWidth: HAIRLINE,
          borderLeftWidth: HAIRLINE,
          borderColor: CAL_GRID_LINE,
        }}
      >
        {Array.from({ length: cells.length / 7 }, (_, row) => (
          <View key={row} style={{ flexDirection: 'row' }}>
            {cells.slice(row * 7, row * 7 + 7).map((cell, col) => {
              const cellFrame = {
                width: CELL_WIDTH,
                height: 40,
                alignItems: 'center' as const,
                justifyContent: 'center' as const,
                borderRightWidth: HAIRLINE,
                borderBottomWidth: HAIRLINE,
                borderColor: CAL_GRID_LINE,
              };

              if (!cell.inMonth) {
                return (
                  <View key={col} style={{ ...cellFrame, backgroundColor: CAL_OUT_MONTH_BG }}>
                    <Text style={{ fontSize: 13, color: CAL_OUT_MONTH_TEXT, fontFamily: 'Inter_400Regular' }}>
                      {cell.day}
                    </Text>
                  </View>
                );
              }

              const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(cell.day).padStart(2, '0')}`;
              const isToday = dateStr === todayStr;
              const eventId = eventIdByDate.get(dateStr);
              const hasEvent = !!eventId;

              return (
                <TouchableOpacity
                  key={col}
                  disabled={!hasEvent}
                  onPress={() => eventId && onDayPress(eventId)}
                  activeOpacity={0.5}
                  // Static style object on purpose: function styles get
                  // swallowed by the NativeWind JSX runtime here, collapsing
                  // the cells to content width.
                  style={cellFrame}
                >
                  {isToday ? (
                    <View
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 6,
                        backgroundColor: TEAL,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Text style={{ fontSize: 13, color: CREAM, fontFamily: 'Inter_700Bold' }}>
                        {cell.day}
                      </Text>
                    </View>
                  ) : (
                    <Text style={{ fontSize: 13, color: INK, fontFamily: 'Inter_500Medium' }}>
                      {cell.day}
                    </Text>
                  )}
                  {hasEvent && (
                    <View
                      style={{
                        width: 14,
                        height: 3,
                        borderRadius: 1.5,
                        backgroundColor: TEAL,
                        marginTop: 2,
                      }}
                    />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Club Event Card ──────────────────────────────────────────────────────────
// Figma "Club profile" card: large left image filling the card height, red
// "Members only" banner hanging from the top edge, bold title, calendar +
// location rows, right chevron — the whole card is one tappable 3D button.
// Used for both Upcoming Events and Past Events.
function ClubEventCard({
  event,
  clubId,
  clubName,
  onRestricted,
}: {
  event: ClubUpcomingEvent;
  clubId: string;
  clubName?: string | null;
  onRestricted: (message: string) => void;
}) {
  const router = useRouter();
  const isRestricted = event.visibility === 'members' || event.visibility === 'specific';
  const locationText = formatEventLocation(event.building, event.room, event.location);

  return (
    <TouchableOpacity
      onPress={() =>
        openEventOrExplain({
          canOpen: event.can_open,
          clubName,
          onRestricted,
          onOpen: () =>
            router.push({
              pathname: '/club/[clubId]/events/[eventId]',
              params: { clubId, eventId: event.id },
            }),
        })
      }
      activeOpacity={0.7}
      // overflow:'hidden' would clip the iOS shadow (masksToBounds), killing
      // the 3D button look — so the card keeps its shadow and only the image
      // column clips itself to the card's left radius.
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: CREAM,
        borderRadius: 12,
        marginBottom: 14,
        minHeight: 96,
        ...CARD_SHADOW,
      }}
    >
      <View
        style={{
          width: 128,
          alignSelf: 'stretch',
          backgroundColor: '#E5E7EB',
          borderTopLeftRadius: 12,
          borderBottomLeftRadius: 12,
          overflow: 'hidden',
        }}
      >
        {event.cover_image_url ? (
          // Absolutely filled so the image adopts the card's content-driven
          // height instead of its own intrinsic size stretching the card.
          <Image
            source={{ uri: event.cover_image_url }}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            resizeMode="cover"
          />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="calendar-outline" size={30} color={MUTED} />
          </View>
        )}
        {isRestricted && (
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 22,
              backgroundColor: ALERT_RED,
              borderBottomLeftRadius: 4,
              borderBottomRightRadius: 4,
              paddingHorizontal: 10,
              paddingVertical: 4,
            }}
          >
            <Text style={{ fontSize: 11, color: '#FFFFFF', fontFamily: 'Inter_700Bold' }}>
              {event.visibility === 'specific' ? 'Selected members only' : 'Members only'}
            </Text>
          </View>
        )}
      </View>
      <View style={{ flex: 1, paddingHorizontal: 14, paddingVertical: 12, justifyContent: 'center' }}>
        <Text
          style={{ fontSize: 15, fontWeight: '700', color: INK, fontFamily: 'Inter_700Bold', marginBottom: 6 }}
          numberOfLines={1}
        >
          {event.emoji ? `${event.emoji} ` : ''}{event.title}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 4 }}>
          <Ionicons name="calendar-outline" size={15} color={MUTED} style={{ marginTop: 1 }} />
          <View>
            <Text style={{ fontSize: 12, color: MUTED, fontFamily: 'Inter_500Medium' }}>
              {formatDate(event.event_date)}
            </Text>
            <Text style={{ fontSize: 12, color: MUTED, fontFamily: 'Inter_500Medium' }}>
              {formatTime(event.start_time)} - {formatTime(event.end_time)}
            </Text>
          </View>
        </View>
        {locationText ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="location-outline" size={15} color={MUTED} />
            <Text style={{ fontSize: 12, color: MUTED, fontFamily: 'Inter_500Medium' }} numberOfLines={1}>
              {locationText}
            </Text>
          </View>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={22} color={INK} style={{ marginRight: 12 }} />
    </TouchableOpacity>
  );
}

// ─── Officer Row ──────────────────────────────────────────────────────────────
// `currentUserId` decides self vs. other by authenticated user id — never by
// username/display-name text, which can change. Your own officer row shows no
// Message action.
function OfficerRow({ officer, currentUserId }: { officer: ClubOfficer; currentUserId?: string }) {
  const router = useRouter();
  const isSelf = !!officer.user_id && officer.user_id === currentUserId;

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
      {!isSelf && (
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
      )}
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

  const { data: club, isLoading, isError, refetch } = useClubProfile(clubId, userId);
  const { mutate: join, isPending: joining } = useJoinClubMutation(userId);
  // App-wide leave flow (LeaveClubHost in the root layout): eligibility is
  // checked server-side before exactly one modal mounts.

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
      requestLeaveClub({ clubId, clubName: club.name, onLeft: () => router.back() });
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

  // One event source drives Upcoming, Past AND the calendar — past events are
  // relocated to Past Events, never deleted, and always stay on the calendar.
  const allCalendarEvents = [...club.upcoming_events, ...club.past_events];

  // Direct tap and "See all" both land in the SAME vertical post viewer —
  // one stable post-viewing system, solid background, back returns exactly
  // here (the old transparent PhotoGalleryModal is gone).
  function handlePhotoPress(photo: ClubPhoto) {
    router.push({
      pathname: '/club/[clubId]/photos/viewer',
      params: { clubId: clubId!, photoId: photo.id, clubName: club?.name ?? '' },
    } as any);
  }

  function handleCalendarDayPress(eventId: string) {
    router.push({
      pathname: '/club/[clubId]/events/[eventId]',
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

          {/* Report ⋯ menu — bottom-right of the banner, clear of the Edit
              button (top-right) and the club avatar (bottom-left). */}
          <ReportButton
            entityType="club"
            entityId={clubId!}
            entityName={club.name}
            clubId={clubId}
            style={{ position: 'absolute', bottom: 12, right: 12 }}
          />

          {/* Officer edit button */}
          {isOfficer && (
            <TouchableOpacity
              onPress={() =>
                router.push({
                  pathname: '/club/[clubId]/edit',
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
              router.push({ pathname: '/club/[clubId]/members', params: { clubId: clubId! } })
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
              disabled={joining}
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
                opacity: joining ? 0.65 : 1,
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
                pathname: '/club/[clubId]/members',
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

        {/* ── About Section — always visible; learning outcomes (goals) live
            inside About, never as a separate section ──────────── */}
        <Section
          title="About"
          emptyText="No about yet"
          isEmpty={!club.description && club.goals.length === 0}
        >
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
        </Section>

        {/* ── Meeting Schedule — always visible; days sharing the same time
            are grouped onto one line ("Monday and Tuesday 10:00 AM - 11:00 AM"),
            location is one shared line for the whole schedule ──────────── */}
        {(() => {
          const scheduleSlots = parseMeetingSchedule(
            club.meeting_schedule,
            club.meeting_day,
            club.meeting_time_start,
            club.meeting_time_end,
          );
          const scheduleLines = groupScheduleForDisplay(scheduleSlots);
          const locationText = formatEventLocation(
            club.meeting_building,
            club.meeting_room,
            club.meeting_location,
          );
          return (
            <Section
              title="Meeting Schedule"
              emptyText="No weekly events yet"
              isEmpty={scheduleLines.length === 0}
            >
              <View
                style={{
                  backgroundColor: CREAM,
                  borderRadius: 10,
                  padding: 14,
                  ...CARD_SHADOW,
                }}
              >
                {scheduleLines.map((line, idx) => (
                  <View
                    key={`${line.daysLabel}-${idx}`}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'flex-start',
                      gap: 8,
                      marginBottom: idx === scheduleLines.length - 1 && !locationText ? 0 : 6,
                    }}
                  >
                    <Ionicons name="calendar-outline" size={16} color={TEAL} style={{ marginTop: 1 }} />
                    <Text style={{ flex: 1, fontSize: 13, color: INK, fontFamily: 'Inter_700Bold', lineHeight: 18 }}>
                      {line.daysLabel}
                      {line.timeLabel ? ` ${line.timeLabel}` : ''}
                    </Text>
                  </View>
                ))}
                {locationText ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Ionicons name="location-outline" size={16} color={TEAL} />
                    <Text style={{ fontSize: 13, color: INK, fontFamily: 'Inter_700Bold' }}>
                      {locationText}
                    </Text>
                  </View>
                ) : null}
              </View>
            </Section>
          );
        })()}

        {/* ── Upcoming Events — always visible ───────────────── */}
        <Section
          title="Upcoming Events"
          emptyText="No upcoming events yet"
          isEmpty={club.upcoming_events.length === 0}
        >
          {club.upcoming_events.map((event) => (
            <ClubEventCard
              key={event.id}
              event={event}
              clubId={clubId!}
              clubName={club?.name}
              onRestricted={(message) => show(message, 'error')}
            />
          ))}
        </Section>

        {/* ── Past Events — ended events relocate here, same card design ── */}
        <Section
          title="Past Events"
          emptyText="No past events yet"
          isEmpty={club.past_events.length === 0}
        >
          {club.past_events.map((event) => (
            <ClubEventCard
              key={event.id}
              event={event}
              clubId={clubId!}
              clubName={club?.name}
              onRestricted={(message) => show(message, 'error')}
            />
          ))}
        </Section>

        {/* ── Photos that Glue — always visible ──────────────── */}
        <Section
          title="Photos that Glue"
          emptyText="No photos yet"
          isEmpty={club.photos.length === 0}
          // Officer-only club-profile posting. Opens the SHARED New Post screen
          // with this club locked on, so the officer gets camera OR gallery plus
          // a caption and the club is attached permanently. The resulting post
          // lands in Home → Posts AND in this club profile — one post, not two.
          // A regular member has no button here and posts from Home, tagging
          // this club there. `headerAction` (not `headerRight`) so a club with
          // no photos yet still gives its officers a way to add the first one.
          headerAction={
            isOfficer ? (
              <TouchableOpacity
                onPress={() =>
                  router.push({
                    pathname: '/home/new-post',
                    params: { lockedClubId: clubId!, lockedClubName: club?.name ?? '' },
                  } as any)
                }
                activeOpacity={0.7}
                hitSlop={8}
                accessibilityLabel="Add a photo post to this club"
                style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}
              >
                <Ionicons name="add" size={16} color={TEAL} />
                <Text style={{ fontSize: 13, color: TEAL, fontFamily: 'Inter_500Medium' }}>Post</Text>
              </TouchableOpacity>
            ) : undefined
          }
          headerRight={
            <TouchableOpacity
              onPress={() =>
                router.push({
                  pathname: '/club/[clubId]/photos',
                  params: { clubId: clubId!, clubName: club?.name ?? '' },
                } as any)
              }
              activeOpacity={0.7}
            >
              <Text style={{ fontSize: 13, color: TEAL, fontFamily: 'Inter_500Medium' }}>See all</Text>
            </TouchableOpacity>
          }
        >
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
        </Section>

        {/* ── Mini Calendar — always visible; marks past AND future days ── */}
        <Section title="Calendar" emptyText="" isEmpty={false}>
          <MiniCalendar events={allCalendarEvents} onDayPress={handleCalendarDayPress} />
        </Section>

        {/* ── Officers ───────────────────────────────────────── */}
        {club.officers.length > 0 && (
          <View style={{ paddingHorizontal: 16, marginBottom: 24 }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: INK, fontFamily: 'Inter_700Bold', marginBottom: 10 }}>
              Officers
            </Text>
            {club.officers.map((officer) => (
              <OfficerRow key={officer.id} officer={officer} currentUserId={userId} />
            ))}
          </View>
        )}
      </ScrollView>

    </SafeAreaView>
  );
}
