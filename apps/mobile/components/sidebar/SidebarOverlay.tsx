/**
 * SidebarOverlay — Slide-in drawer from the left side of the screen.
 */

import { useEffect, useRef, useState } from 'react';
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
import * as Clipboard from 'expo-clipboard';
import { useAuthStore } from '@weglue/shared';
import { useSidebar } from '../../context/SidebarContext';
import { buildSidebarItems, type SidebarItemKey } from '../../lib/sidebarNavigation';
import { openSupportEmail, safeSignOut, SUPPORT_EMAIL } from '../../lib/support';
import { useOwnProfile } from '../../hooks/useOwnProfile';
import { useToast } from '../Toast';
import { ConfirmModal } from '../ConfirmModal';
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
  const { show, ToastComponent } = useToast();

  // Help fallback (no mail app) + logout confirmation. Both render as their
  // own Modals after the drawer closes so only one modal is ever visible.
  const [helpFallbackVisible, setHelpFallbackVisible] = useState(false);
  const [logoutConfirmVisible, setLogoutConfirmVisible] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const handleHelp = () => {
    closeSidebar();
    void openSupportEmail().then((opened) => {
      if (!opened) setHelpFallbackVisible(true);
    });
  };

  const handleLogoutRequest = () => {
    closeSidebar();
    setLogoutConfirmVisible(true);
  };

  const handleLogoutConfirm = async () => {
    if (signingOut) return; // double-tap guard — one sign-out call only
    setSigningOut(true);
    try {
      await safeSignOut();
      // Session flips to null → (tabs) layout redirects to the welcome/login
      // screen and this whole tree unmounts. No manual navigation needed.
    } finally {
      setSigningOut(false);
      setLogoutConfirmVisible(false);
    }
  };

  const handleCopySupportEmail = async () => {
    try {
      await Clipboard.setStringAsync(SUPPORT_EMAIL);
      setHelpFallbackVisible(false);
      show('Email address copied!');
    } catch {
      show('Could not copy. Email: ' + SUPPORT_EMAIL, 'error');
    }
  };

  const allItems = buildSidebarItems(router, closeSidebar, {
    onHelp: handleHelp,
    onLogout: handleLogoutRequest,
  });

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
    <>
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

    {/* Log Out confirmation — shown after the drawer closes */}
    <ConfirmModal
      visible={logoutConfirmVisible}
      title="Log out?"
      message="Are you sure you want to log out?"
      confirmLabel="Log Out"
      cancelLabel="Cancel"
      destructive
      loading={signingOut}
      onConfirm={() => void handleLogoutConfirm()}
      onCancel={() => {
        if (!signingOut) setLogoutConfirmVisible(false);
      }}
    />

    {/* Help fallback — no mail app available on this device */}
    <ConfirmModal
      visible={helpFallbackVisible}
      title="Contact Support"
      message={`We couldn't open your email app.\n\nReach us at:\n${SUPPORT_EMAIL}`}
      confirmLabel="Copy Email"
      cancelLabel="Close"
      onConfirm={() => void handleCopySupportEmail()}
      onCancel={() => setHelpFallbackVisible(false)}
    />

    {ToastComponent}
    </>
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
