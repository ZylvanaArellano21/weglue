import { useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import {
  useNotifications,
  useAcceptFollowRequest,
  useFollowBack,
  useMarkNotificationsRead,
} from '../../hooks/useNotifications';
import { Avatar } from '../../components/shared/Avatar';
import { Skeleton } from '../../components/shared/SkeletonLoader';
import { useToast } from '../../components/Toast';
import type { AppNotification } from '../../services/notificationService';

function notificationDescription(type: AppNotification['type']): string {
  switch (type) {
    case 'follow_request':  return 'requested to follow you';
    case 'follow_accepted': return 'started following you';
    case 'like':            return 'liked your photo';
    case 'comment':         return 'commented on your photo';
    case 'event_rsvp':      return 'is going to an event you posted';
    case 'new_event':       return 'posted a new event';
    case 'new_message':     return 'sent you a message';
    case 'gluemate':        return 'is now your Gluemate!';
    default:                return 'interacted with you';
  }
}

export default function NotificationsScreen() {
  const router = useRouter();
  const { session, profile } = useAuthStore();
  const userId = session?.user.id;
  const { show, ToastComponent } = useToast();

  const { data: sections, isLoading } = useNotifications(userId);
  const { mutate: markRead } = useMarkNotificationsRead(userId);
  const { mutate: acceptRequest, isPending: accepting } = useAcceptFollowRequest(userId);
  const { mutate: followBack, isPending: followingBack } = useFollowBack(userId);

  // Mark all as read when screen mounts
  useEffect(() => {
    if (userId) markRead();
  }, [userId]);

  const renderNotification = ({ item }: { item: AppNotification }) => {
    const isFollowRequest = item.type === 'follow_request';
    const isNewFollower = item.type === 'follow_accepted';

    return (
      <TouchableOpacity
        onPress={() => {
          if (item.sender?.id) {
            router.push({ pathname: '/profile/[userId]', params: { userId: item.sender.id } });
          }
        }}
        activeOpacity={0.7}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingVertical: 12,
          gap: 12,
        }}
      >
        <Avatar uri={item.sender?.avatar_url} size={46} username={item.sender?.username} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, color: '#111827', fontFamily: 'Inter_400Regular' }}>
            <Text style={{ fontWeight: '700', fontFamily: 'Inter_700Bold' }}>
              {item.sender?.username ?? 'Someone'}
            </Text>
            {' '}
            {notificationDescription(item.type)}
          </Text>
        </View>

        {isFollowRequest && (
          <TouchableOpacity
            onPress={() => {
              if (!item.sender?.id) return;
              acceptRequest(item.sender.id, {
                onSuccess: () => show('Request accepted! 🎉'),
                onError: () => show('Failed to accept.', 'error'),
              });
            }}
            disabled={accepting}
            activeOpacity={0.8}
            style={{
              backgroundColor: '#0FA6A6',
              borderRadius: 20,
              paddingHorizontal: 16,
              paddingVertical: 8,
            }}
          >
            {accepting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600', fontFamily: 'Inter_600SemiBold' }}>
                Accept
              </Text>
            )}
          </TouchableOpacity>
        )}

        {isNewFollower && (
          <TouchableOpacity
            onPress={() => {
              if (!item.sender?.id) return;
              followBack(item.sender.id, {
                onSuccess: () => show('Following back! 🎉'),
                onError: () => show('Failed to follow.', 'error'),
              });
            }}
            disabled={followingBack}
            activeOpacity={0.8}
            style={{
              backgroundColor: '#0FA6A6',
              borderRadius: 20,
              paddingHorizontal: 16,
              paddingVertical: 8,
            }}
          >
            {followingBack ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600', fontFamily: 'Inter_600SemiBold' }}>
                Follow back
              </Text>
            )}
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  type SectionItem =
    | { type: 'header'; id: string; label: string }
    | { type: 'notification'; id: string; notification: AppNotification };

  const flatItems: SectionItem[] = [];
  for (const section of sections ?? []) {
    flatItems.push({ type: 'header', id: `header-${section.group}`, label: section.group });
    for (const notif of section.data) {
      flatItems.push({ type: 'notification', id: notif.id, notification: notif });
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FEFCF0' }} edges={['top']}>
      {ToastComponent}

      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingVertical: 12,
        }}
      >
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} hitSlop={{ top: 10, left: 10, right: 10, bottom: 10 }}>
          <Ionicons name="chevron-back" size={26} color="#111827" />
        </TouchableOpacity>
        <Text
          style={{
            flex: 1,
            fontSize: 18,
            fontWeight: '700',
            color: '#111827',
            fontFamily: 'Zain_700Bold',
            marginLeft: 8,
          }}
        >
          {profile?.username ?? 'Notifications'}
        </Text>
      </View>

      {isLoading ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 16 }}>
          {[1, 2, 3, 4].map((k) => (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Skeleton width={46} height={46} borderRadius={23} />
              <View style={{ flex: 1, gap: 6 }}>
                <Skeleton width="70%" height={13} />
                <Skeleton width="50%" height={12} />
              </View>
            </View>
          ))}
        </View>
      ) : flatItems.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 }}>
          <Text style={{ fontSize: 40, marginBottom: 16 }}>✅</Text>
          <Text
            style={{
              fontSize: 16,
              fontWeight: '600',
              color: '#374151',
              textAlign: 'center',
              fontFamily: 'Zain_700Bold',
            }}
          >
            You're all caught up!
          </Text>
        </View>
      ) : (
        <FlatList
          data={flatItems}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            if (item.type === 'header') {
              return (
                <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 }}>
                  <Text
                    style={{
                      fontSize: 15,
                      fontWeight: '700',
                      color: '#111827',
                      fontFamily: 'Zain_700Bold',
                    }}
                  >
                    {item.label}
                  </Text>
                </View>
              );
            }
            return renderNotification({ item: item.notification });
          }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 32 }}
        />
      )}
    </SafeAreaView>
  );
}
