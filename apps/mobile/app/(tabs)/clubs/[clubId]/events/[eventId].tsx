import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { useEventDetail, useRsvpMutation, useSaveEventMutation } from '../../../../../hooks/useEventDetail';
import { useJoinClubMutation, useLeaveClubMutation } from '../../../../../hooks/useClubMembership';
import { useRealtimeEventRsvps } from '../../../../../hooks/useRealtimeChannel';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar } from '../../../../../components/shared/Avatar';
import { AvatarStack } from '../../../../../components/shared/AvatarStack';
import { Skeleton } from '../../../../../components/shared/SkeletonLoader';
import { useToast } from '../../../../../components/Toast';
import { ConfirmModal } from '../../../../../components/ConfirmModal';
import { ShareSheet } from '../../../../../components/shared/ShareSheet';

export type ClubEventDetailParams = {
  clubId: string;
  eventId: string;
};

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

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function ClubEventDetailScreen() {
  const { clubId, eventId } = useLocalSearchParams<ClubEventDetailParams>();
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { show, ToastComponent } = useToast();

  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [shareSheetVisible, setShareSheetVisible] = useState(false);

  // Spring animation that fires once when RSVP buttons transition from locked → enabled
  const rsvpEnableAnim = useRef(new Animated.Value(1)).current;
  const prevJoinedRef = useRef<boolean | undefined>(undefined);

  const { data: event, isLoading } = useEventDetail(eventId, userId);
  const { mutate: rsvp, isPending: isRsvping } = useRsvpMutation(userId, eventId);
  const { mutate: toggleSave, isPending: isSaving } = useSaveEventMutation(userId, eventId);
  const { mutate: joinClubMutate, isPending: joiningClub } = useJoinClubMutation(userId);
  const { mutate: leaveClubMutate, isPending: leavingClub } = useLeaveClubMutation(userId);

  useRealtimeEventRsvps({
    eventId: eventId!,
    onRsvpChange: () => {
      queryClient.invalidateQueries({ queryKey: ['eventDetail', eventId, userId] });
    },
  });

  useEffect(() => {
    const joined = event?.user_has_joined_club;
    if (prevJoinedRef.current === false && joined === true) {
      Animated.sequence([
        Animated.spring(rsvpEnableAnim, { toValue: 1.05, useNativeDriver: true, friction: 4, tension: 120 }),
        Animated.spring(rsvpEnableAnim, { toValue: 1.0, useNativeDriver: true, friction: 4, tension: 120 }),
      ]).start();
    }
    prevJoinedRef.current = joined;
  }, [event?.user_has_joined_club]);

  const handleRsvp = (status: 'going' | 'cant') => {
    rsvp(status, {
      onSuccess: () =>
        show(status === 'going' ? "You're going! 🎉" : "Got it, maybe next time!", 'success'),
      onError: () => show('Failed to RSVP. Try again.', 'error'),
    });
  };

  const handleToggleSave = () => {
    toggleSave(undefined, {
      onSuccess: (saved: boolean) => show(saved ? 'Event saved!' : 'Removed from saved'),
      onError: () => show('Failed to save event.', 'error'),
    });
  };

  const handleJoinLeaveClub = () => {
    if (!event) return;
    if (event.user_has_joined_club) {
      setShowLeaveConfirm(true);
    } else {
      joinClubMutate(event.club_id, {
        onSuccess: () => show(`Joined ${event.club.name}! 🎉`),
        onError: () => show('Failed to join club.', 'error'),
      });
    }
  };

  const handleConfirmLeaveClub = () => {
    if (!event) return;
    setShowLeaveConfirm(false);
    leaveClubMutate(event.club_id, {
      onSuccess: () => show(`You left ${event.club.name}.`),
      onError: () => show('Failed to leave club.', 'error'),
    });
  };

  const handlePressClub = () => {
    if (event?.club_id) {
      router.push({ pathname: '/(tabs)/clubs/[clubId]', params: { clubId: event.club_id } });
    }
  };

  const handlePressAttendees = () => {
    if (event?.id) {
      router.push({ pathname: '/home/attendees', params: { eventId: event.id } });
    }
  };

  const handleReport = () => {
    Alert.alert('Report Event', 'Do you want to report this event?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Report', style: 'destructive' },
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FEFCF0' }} edges={['top']}>
      {ToastComponent}

      {/* Back Arrow */}
      <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
        <TouchableOpacity
          onPress={() => router.back()}
          activeOpacity={0.7}
          hitSlop={{ top: 10, left: 10, right: 10, bottom: 10 }}
        >
          <Ionicons name="chevron-back" size={26} color="#111827" />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={{ gap: 12, padding: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Skeleton width={36} height={36} borderRadius={18} />
              <Skeleton width={160} height={16} />
              <View style={{ flex: 1 }} />
              <Skeleton width={72} height={32} borderRadius={16} />
            </View>
            <Skeleton width="100%" height={220} borderRadius={12} />
            <Skeleton width="80%" height={24} />
            <Skeleton width="100%" height={90} borderRadius={12} />
            <Skeleton width="60%" height={16} />
            <Skeleton width="100%" height={60} borderRadius={12} />
          </View>
        </ScrollView>
      ) : !event ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <Ionicons name="calendar-outline" size={48} color="#D1D5DB" />
          <Text style={{ color: '#6B7280', fontSize: 15, fontFamily: 'Inter_400Regular' }}>
            Event not found.
          </Text>
          <TouchableOpacity
            onPress={() => router.back()}
            activeOpacity={0.7}
            style={{
              backgroundColor: '#0FA6A6',
              paddingHorizontal: 20,
              paddingVertical: 10,
              borderRadius: 20,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 14, fontFamily: 'Inter_600SemiBold' }}>Go back</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
          {/* ── Club Row ───────────────────────────────────── */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 16,
              paddingBottom: 10,
              gap: 10,
            }}
          >
            <TouchableOpacity onPress={handlePressClub} activeOpacity={0.7}>
              <Avatar uri={event.club.avatar_url} size={36} username={event.club.name} />
            </TouchableOpacity>
            <TouchableOpacity onPress={handlePressClub} style={{ flex: 1 }} activeOpacity={0.7}>
              <Text
                style={{
                  fontSize: 15,
                  fontWeight: '600',
                  color: '#111827',
                  fontFamily: 'Inter_600SemiBold',
                }}
              >
                {event.club.name}
              </Text>
            </TouchableOpacity>

            {/* Report button */}
            <TouchableOpacity onPress={handleReport} activeOpacity={0.7} style={{ marginRight: 8 }}>
              <Ionicons name="ellipsis-horizontal" size={20} color="#6B7280" />
            </TouchableOpacity>

            {/* Join/Joined button */}
            {joiningClub || leavingClub ? (
              <ActivityIndicator size="small" color="#0FA6A6" />
            ) : (
              <TouchableOpacity
                onPress={handleJoinLeaveClub}
                activeOpacity={0.8}
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 7,
                  borderRadius: 20,
                  backgroundColor: event.user_has_joined_club ? 'transparent' : '#0FA6A6',
                  borderWidth: event.user_has_joined_club ? 1.5 : 0,
                  borderColor: '#0FA6A6',
                }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: '600',
                    color: event.user_has_joined_club ? '#0FA6A6' : '#fff',
                    fontFamily: 'Inter_600SemiBold',
                  }}
                >
                  {event.user_has_joined_club ? 'Joined' : 'Join'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* ── Hero Image ─────────────────────────────────── */}
          {event.cover_image_url ? (
            <Image
              source={{ uri: event.cover_image_url }}
              style={{ width: '100%', height: 220 }}
              resizeMode="cover"
            />
          ) : (
            <View
              style={{
                width: '100%',
                height: 220,
                backgroundColor: '#E5E7EB',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="image-outline" size={50} color="#9CA3AF" />
            </View>
          )}

          <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
            {/* ── Title ──────────────────────────────────── */}
            <Text
              style={{
                fontSize: 22,
                fontWeight: '800',
                color: '#111827',
                fontFamily: 'Zain_800ExtraBold',
                marginBottom: 16,
              }}
            >
              {event.emoji ? `${event.emoji} ` : ''}{event.title}
            </Text>

            {/* ── Date & Time + Location card ────────────── */}
            <View
              style={{
                backgroundColor: '#fff',
                borderRadius: 14,
                padding: 14,
                marginBottom: 16,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 1 },
                shadowOpacity: 0.05,
                shadowRadius: 6,
                elevation: 2,
              }}
            >
              <Text
                style={{
                  fontSize: 11,
                  color: '#9CA3AF',
                  fontFamily: 'Inter_400Regular',
                  marginBottom: 4,
                }}
              >
                Date &amp; Time
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                <Ionicons name="calendar-outline" size={18} color="#374151" />
                <Text
                  style={{
                    fontSize: 15,
                    fontWeight: '700',
                    color: '#111827',
                    fontFamily: 'Inter_700Bold',
                  }}
                >
                  {formatDate(event.event_date)}
                </Text>
              </View>
              <Text
                style={{
                  fontSize: 14,
                  color: '#374151',
                  fontFamily: 'Inter_400Regular',
                  marginLeft: 26,
                  marginBottom: event.location ? 12 : 0,
                }}
              >
                {formatTime(event.start_time)} - {formatTime(event.end_time)}
              </Text>

              {event.location && (
                <>
                  <Text
                    style={{
                      fontSize: 11,
                      color: '#9CA3AF',
                      fontFamily: 'Inter_400Regular',
                      marginBottom: 4,
                    }}
                  >
                    Location
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Ionicons name="location-outline" size={18} color="#374151" />
                    <Text style={{ fontSize: 14, color: '#111827', fontFamily: 'Inter_400Regular' }}>
                      {event.location}
                    </Text>
                  </View>
                </>
              )}
            </View>

            {/* ── Attendees Row ─────────────────────────── */}
            <TouchableOpacity
              onPress={handlePressAttendees}
              activeOpacity={0.7}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 }}
            >
              {event.attendee_preview.length > 0 && (
                <AvatarStack avatars={event.attendee_preview} size={30} overlap={8} />
              )}
              <View>
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: '700',
                    color: '#111827',
                    fontFamily: 'Inter_700Bold',
                  }}
                >
                  {event.attendee_count} going
                </Text>
                <Text style={{ fontSize: 12, color: '#9CA3AF', fontFamily: 'Inter_400Regular' }}>
                  Be part of the community
                </Text>
              </View>
            </TouchableOpacity>

            {/* ── About ─────────────────────────────────── */}
            {event.description ? (
              <>
                <Text
                  style={{
                    fontSize: 16,
                    fontWeight: '700',
                    color: '#111827',
                    fontFamily: 'Zain_700Bold',
                    marginBottom: 8,
                  }}
                >
                  About this event
                </Text>
                <Text
                  style={{
                    fontSize: 14,
                    color: '#374151',
                    lineHeight: 22,
                    fontFamily: 'Inter_400Regular',
                    marginBottom: 20,
                  }}
                >
                  {event.description}
                </Text>
              </>
            ) : null}

            {/* ── Share + Bookmark row ──────────────────── */}
            <View style={{ flexDirection: 'row', gap: 16, marginBottom: 20 }}>
              <TouchableOpacity onPress={() => setShareSheetVisible(true)} activeOpacity={0.7}>
                <Ionicons name="paper-plane-outline" size={26} color="#0FA6A6" />
              </TouchableOpacity>
              <TouchableOpacity onPress={handleToggleSave} disabled={isSaving} activeOpacity={0.7}>
                <Ionicons
                  name={event.is_saved ? 'bookmark' : 'bookmark-outline'}
                  size={26}
                  color="#0FA6A6"
                />
              </TouchableOpacity>
            </View>

            {/* ── RSVP Section ──────────────────────────── */}
            {(() => {
              const isRestricted =
                event.visibility === 'members' || event.visibility === 'specific';
              const rsvpBlocked = isRestricted && !event.user_has_joined_club;

              return (
                <>
                  <Text
                    style={{
                      fontSize: 14,
                      fontWeight: '600',
                      color: '#374151',
                      fontFamily: 'Inter_600SemiBold',
                      marginBottom: 12,
                    }}
                  >
                    Are you coming?
                  </Text>
                  <Animated.View
                    style={{ flexDirection: 'row', gap: 12, transform: [{ scale: rsvpEnableAnim }] }}
                  >
                    <TouchableOpacity
                      onPress={() => !rsvpBlocked && handleRsvp('going')}
                      disabled={isRsvping || rsvpBlocked}
                      activeOpacity={rsvpBlocked ? 1 : 0.8}
                      style={{
                        flex: 1,
                        paddingVertical: 13,
                        borderRadius: 14,
                        backgroundColor: rsvpBlocked
                          ? '#D1D5DB'
                          : event.user_rsvp_status === 'going'
                          ? '#0FA6A6'
                          : 'transparent',
                        borderWidth: rsvpBlocked ? 0 : 1.5,
                        borderColor: event.user_rsvp_status === 'going' ? '#0FA6A6' : '#D1D5DB',
                        alignItems: 'center',
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 15,
                          fontWeight: '600',
                          color: rsvpBlocked
                            ? '#9CA3AF'
                            : event.user_rsvp_status === 'going'
                            ? '#fff'
                            : '#374151',
                          fontFamily: 'Inter_600SemiBold',
                        }}
                      >
                        Going
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => !rsvpBlocked && handleRsvp('cant')}
                      disabled={isRsvping || rsvpBlocked}
                      activeOpacity={rsvpBlocked ? 1 : 0.8}
                      style={{
                        flex: 1,
                        paddingVertical: 13,
                        borderRadius: 14,
                        backgroundColor: rsvpBlocked
                          ? '#D1D5DB'
                          : event.user_rsvp_status === 'cant'
                          ? '#0FA6A6'
                          : 'transparent',
                        borderWidth: rsvpBlocked ? 0 : 1.5,
                        borderColor: event.user_rsvp_status === 'cant' ? '#0FA6A6' : '#D1D5DB',
                        alignItems: 'center',
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 15,
                          fontWeight: '600',
                          color: rsvpBlocked
                            ? '#9CA3AF'
                            : event.user_rsvp_status === 'cant'
                            ? '#fff'
                            : '#374151',
                          fontFamily: 'Inter_600SemiBold',
                        }}
                      >
                        Can't
                      </Text>
                    </TouchableOpacity>
                  </Animated.View>
                  {rsvpBlocked && (
                    <Text
                      style={{
                        fontSize: 12,
                        color: '#9CA3AF',
                        fontFamily: 'Inter_400Regular',
                        textAlign: 'center',
                        marginTop: 10,
                      }}
                    >
                      Join the club to RSVP
                    </Text>
                  )}
                </>
              );
            })()}
          </View>
        </ScrollView>
      )}

      {event && (
        <>
          <ConfirmModal
            visible={showLeaveConfirm}
            title={`Are you sure you want to leave ${event.club.name}?`}
            message="You'll lose access to club chats and updates."
            confirmLabel="Yes, Leave"
            cancelLabel="No"
            destructive
            loading={leavingClub}
            onConfirm={handleConfirmLeaveClub}
            onCancel={() => setShowLeaveConfirm(false)}
          />
          <ShareSheet
            visible={shareSheetVisible}
            onClose={() => setShareSheetVisible(false)}
            userId={userId}
            contentType="event"
            contentId={event.id}
            onShowToast={show}
          />
        </>
      )}
    </SafeAreaView>
  );
}
