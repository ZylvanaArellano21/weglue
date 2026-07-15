import { useEffect, useRef } from 'react';
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
  useDeclineFollowRequest,
  useFollowBack,
  useMarkNotificationsRead,
} from '../../hooks/useNotifications';
import { Avatar } from '../../components/shared/Avatar';
import { Skeleton } from '../../components/shared/SkeletonLoader';
import { useToast } from '../../components/Toast';
import { timeAgo } from '../../components/home/PostCard';
import { markNotificationRead, type AppNotification } from '../../services/notificationService';
import { validateNotificationRoute } from '../../lib/notifications/routes';
import { EnableNotificationsCard } from '../../components/notifications/EnableNotificationsCard';

function notificationDescription(item: AppNotification): string {
  // Grouped social rows: "and 4 others liked your photo".
  const others = Math.max((item.group_count ?? 1) - 1, 0);
  const grouped = (verb: string) =>
    others > 0 ? `and ${others} other${others === 1 ? '' : 's'} ${verb}` : verb;

  switch (item.type) {
    case 'follow_request':  return 'requested to follow you';
    case 'follow_accepted': return 'accepted your follow request';
    case 'new_follower':    return 'started following you';
    case 'like':            return grouped('liked your photo');
    case 'comment':         return grouped('commented on your photo');
    case 'event_rsvp':      return 'is going to an event you posted';
    case 'new_event':       return 'posted a new event';
    case 'new_message':     return 'sent you a message';
    case 'gluemate':        return 'is now your Gluemate! 🎉';
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
  const { mutate: acceptRequest } = useAcceptFollowRequest(userId);
  const { mutate: declineRequest } = useDeclineFollowRequest(userId);
  const { mutate: followBack } = useFollowBack(userId);

  // Live inserts are handled by the app-wide subscription in (tabs)/_layout.

  // Mark everything read when LEAVING the screen, so the unread highlight
  // stays visible for the whole visit (marking on mount wiped it instantly).
  const markReadRef = useRef(markRead);
  markReadRef.current = markRead;
  useEffect(() => {
    if (!userId) return;
    return () => markReadRef.current();
  }, [userId]);

  // Where a tapped row goes: the server's structured route (validated against
  // the allowlist) when present, then the legacy type/entity fallback for old
  // rows. Always push — back returns here at the same list position. The row
  // is marked read only once a destination actually begins opening.
  const openNotification = (item: AppNotification) => {
    const markOpened = () => {
      if (!item.is_read) void markNotificationRead(item.id);
    };

    const validated = validateNotificationRoute(item.route);
    if (validated) {
      markOpened();
      router.push({ pathname: validated.pathname as never, params: validated.params as never });
      return;
    }
    if ((item.type === 'like' || item.type === 'comment') && item.reference_id) {
      markOpened();
      router.push({ pathname: '/post/[postId]', params: { postId: item.reference_id } });
      return;
    }
    if (item.type === 'new_event' && item.reference_id) {
      markOpened();
      router.push({ pathname: '/home/event-detail', params: { eventId: item.reference_id } });
      return;
    }
    // Club membership / group chat / officer notifications open the club.
    if (
      (item.type === 'club_chat_added' ||
        item.type === 'officer_chat_added' ||
        item.type === 'officer_role' ||
        item.type === 'officer_removed' ||
        item.type === 'club_joined' ||
        item.type === 'member_joined') &&
      item.reference_id
    ) {
      markOpened();
      router.push({ pathname: '/club/[clubId]', params: { clubId: item.reference_id } });
      return;
    }
    if (item.sender?.id) {
      markOpened();
      router.push({ pathname: '/profile/[userId]', params: { userId: item.sender.id } });
    }
  };

  const renderNotification = ({ item }: { item: AppNotification }) => {
    const isFollowRequest = item.type === 'follow_request';
    const showFollowBack =
      (item.type === 'new_follower' || item.type === 'follow_accepted') &&
      item.actor_follow_state === 'not_following';
    const showRequested =
      (item.type === 'new_follower' || item.type === 'follow_accepted') &&
      item.actor_follow_state === 'pending';

    return (
      <TouchableOpacity
        onPress={() => openNotification(item)}
        activeOpacity={0.7}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingVertical: 12,
          gap: 12,
          backgroundColor: item.is_read ? 'transparent' : 'rgba(15, 166, 166, 0.06)',
        }}
      >
        <TouchableOpacity
          onPress={() => {
            if (item.sender?.id) {
              router.push({ pathname: '/profile/[userId]', params: { userId: item.sender.id } });
            }
          }}
          activeOpacity={0.7}
        >
          <Avatar uri={item.sender?.avatar_url} size={46} username={item.sender?.username} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          {/* Club/chat notifications carry their full copy from the DB
              trigger ("You were added to X members group chat.") — render it
              verbatim instead of "username did something". */}
          {item.message ? (
            <Text style={{ fontSize: 14, color: '#111827', fontFamily: 'Inter_400Regular' }}>
              {item.message}
            </Text>
          ) : (
            <Text style={{ fontSize: 14, color: '#111827', fontFamily: 'Inter_400Regular' }}>
              <Text style={{ fontWeight: '700', fontFamily: 'Inter_700Bold' }}>
                {item.sender?.username ?? 'Someone'}
              </Text>
              {' '}
              {notificationDescription(item)}
            </Text>
          )}
          <Text
            style={{
              fontSize: 12,
              color: '#9CA3AF',
              fontFamily: 'Inter_400Regular',
              marginTop: 2,
            }}
          >
            {timeAgo(item.created_at)}
          </Text>
        </View>

        {isFollowRequest && item.sender?.id && (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity
              onPress={() =>
                acceptRequest(item.sender!.id, {
                  onSuccess: () => show('Request accepted! 🎉'),
                  onError: () => show('Failed to accept.', 'error'),
                })
              }
              activeOpacity={0.8}
              style={{
                backgroundColor: '#0FA6A6',
                borderRadius: 20,
                paddingHorizontal: 16,
                paddingVertical: 8,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600', fontFamily: 'Inter_600SemiBold' }}>
                Accept
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() =>
                declineRequest(item.sender!.id, {
                  onSuccess: () => show('Request declined.'),
                  onError: () => show('Failed to decline.', 'error'),
                })
              }
              activeOpacity={0.8}
              style={{
                borderWidth: 1.5,
                borderColor: '#0FA6A6',
                borderRadius: 20,
                paddingHorizontal: 14,
                paddingVertical: 8,
              }}
            >
              <Text style={{ color: '#0FA6A6', fontSize: 13, fontWeight: '600', fontFamily: 'Inter_600SemiBold' }}>
                Decline
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {showFollowBack && item.sender?.id && (
          <TouchableOpacity
            onPress={() =>
              followBack(item.sender!.id, {
                onSuccess: () => show('Following back! 🎉'),
                onError: () => show('Failed to follow.', 'error'),
              })
            }
            activeOpacity={0.8}
            style={{
              backgroundColor: '#0FA6A6',
              borderRadius: 20,
              paddingHorizontal: 16,
              paddingVertical: 8,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600', fontFamily: 'Inter_600SemiBold' }}>
              Follow back
            </Text>
          </TouchableOpacity>
        )}

        {showRequested && (
          <View
            style={{
              borderWidth: 1.5,
              borderColor: '#0FA6A6',
              borderRadius: 20,
              paddingHorizontal: 14,
              paddingVertical: 8,
            }}
          >
            <Text style={{ color: '#0FA6A6', fontSize: 13, fontWeight: '600', fontFamily: 'Inter_600SemiBold' }}>
              Requested
            </Text>
          </View>
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
        {flatItems.some((i) => i.type === 'notification' && !i.notification.is_read) && (
          <TouchableOpacity
            onPress={() => markRead()}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Mark all notifications as read"
          >
            <Text
              style={{
                fontSize: 13,
                fontWeight: '600',
                color: '#0FA6A6',
                fontFamily: 'Inter_600SemiBold',
              }}
            >
              Mark all as read
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Store-compliant permission entry point: only shown while push is
          not yet granted; the OS prompt fires only from its button. */}
      <EnableNotificationsCard />

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
