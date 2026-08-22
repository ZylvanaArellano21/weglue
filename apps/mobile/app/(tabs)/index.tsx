import { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  Animated,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { useOfficerStore, refreshOfficerStatus } from '../../store/officerStore';
import { useHomeTabStore } from '../../store/homeTabStore';
import { useSidebarStore } from '../../store/sidebarStore';
import { useDismissPicturePrompt } from '../../hooks/usePicturePrompt';
import { EventsFeed } from '../../components/home/EventsFeed';
import { PostsFeed } from '../../components/home/PostsFeed';
import { HomeTabletSidePanel } from '../../components/home/HomeTabletSidePanel';
import { Avatar } from '../../components/shared/Avatar';
import { useUnreadSummaryValue } from '../../hooks/useUnreadSummary';
import { useAppUpdateStatus } from '../../hooks/useAppUpdateStatus';
import { CountBadge } from '../../components/shared/CountBadge';
import { setActiveDestination, clearActiveDestination } from '../../lib/notifications/activeDestination';

// iPad / Android tablet gets the desktop-web IA (side column with Upcoming
// Events + calendar access) instead of the stretched-phone-layout the
// screen used to render at any width. 768 matches the same tablet threshold
// apps/web/components/home/AppHeader.tsx uses (md).
const TABLET_BREAKPOINT = 768;

type ActiveTab = 'posts' | 'events';

export default function HomeScreen() {
  const { session, profile } = useAuthStore();
  const { isOfficer } = useOfficerStore();
  const { activeTab, setActiveTab } = useHomeTabStore();
  const openSidebar = useSidebarStore((s) => s.open);
  const dismissPicturePrompt = useDismissPicturePrompt();
  const router = useRouter();

  const [dropdownVisible, setDropdownVisible] = useState(false);
  const dropdownAnim = useRef(new Animated.Value(0)).current;
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BREAKPOINT;

  const userId = session?.user.id;
  const firstName = profile?.full_name?.split(' ')[0] ?? profile?.username ?? '';

  // Unread count for the existing notifications entry (kept live app-wide by
  // PushNotificationsHost; this is a cache read, no extra subscription).
  const { data: unreadSummary } = useUnreadSummaryValue(userId);
  const unreadNotifications = unreadSummary?.unread_notifications ?? 0;
  const { updateAvailable } = useAppUpdateStatus();

  // Keep officer status fresh: on mount AND every time Home regains focus, so
  // gaining/losing an officer role flips the plus-menu Event option and the
  // New Event club picker quickly (task 4/14) without an app restart.
  useEffect(() => {
    void refreshOfficerStatus(userId);
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void refreshOfficerStatus(userId);
    }, [userId]),
  );

  // Correction 3: while Home is the focused tab, it is the "directly
  // relevant active Home surface" — a foreground banner for a notification
  // whose destination is Home itself (club_joined, student_joined,
  // member_joined, and similar feed/membership updates) would be redundant.
  useFocusEffect(
    useCallback(() => {
      setActiveDestination('home');
      return () => clearActiveDestination('home');
    }, []),
  );

  // Animate dropdown
  useEffect(() => {
    Animated.spring(dropdownAnim, {
      toValue: dropdownVisible ? 1 : 0,
      useNativeDriver: true,
      tension: 90,
      friction: 12,
    }).start();
  }, [dropdownVisible]);

  const dropdownScale = dropdownAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.85, 1],
  });
  const dropdownOpacity = dropdownAnim;

  const handlePlusPress = () => setDropdownVisible((prev) => !prev);
  const closeDropdown = () => setDropdownVisible(false);

  const handleNewPost = () => {
    closeDropdown();
    router.push('/home/new-post');
  };

  const handleNewEvent = () => {
    closeDropdown();
    router.push('/home/new-event');
  };

  // The sidebar is an overlay over this screen, not a route we navigate to —
  // Home stays mounted underneath with its tab, feed and scroll position intact.
  const handleAvatarPress = () => {
    openSidebar();
  };

  // Shown only for genuinely new accounts that still have no custom picture.
  // The status is stored server-side (profiles.picture_prompt_status), so the
  // prompt survives logout/login and reinstalls until it is acted on, and
  // existing accounts — backfilled to 'hidden' — never see it at all.
  const showPicturePrompt =
    profile?.picture_prompt_status === 'pending' && !profile?.avatar_url;

  const handlePicturePromptPress = () => {
    // Tapping counts as interaction: hide it permanently, then open the side
    // menu (deliberately NOT the photo picker).
    void dismissPicturePrompt();
    openSidebar();
  };

  const handleDismissPicturePrompt = () => {
    void dismissPicturePrompt();
  };

  const handleNotificationsPress = () => {
    router.push('/home/notifications');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FEFCF0' }}>
      {/* Header */}
        <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {/* Avatar */}
            <TouchableOpacity onPress={handleAvatarPress} activeOpacity={0.8}>
              <HeaderAvatar
                avatarUrl={profile?.avatar_url ?? null}
                username={profile?.username}
              />
              {/* Positioned INSIDE the button bounds: Android clips children
                  that overhang their parent (same rule as the notifications
                  badge below). */}
              <CountBadge
                count={updateAvailable ? 1 : 0}
                style={{ position: 'absolute', top: -1, right: -1 }}
              />
            </TouchableOpacity>

            {/* "Personalize your Picture!" — new accounts only, and only until
                they act on it. Tapping it opens the side menu (NOT the photo
                picker) and counts as interaction, so it never comes back. */}
            {showPicturePrompt && (
              <TouchableOpacity
                onPress={handlePicturePromptPress}
                activeOpacity={0.85}
                style={{
                  marginLeft: 10,
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  backgroundColor: '#fff',
                  borderRadius: 20,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.12,
                  shadowRadius: 6,
                  elevation: 3,
                }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: '700',
                    color: '#0FA6A6',
                    fontFamily: 'Inter_700Bold',
                  }}
                >
                  Personalize{'\n'}your Picture!
                </Text>
                <TouchableOpacity
                  onPress={handleDismissPicturePrompt}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityLabel="Dismiss profile picture prompt"
                >
                  <Ionicons name="close" size={14} color="#9CA3AF" />
                </TouchableOpacity>
              </TouchableOpacity>
            )}

            <View style={{ flex: 1 }} />

            {/* Right side: + button + 👤+ icon */}
            <View style={{ alignItems: 'flex-end', gap: 8 }}>
              {/* + button */}
              <TouchableOpacity
                onPress={handlePlusPress}
                activeOpacity={0.85}
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  backgroundColor: '#0FA6A6',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="add" size={24} color="#fff" />
              </TouchableOpacity>

              {/* 👤+ notifications icon */}
              <TouchableOpacity
                onPress={handleNotificationsPress}
                activeOpacity={0.8}
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  borderWidth: 1.5,
                  borderColor: '#0FA6A6',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'transparent',
                }}
              >
                <Ionicons name="person-add-outline" size={20} color="#0FA6A6" />
                {/* Positioned INSIDE the button bounds: Android clips children
                    that overhang their parent. */}
                <CountBadge
                  count={unreadNotifications}
                  style={{ position: 'absolute', top: -1, right: -1 }}
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Welcome text */}
          <Text
            style={{
              fontSize: 24,
              fontWeight: '700',
              color: '#000000',
              fontFamily: 'Inter_700Bold',
              marginTop: 8,
              marginBottom: 4,
            }}
          >
            Welcome back {firstName}
          </Text>
        </View>

        {/* Tap-outside-to-close backdrop — only mounted while the dropdown is
            open, so normal scrolling has zero extra touch-responder overhead */}
        {dropdownVisible && (
          <Pressable
            onPress={closeDropdown}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 900 }}
          />
        )}

        {/* Dropdown */}
        {dropdownVisible && (
          <Animated.View
            style={{
              position: 'absolute',
              top: Platform.OS === 'ios' ? 88 : 72,
              right: 16,
              backgroundColor: '#fff',
              borderRadius: 12,
              paddingVertical: 8,
              minWidth: 140,
              zIndex: 1000,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.12,
              shadowRadius: 12,
              elevation: 8,
              transform: [{ scale: dropdownScale }],
              opacity: dropdownOpacity,
              transformOrigin: 'top right',
            }}
          >
            {/* Picture option - visible to all */}
            <TouchableOpacity
              onPress={handleNewPost}
              activeOpacity={0.7}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 16,
                paddingVertical: 12,
                gap: 10,
              }}
            >
              <Ionicons name="image-outline" size={20} color="#374151" />
              <Text
                style={{
                  fontSize: 15,
                  color: '#111827',
                  fontFamily: 'Inter_500Medium',
                }}
              >
                Picture
              </Text>
            </TouchableOpacity>

            {/* Event option - only for officers */}
            {isOfficer && (
              <TouchableOpacity
                onPress={handleNewEvent}
                activeOpacity={0.7}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  gap: 10,
                }}
              >
                <Ionicons name="calendar-outline" size={20} color="#374151" />
                <Text
                  style={{
                    fontSize: 15,
                    color: '#111827',
                    fontFamily: 'Inter_500Medium',
                  }}
                >
                  Event
                </Text>
              </TouchableOpacity>
            )}
          </Animated.View>
        )}

        {/* Below the header, iPad/Android tablet splits into the same two
            surfaces as desktop web (main feed + a side column with Upcoming
            Events and calendar access) instead of the phone's single stacked
            column stretched across the whole tablet width. */}
        <View style={{ flex: 1, flexDirection: isTablet ? 'row' : 'column' }}>
          <View style={{ flex: 1 }}>
            {/* Tab Switcher — Posts | Events, each centered in its half with a
                centered underline under the active tab (matches founder design). */}
            <View
              style={{
                flexDirection: 'row',
                marginTop: 8,
                borderBottomWidth: 1,
                borderBottomColor: '#E5E7EB',
              }}
            >
              {(['posts', 'events'] as ActiveTab[]).map((tab) => (
                <TouchableOpacity
                  key={tab}
                  onPress={() => {
                    closeDropdown();
                    setActiveTab(tab);
                  }}
                  activeOpacity={0.7}
                  style={{
                    flex: 1,
                    alignItems: 'center',
                    paddingBottom: 10,
                    borderBottomWidth: 2,
                    borderBottomColor: activeTab === tab ? '#0FA6A6' : 'transparent',
                  }}
                >
                  <Text
                    style={{
                      fontSize: 15,
                      fontWeight: activeTab === tab ? '600' : '400',
                      color: activeTab === tab ? '#0FA6A6' : '#9CA3AF',
                      fontFamily: activeTab === tab ? 'Inter_600SemiBold' : 'Inter_400Regular',
                    }}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Feed Content */}
            <View style={{ flex: 1 }}>
              {activeTab === 'events' ? <EventsFeed /> : <PostsFeed />}
            </View>
          </View>

          {isTablet && (
            <View style={{ width: 300, borderLeftWidth: 1, borderLeftColor: '#E5E7EB' }}>
              <HomeTabletSidePanel />
            </View>
          )}
        </View>

    </SafeAreaView>
  );
}

// ─── HeaderAvatar ─────────────────────────────────────────────────────────────
// Renders the user's own avatar in the home header via the shared Avatar
// component — the same resolution every other screen already uses, so preset
// We Glue avatars, text avatars, legacy preset colors and real uploaded
// photos (resized) all render identically here. Home previously reimplemented
// this rendering by hand and never learned the preset:<id> encoding, which is
// why a preset avatar (a first-class option in Edit Profile Picture) silently
// fell through to a broken <Image> source and showed the gray placeholder.

interface HeaderAvatarProps {
  avatarUrl: string | null;
  username?: string;
}

function HeaderAvatar({ avatarUrl, username }: HeaderAvatarProps) {
  return <Avatar uri={avatarUrl} size={63} username={username} />;
}
