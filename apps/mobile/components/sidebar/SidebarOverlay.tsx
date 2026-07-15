/**
 * SidebarOverlay — the drawer itself.
 *
 * Rendered by SidebarHost as an absolutely-positioned layer ABOVE the whole
 * navigator (tab bar included) while `useSidebarStore.isOpen` is true. It is
 * deliberately NOT a route: nothing opened from it is nested inside it, so every
 * destination lands full-screen on the normal opaque stack. See store/sidebarStore.ts.
 */
import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Animated,
  BackHandler,
  Platform,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@weglue/shared';
import {
  buildSidebarItems,
  openSidebarDestination,
  type SidebarItemKey,
} from '../../lib/sidebarNavigation';
import { openSupportEmail, SUPPORT_EMAIL } from '../../lib/support';
import { supabase } from '../../lib/supabase';
import {
  rememberTokenForRevocation,
  tearDownAuthenticatedSession,
} from '../../lib/sessionCleanup';
import { useSidebarStore } from '../../store/sidebarStore';
import { useOwnProfile } from '../../hooks/useOwnProfile';
import { useToast } from '../Toast';
import { ConfirmModal } from '../ConfirmModal';
import { Avatar } from '../shared/Avatar';
import { profileColors, profileFonts, profileShadow } from '../profile/profileTheme';

const LABEL_OVERRIDES: Partial<Record<SidebarItemKey, string>> = {
  terms: 'Terms & Conditions',
};

const MENU_KEYS: SidebarItemKey[] = [
  'savedEvents',
  'interests',
  'accountCenter',
  'notifications',
  'privacyCenter',
];
const FOOTER_KEYS: SidebarItemKey[] = ['help', 'terms', 'logout'];

export function SidebarOverlay() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  // Width follows the live window, not a module-level Dimensions snapshot, so it
  // is correct on Android tablets/foldables and after a rotation — there is no
  // hardcoded device width anywhere.
  const { width: windowWidth } = useWindowDimensions();
  const drawerWidth = Math.min(windowWidth * 0.75, 320);

  const { session } = useAuthStore();
  const userId = session?.user.id;

  const { data: profile } = useOwnProfile(userId);
  const { show, ToastComponent } = useToast();
  const queryClient = useQueryClient();

  const closeSidebar = useSidebarStore((s) => s.close);

  const [helpFallbackVisible, setHelpFallbackVisible] = useState(false);
  const [logoutConfirmVisible, setLogoutConfirmVisible] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Android system Back closes the drawer (it is an overlay, so there is no
  // route to pop). Returning true stops the event from also popping the
  // underlying screen. Only registered while the drawer is mounted/open.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (signingOut) return true;
      if (helpFallbackVisible) {
        setHelpFallbackVisible(false);
        return true;
      }
      if (logoutConfirmVisible) {
        setLogoutConfirmVisible(false);
        return true;
      }
      closeSidebar();
      return true;
    });
    return () => sub.remove();
  }, [closeSidebar, signingOut, helpFallbackVisible, logoutConfirmVisible]);

  const handleHelp = () => {
    // External-app exception: hands off to the device mail composer. The drawer
    // stays open underneath on purpose — when the user finishes or cancels in
    // Mail/Gmail/Outlook and returns to We Glue, they come back to exactly the
    // context they left (same tab, same screen, sidebar still open). No route is
    // pushed, so there is nothing to restore and no duplicate sidebar.
    void openSupportEmail().then((opened) => {
      // Only surfaces when the mail action genuinely cannot be opened (no mail
      // app configured); otherwise the OS handles app choice silently.
      if (!opened) setHelpFallbackVisible(true);
    });
  };

  const handleLogoutRequest = () => setLogoutConfirmVisible(true);

  const handleLogoutConfirm = async () => {
    if (signingOut) return;
    setSigningOut(true);

    // Capture the token before teardown clears the session, so the background
    // revocation still has something to revoke.
    const { data } = await supabase.auth.getSession();
    rememberTokenForRevocation(data.session?.access_token);

    setLogoutConfirmVisible(false);

    try {
      // The ONE shared teardown (identical to account deletion). It resets the
      // sidebar store — closing this overlay — and clears the session, which
      // makes the tabs guard replace the authenticated tree with /welcome.
      // Welcome is a plain root screen now that no transparent modal is
      // presented, so it fills the window: no rounded corners, no sheet, no
      // dimmed backdrop, and no authenticated route left to swipe or Back into.
      await tearDownAuthenticatedSession(queryClient, userId);
    } finally {
      setSigningOut(false);
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

  const allItems = buildSidebarItems(router, pathname, {
    onHelp: handleHelp,
    onLogout: handleLogoutRequest,
  });
  const menuItems = allItems.filter((i) => MENU_KEYS.includes(i.key));
  const footerItems = allItems.filter((i) => FOOTER_KEYS.includes(i.key));

  const slideAnim = useRef(new Animated.Value(-drawerWidth)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 80, friction: 12 }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  }, [slideAnim, fadeAnim]);

  const openProfile = () => openSidebarDestination(router, pathname, '/profile/own');

  return (
    <View style={styles.root} pointerEvents="box-none">
      <TouchableWithoutFeedback onPress={closeSidebar}>
        <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]} />
      </TouchableWithoutFeedback>

      <Animated.View
        style={[
          styles.drawer,
          {
            width: drawerWidth,
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
          <Avatar uri={profile?.avatar_url} size={56} username={profile?.username} />
          <View style={styles.headerText}>
            <Text style={styles.displayName} numberOfLines={1}>
              {profile?.full_name ?? 'Your Profile'}
            </Text>
            {profile?.username ? (
              <Text style={styles.username} numberOfLines={1}>@{profile.username}</Text>
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
    </View>
  );
}

function SidebarRow({ item }: { item: ReturnType<typeof buildSidebarItems>[number] }) {
  const label = LABEL_OVERRIDES[item.key] ?? item.label;
  return (
    <TouchableOpacity onPress={item.onPress} activeOpacity={0.7} style={styles.row} accessibilityRole="button">
      <Ionicons
        name={item.icon as keyof typeof Ionicons.glyphMap}
        size={22}
        color={item.destructive ? profileColors.alertRed : profileColors.textDark}
      />
      <Text style={[styles.rowLabel, item.destructive && styles.rowLabelDestructive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  // Fills the window it is layered into (the root container), covering the tab
  // bar. It is a sibling of the navigator, never a parent of it.
  root: { ...StyleSheet.absoluteFillObject, flexDirection: 'row' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: profileColors.sidebarOverlay },
  drawer: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: profileColors.bg,
    paddingHorizontal: 20,
    ...profileShadow,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 },
  headerText: { flex: 1 },
  displayName: { fontFamily: profileFonts.bold, fontSize: 18, color: profileColors.textDark },
  username: { fontFamily: profileFonts.regular, fontSize: 13, color: profileColors.textMuted, marginTop: 2 },
  divider: { height: 1, backgroundColor: profileColors.border, marginBottom: 8 },
  menuScroll: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  rowLabel: { fontFamily: profileFonts.medium, fontSize: 16, color: profileColors.textDark },
  rowLabelDestructive: { color: profileColors.alertRed },
  footer: { borderTopWidth: 1, borderTopColor: profileColors.border, paddingTop: 8 },
});
