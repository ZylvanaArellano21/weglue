import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  Dimensions,
  Modal,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { useClubProfile, useJoinClub, useLeaveClub } from '../../../../hooks/useClubProfile';
import { Avatar } from '../../../../components/shared/Avatar';
import { AvatarStack } from '../../../../components/shared/AvatarStack';
import { Skeleton } from '../../../../components/shared/SkeletonLoader';
import { useToast } from '../../../../components/Toast';
import type { ClubUpcomingEvent, ClubPhoto, ClubOfficer } from '../../../../services/clubService';

const SCREEN_WIDTH = Dimensions.get('window').width;
const PHOTO_SIZE = (SCREEN_WIDTH - 32 - 8) / 3;

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

export default function ClubProfileScreen() {
  const { clubId } = useLocalSearchParams<{ clubId: string }>();
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const router = useRouter();
  const { show, ToastComponent } = useToast();

  const [photoViewerVisible, setPhotoViewerVisible] = useState(false);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);

  const { data: club, isLoading } = useClubProfile(clubId, userId);
  const { mutate: join, isPending: joining } = useJoinClub(userId, clubId);
  const { mutate: leave, isPending: leaving } = useLeaveClub(userId, clubId);

  const handleJoinLeave = () => {
    if (club?.is_member) {
      Alert.alert(
        `Leave ${club.name}?`,
        'You will be removed from all club chats and will no longer receive updates from this club.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Leave Club',
            style: 'destructive',
            onPress: () =>
              leave(undefined, {
                onSuccess: () => {
                  show('Left club.');
                  router.back();
                },
                onError: () => show('Failed to leave club.', 'error'),
              }),
          },
        ],
      );
    } else {
      join(undefined, {
        onSuccess: () => show('Joined club! 🎉'),
        onError: () => show('Failed to join club.', 'error'),
      });
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#FEFCF0' }} edges={['top']}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 16 }} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={26} color="#111827" />
        </TouchableOpacity>
        <View style={{ padding: 16, gap: 16 }}>
          <Skeleton width="100%" height={160} borderRadius={0} />
          <Skeleton width={200} height={20} />
          <Skeleton width={120} height={14} />
          <Skeleton width="100%" height={44} borderRadius={22} />
        </View>
      </SafeAreaView>
    );
  }

  if (!club) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#FEFCF0' }} edges={['top']}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 16 }} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={26} color="#111827" />
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#6B7280', fontSize: 15 }}>Club not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FEFCF0' }} edges={['top']}>
      {ToastComponent}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Banner + back arrow */}
        <View style={{ position: 'relative' }}>
          {club.banner_url ? (
            <Image
              source={{ uri: club.banner_url }}
              style={{ width: '100%', height: 160 }}
              resizeMode="cover"
            />
          ) : (
            <View style={{ width: '100%', height: 160, backgroundColor: '#D1D5DB' }} />
          )}

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
            <Ionicons name="chevron-back" size={22} color="#111827" />
          </TouchableOpacity>

          {/* Officer actions */}
          {club.is_member && (
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
                backgroundColor: 'rgba(255,255,255,0.85)',
                borderRadius: 20,
                padding: 8,
              }}
            >
              <Ionicons name="ellipsis-horizontal" size={20} color="#111827" />
            </TouchableOpacity>
          )}

          {/* Club avatar overlapping banner */}
          <View
            style={{
              position: 'absolute',
              bottom: -32,
              left: 16,
              borderWidth: 3,
              borderColor: '#FEFCF0',
              borderRadius: 36,
              overflow: 'hidden',
            }}
          >
            <Avatar uri={club.avatar_url} size={64} username={club.name} />
          </View>
        </View>

        {/* Club name + member count */}
        <View style={{ paddingHorizontal: 16, paddingTop: 44, marginBottom: 16 }}>
          <Text
            style={{ fontSize: 20, fontWeight: '800', color: '#111827', fontFamily: 'Zain_800ExtraBold' }}
          >
            {club.name}
          </Text>
          <Text style={{ fontSize: 14, color: '#9CA3AF', fontFamily: 'Inter_400Regular', marginTop: 2 }}>
            {club.member_count} Members
          </Text>
        </View>

        {/* Join/Joined + Chat buttons */}
        <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 16, marginBottom: 16 }}>
          <TouchableOpacity
            onPress={handleJoinLeave}
            disabled={joining || leaving}
            activeOpacity={0.85}
            style={{
              flex: 1,
              paddingVertical: 12,
              borderRadius: 25,
              backgroundColor: club.is_member ? 'transparent' : '#0FA6A6',
              borderWidth: club.is_member ? 1.5 : 0,
              borderColor: '#0FA6A6',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {joining || leaving ? (
              <ActivityIndicator size="small" color={club.is_member ? '#0FA6A6' : '#fff'} />
            ) : (
              <Text
                style={{
                  fontSize: 15,
                  fontWeight: '600',
                  color: club.is_member ? '#0FA6A6' : '#fff',
                  fontFamily: 'Inter_600SemiBold',
                }}
              >
                {club.is_member ? 'Joined' : 'Join'}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() =>
              router.push({
                pathname: '/(tabs)/clubs/[clubId]/channels',
                params: { clubId: clubId! },
              })
            }
            disabled={!club.is_member}
            activeOpacity={0.85}
            style={{
              flex: 1,
              paddingVertical: 12,
              borderRadius: 25,
              backgroundColor: 'transparent',
              borderWidth: 1.5,
              borderColor: club.is_member ? '#0FA6A6' : '#D1D5DB',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <Ionicons
              name="chatbubble-outline"
              size={16}
              color={club.is_member ? '#0FA6A6' : '#D1D5DB'}
            />
            <Text
              style={{
                fontSize: 15,
                fontWeight: '600',
                color: club.is_member ? '#0FA6A6' : '#D1D5DB',
                fontFamily: 'Inter_600SemiBold',
              }}
            >
              Chat
            </Text>
          </TouchableOpacity>
        </View>

        {/* Non-member hint */}
        {!club.is_member && (
          <View
            style={{
              marginHorizontal: 16,
              marginBottom: 16,
              backgroundColor: 'rgba(15,166,166,0.08)',
              borderRadius: 10,
              padding: 12,
              borderWidth: 1,
              borderColor: 'rgba(15,166,166,0.2)',
            }}
          >
            <Text
              style={{ fontSize: 13, color: '#0FA6A6', textAlign: 'center', fontFamily: 'Inter_500Medium' }}
            >
              Join this club to chat
            </Text>
          </View>
        )}

        {/* Gluemates Row */}
        {club.gluemates_count > 0 && (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() =>
              router.push({
                pathname: '/(tabs)/clubs/[clubId]/members',
                params: { clubId: clubId! },
              })
            }
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 16,
              marginBottom: 20,
              gap: 10,
            }}
          >
            <AvatarStack
              avatars={club.gluemates.map((g) => ({ id: g.id, avatar_url: g.avatar_url }))}
              size={30}
              overlap={8}
            />
            <Text
              style={{ fontSize: 14, fontWeight: '600', color: '#111827', fontFamily: 'Inter_600SemiBold' }}
            >
              {club.gluemates_count} Gluemates in this club
            </Text>
            <Ionicons name="chevron-forward" size={14} color="#9CA3AF" />
          </TouchableOpacity>
        )}

        {/* About Section */}
        <View style={{ paddingHorizontal: 16, marginBottom: 24 }}>
          <Text
            style={{
              fontSize: 16,
              fontWeight: '700',
              color: '#111827',
              fontFamily: 'Zain_700Bold',
              marginBottom: 8,
            }}
          >
            About
          </Text>
          <Text
            style={{
              fontSize: 14,
              color: '#374151',
              fontFamily: 'Inter_400Regular',
              lineHeight: 22,
              marginBottom: 12,
            }}
          >
            {club.description}
          </Text>
          {club.goals.map((goal) => (
            <View key={goal.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
              <View
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 4,
                  backgroundColor: 'rgba(15,166,166,0.15)',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginTop: 2,
                }}
              >
                <Ionicons name="checkmark" size={12} color="#0FA6A6" />
              </View>
              <Text
                style={{ flex: 1, fontSize: 13, color: '#374151', fontFamily: 'Inter_400Regular', lineHeight: 20 }}
              >
                {goal.goal_text}
              </Text>
            </View>
          ))}
        </View>

        {/* Meeting Schedule */}
        {club.meeting_day && (
          <View style={{ paddingHorizontal: 16, marginBottom: 24 }}>
            <Text
              style={{
                fontSize: 16,
                fontWeight: '700',
                color: '#111827',
                fontFamily: 'Zain_700Bold',
                marginBottom: 8,
              }}
            >
              Meeting Schedule
            </Text>
            <View
              style={{
                backgroundColor: '#fff',
                borderRadius: 12,
                padding: 14,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 1 },
                shadowOpacity: 0.05,
                shadowRadius: 4,
                elevation: 2,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Ionicons name="calendar-outline" size={16} color="#374151" />
                <Text style={{ fontSize: 14, color: '#111827', fontFamily: 'Inter_500Medium' }}>
                  {club.meeting_day}{' '}
                  {formatMeetingTime(club.meeting_time_start, club.meeting_time_end)}
                </Text>
              </View>
              {(club.meeting_building || club.meeting_room || club.meeting_location) && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="location-outline" size={16} color="#374151" />
                  <Text style={{ fontSize: 14, color: '#374151', fontFamily: 'Inter_400Regular' }}>
                    {[club.meeting_building, club.meeting_room, club.meeting_location]
                      .filter(Boolean)
                      .join(', ')}
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Upcoming Events */}
        {club.upcoming_events.length > 0 && (
          <View style={{ paddingHorizontal: 16, marginBottom: 24 }}>
            <Text
              style={{
                fontSize: 16,
                fontWeight: '700',
                color: '#111827',
                fontFamily: 'Zain_700Bold',
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

        {/* Photos that Glue */}
        {club.photos.length > 0 && (
          <View style={{ paddingHorizontal: 16, marginBottom: 24 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <Text
                style={{ fontSize: 16, fontWeight: '700', color: '#111827', fontFamily: 'Zain_700Bold' }}
              >
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
                <Text style={{ fontSize: 13, color: '#0FA6A6', fontFamily: 'Inter_500Medium' }}>
                  See all
                </Text>
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
              {club.photos.slice(0, 9).map((photo, index) => (
                <TouchableOpacity
                  key={photo.id}
                  onPress={() => {
                    setSelectedPhotoIndex(index);
                    setPhotoViewerVisible(true);
                  }}
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

        {/* Officers */}
        {club.officers.length > 0 && (
          <View style={{ paddingHorizontal: 16, marginBottom: 24 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <Text
                style={{ fontSize: 16, fontWeight: '700', color: '#111827', fontFamily: 'Zain_700Bold' }}
              >
                Officers
              </Text>
              <TouchableOpacity
                onPress={() =>
                  router.push({
                    pathname: '/(tabs)/clubs/[clubId]/members',
                    params: { clubId: clubId! },
                  })
                }
                activeOpacity={0.7}
              >
                <Text style={{ fontSize: 13, color: '#0FA6A6', fontFamily: 'Inter_500Medium' }}>
                  All members
                </Text>
              </TouchableOpacity>
            </View>
            {club.officers.map((officer) => (
              <OfficerRow key={officer.id} officer={officer} />
            ))}
          </View>
        )}
      </ScrollView>

      {/* Photo Viewer Modal */}
      <Modal
        visible={photoViewerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPhotoViewerVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center' }}>
          <TouchableOpacity
            onPress={() => setPhotoViewerVisible(false)}
            style={{ position: 'absolute', top: 48, right: 20, zIndex: 10 }}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          {club.photos[selectedPhotoIndex] && (
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => {
                const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
                setSelectedPhotoIndex(idx);
              }}
              contentOffset={{ x: selectedPhotoIndex * SCREEN_WIDTH, y: 0 }}
            >
              {club.photos.map((photo) => (
                <Image
                  key={photo.id}
                  source={{ uri: photo.url }}
                  style={{ width: SCREEN_WIDTH, height: SCREEN_WIDTH }}
                  resizeMode="contain"
                />
              ))}
            </ScrollView>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function UpcomingEventRow({ event, clubId }: { event: ClubUpcomingEvent; clubId: string }) {
  const router = useRouter();

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
        backgroundColor: '#fff',
        borderRadius: 12,
        marginBottom: 10,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
        elevation: 2,
      }}
    >
      <View style={{ width: 70, height: 70, backgroundColor: '#E5E7EB' }}>
        {event.cover_image_url ? (
          <Image
            source={{ uri: event.cover_image_url }}
            style={{ width: 70, height: 70 }}
            resizeMode="cover"
          />
        ) : (
          <View style={{ width: 70, height: 70, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E5E7EB' }}>
            <Ionicons name="calendar-outline" size={24} color="#9CA3AF" />
          </View>
        )}
      </View>

      <View style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 10 }}>
        <Text
          style={{ fontSize: 14, fontWeight: '700', color: '#111827', fontFamily: 'Inter_700Bold', marginBottom: 4 }}
          numberOfLines={1}
        >
          {event.emoji ? `${event.emoji} ` : ''}{event.title}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
          <Ionicons name="calendar-outline" size={11} color="#9CA3AF" />
          <Text style={{ fontSize: 11, color: '#6B7280', fontFamily: 'Inter_400Regular' }}>
            {formatDate(event.event_date)}
          </Text>
        </View>
        <Text style={{ fontSize: 11, color: '#6B7280', fontFamily: 'Inter_400Regular', paddingLeft: 15, marginBottom: 2 }}>
          {formatTime(event.start_time)} - {formatTime(event.end_time)}
        </Text>
        {event.location && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name="location-outline" size={11} color="#9CA3AF" />
            <Text style={{ fontSize: 11, color: '#6B7280', fontFamily: 'Inter_400Regular' }} numberOfLines={1}>
              {event.location}
            </Text>
          </View>
        )}
      </View>

      <Ionicons name="chevron-forward" size={18} color="#9CA3AF" style={{ marginRight: 12 }} />
    </TouchableOpacity>
  );
}

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
          <Text style={{ fontSize: 14, fontWeight: '700', color: '#111827', fontFamily: 'Inter_700Bold' }}>
            {officer.display_name}
          </Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 13, color: '#0FA6A6', fontFamily: 'Inter_500Medium' }}>
          {officer.role_title}
        </Text>
      </View>
      <TouchableOpacity
        activeOpacity={0.8}
        style={{
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: 20,
          borderWidth: 1.5,
          borderColor: '#D1D5DB',
        }}
      >
        <Text style={{ fontSize: 13, color: '#374151', fontFamily: 'Inter_500Medium' }}>Message</Text>
      </TouchableOpacity>
    </View>
  );
}
