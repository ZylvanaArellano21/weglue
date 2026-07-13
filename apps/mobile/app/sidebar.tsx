/**
 * Sidebar — root-level transparent-modal route (was a RN <Modal> overlay).
 *
 * As a real route it becomes a layer in the navigation history: tapping a
 * sidebar item pushes its destination ABOVE this route, so Back reveals the
 * still-open sidebar, and closing the sidebar (backdrop tap / system Back)
 * pops back to Home — exactly the required journey:
 *   Home → Sidebar → Destination → Back → Sidebar → close → Home.
 * The old version dismissed the drawer before navigating, which is why Back
 * could never restore it.
 */
import { useEffect, useRef, useState } from 'react';
import {
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
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@weglue/shared';
import { buildSidebarItems, type SidebarItemKey } from '../lib/sidebarNavigation';
import { openSupportEmail, SUPPORT_EMAIL } from '../lib/support';
import { supabase } from '../lib/supabase';
import {
  rememberTokenForRevocation,
  tearDownAuthenticatedSession,
} from '../lib/sessionCleanup';
import { useOwnProfile } from '../hooks/useOwnProfile';
import { useToast } from '../components/Toast';
import { ConfirmModal } from '../components/ConfirmModal';
import { Avatar } from '../components/shared/Avatar';
import { profileColors, profileFonts, profileShadow } from '../components/profile/profileTheme';

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

export default function SidebarScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuthStore();
  const userId = session?.user.id;

  const { data: profile } = useOwnProfile(userId);
  const { show, ToastComponent } = useToast();
  const queryClient = useQueryClient();

  const [helpFallbackVisible, setHelpFallbackVisible] = useState(false);
  const [logoutConfirmVisible, setLogoutConfirmVisible] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Dismiss = pop this route (reveals whatever was underneath — normally Home).
  const close = () => router.back();

  const handleHelp = () => {
    void openSupportEmail().then((opened) => {
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

    // Close the sidebar first so the user never sits staring at it while
    // cleanup runs, then tear the session down through the ONE shared path
    // (identical to account deletion). Clearing the session unmounts the whole
    // authenticated tree and the root guard lands on /welcome — which also
    // means there is no authenticated route left behind for iOS swipe-back or
    // Android Back to return to.
    setLogoutConfirmVisible(false);
    close();

    try {
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

  // Items push their destination ABOVE this route (no close-first), so Back
  // returns here with the sidebar still open.
  const allItems = buildSidebarItems(router, {
    onHelp: handleHelp,
    onLogout: handleLogoutRequest,
  });
  const menuItems = allItems.filter((i) => MENU_KEYS.includes(i.key));
  const footerItems = allItems.filter((i) => FOOTER_KEYS.includes(i.key));

  const slideAnim = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 80, friction: 12 }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  }, [slideAnim, fadeAnim]);

  const openProfile = () => router.push('/profile/own');

  return (
    <View style={styles.root}>
      <TouchableWithoutFeedback onPress={close}>
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
  root: { flex: 1, flexDirection: 'row' },
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
