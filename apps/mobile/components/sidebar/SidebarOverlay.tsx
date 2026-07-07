/**
 * SidebarOverlay — Slide-in drawer from the left side of the screen.
 */

import { useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Animated,
  Dimensions,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@weglue/shared';
import { useSidebar } from '../../context/SidebarContext';
import { buildSidebarItems, type SidebarItemKey } from '../../lib/sidebarNavigation';
import { useOwnProfile } from '../../hooks/useOwnProfile';
import { Avatar } from '../shared/Avatar';
import { profileColors, profileFonts, profileShadow } from '../profile/profileTheme';

const SCREEN_WIDTH = Dimensions.get('window').width;
const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * 0.75, 320);

const LABEL_OVERRIDES: Partial<Record<SidebarItemKey, string>> = {
  terms: 'Terms & Conditions',
};

const MENU_KEYS: SidebarItemKey[] = [
  'savedEvents',
  'interests',
  'accountCenter',
  'privacyCenter',
];

const FOOTER_KEYS: SidebarItemKey[] = ['help', 'terms', 'logout'];

export function SidebarOverlay() {
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const { isOpen, closeSidebar } = useSidebar();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data: profile } = useOwnProfile(userId);
  const allItems = buildSidebarItems(router, closeSidebar);

  const slideAnim = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isOpen) {
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
          tension: 80,
          friction: 12,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: -DRAWER_WIDTH,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [isOpen, slideAnim, fadeAnim]);

  const menuItems = allItems.filter((i) => MENU_KEYS.includes(i.key));
  const footerItems = allItems.filter((i) => FOOTER_KEYS.includes(i.key));

  const openProfile = () => {
    closeSidebar();
    router.push('/profile/own' as any);
  };

  return (
    <Modal
      visible={isOpen}
      transparent
      animationType="none"
      onRequestClose={closeSidebar}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <TouchableWithoutFeedback onPress={closeSidebar}>
          <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]} />
        </TouchableWithoutFeedback>

        <Animated.View
          style={[
            styles.drawer,
            {
              width: DRAWER_WIDTH,
              paddingTop: insets.top + 20,
              paddingBottom: insets.bottom + 16,
              transform: [{ translateX: slideAnim }],
            },
          ]}
        >
          <TouchableOpacity
            style={styles.header}
            onPress={openProfile}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Your profile"
          >
            <Avatar
              uri={profile?.avatar_url}
              size={56}
              username={profile?.username}
            />
            <View style={styles.headerText}>
              <Text style={styles.displayName} numberOfLines={1}>
                {profile?.full_name ?? 'Your Profile'}
              </Text>
              {profile?.username ? (
                <Text style={styles.username} numberOfLines={1}>
                  @{profile.username}
                </Text>
              ) : null}
            </View>
          </TouchableOpacity>

          <View style={styles.divider} />

          <ScrollView showsVerticalScrollIndicator={false} style={styles.menuScroll}>
            {menuItems.map((item) => (
              <SidebarRow key={item.key} item={item} />
            ))}
          </ScrollView>

          <View style={styles.footer}>
            {footerItems.map((item) => (
              <SidebarRow key={item.key} item={item} />
            ))}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function SidebarRow({
  item,
}: {
  item: ReturnType<typeof buildSidebarItems>[number];
}) {
  const label = LABEL_OVERRIDES[item.key] ?? item.label;

  return (
    <TouchableOpacity
      onPress={item.onPress}
      activeOpacity={0.7}
      style={styles.row}
      accessibilityRole="button"
    >
      <Ionicons
        name={item.icon as keyof typeof Ionicons.glyphMap}
        size={22}
        color={item.destructive ? profileColors.alertRed : profileColors.textDark}
      />
      <Text
        style={[
          styles.rowLabel,
          item.destructive && styles.rowLabelDestructive,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: profileColors.sidebarOverlay,
  },
  drawer: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: profileColors.bg,
    paddingHorizontal: 20,
    ...profileShadow,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 20,
  },
  headerText: {
    flex: 1,
  },
  displayName: {
    fontFamily: profileFonts.bold,
    fontSize: 18,
    color: profileColors.textDark,
  },
  username: {
    fontFamily: profileFonts.regular,
    fontSize: 13,
    color: profileColors.textMuted,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: profileColors.border,
    marginBottom: 8,
  },
  menuScroll: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
  },
  rowLabel: {
    fontFamily: profileFonts.medium,
    fontSize: 16,
    color: profileColors.textDark,
  },
  rowLabelDestructive: {
    color: profileColors.alertRed,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: profileColors.border,
    paddingTop: 8,
  },
});
