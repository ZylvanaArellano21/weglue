import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Animated,
  Image,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { useOfficerStore } from '../../store/officerStore';
import { EventsFeed } from '../../components/home/EventsFeed';
import { PostsFeed } from '../../components/home/PostsFeed';
import { getUserOfficerStatus } from '../../services/clubService';

type ActiveTab = 'posts' | 'events';

export default function HomeScreen() {
  const { session, profile } = useAuthStore();
  const { isOfficer, setOfficerStatus } = useOfficerStore();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<ActiveTab>('events');
  const [dropdownVisible, setDropdownVisible] = useState(false);
  const dropdownAnim = useRef(new Animated.Value(0)).current;

  const userId = session?.user.id;
  const firstName = profile?.full_name?.split(' ')[0] ?? profile?.username ?? '';

  // Bootstrap officer status once on mount
  useEffect(() => {
    if (!userId) return;
    getUserOfficerStatus(userId).then(({ isOfficer: io, officerClubIds }) => {
      setOfficerStatus(io, officerClubIds);
    });
  }, [userId]);

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

  const handleAvatarPress = () => {
    if (userId) {
      router.push({ pathname: '/profile/[userId]', params: { userId } });
    }
  };

  const handleNotificationsPress = () => {
    router.push('/home/notifications');
  };

  return (
    <TouchableWithoutFeedback onPress={closeDropdown}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#FEFCF0' }}>
        {/* Header */}
        <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            {/* Avatar */}
            <TouchableOpacity onPress={handleAvatarPress} activeOpacity={0.8}>
              {profile?.avatar_url ? (
                <Image
                  source={{ uri: profile.avatar_url }}
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: 23,
                    backgroundColor: '#E5E7EB',
                  }}
                />
              ) : (
                <View
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: 23,
                    backgroundColor: '#0FA6A6',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
                    {firstName.slice(0, 1).toUpperCase()}
                  </Text>
                </View>
              )}
            </TouchableOpacity>

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
              </TouchableOpacity>
            </View>
          </View>

          {/* Welcome text */}
          <Text
            style={{
              fontSize: 26,
              fontWeight: '800',
              color: '#111827',
              fontFamily: 'Zain_800ExtraBold',
              marginTop: 12,
              marginBottom: 4,
            }}
          >
            Welcome back {firstName}
          </Text>
        </View>

        {/* Dropdown */}
        {dropdownVisible && (
          <TouchableWithoutFeedback onPress={(e) => e.stopPropagation()}>
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
          </TouchableWithoutFeedback>
        )}

        {/* Tab Switcher */}
        <View
          style={{
            flexDirection: 'row',
            paddingHorizontal: 16,
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
                paddingHorizontal: 12,
                paddingBottom: 10,
                marginRight: 8,
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
      </SafeAreaView>
    </TouchableWithoutFeedback>
  );
}
