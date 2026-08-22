/**
 * Update screen — reached from the sidebar's "Update" row.
 *
 * Two states only, decided entirely by useAppUpdateStatus:
 *  - A newer, actually publicly downloadable version exists → "Update now"
 *    opens the correct store listing. Opening the store, or having already
 *    opened it, does NOT clear the sidebar/header badge by itself — only a
 *    genuine app-foreground check (in useAppUpdateStatus) that finds the
 *    installed version has actually changed does that.
 *  - No newer version → a plain "You're up to date" state. No CTA needed.
 *
 * Store URLs are deliberately duplicated here rather than imported from the
 * web app (apps/web/app/invite/[token]/page.tsx / apps/web/app/download/
 * page.tsx use the same two literals) — same convention that codebase
 * already documents: these are two different apps/bundles, not shared code.
 */
import { Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppUpdateStatus } from '../../hooks/useAppUpdateStatus';
import { profileColors, profileFonts } from '../../components/profile/profileTheme';

const APP_STORE_URL = 'https://apps.apple.com/app/we-glue/id6786491344';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.weglue.app';

export default function UpdateScreen() {
  const router = useRouter();
  const { updateAvailable, isLoading } = useAppUpdateStatus();

  const handleUpdatePress = () => {
    const url = Platform.OS === 'ios' ? APP_STORE_URL : PLAY_STORE_URL;
    void Linking.openURL(url);
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={24} color={profileColors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Update</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.body}>
        {isLoading ? null : updateAvailable ? (
          <>
            <View style={styles.iconCircle}>
              <Ionicons name="arrow-up-circle-outline" size={40} color={profileColors.teal} />
            </View>
            <Text style={styles.title}>A new We Glue update is ready</Text>
            <Text style={styles.subtitle}>Update now to get the latest improvements.</Text>
            <TouchableOpacity onPress={handleUpdatePress} activeOpacity={0.85} style={styles.primaryButton}>
              <Text style={styles.primaryButtonLabel}>Update now</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View style={styles.iconCircle}>
              <Ionicons name="checkmark-circle-outline" size={40} color={profileColors.teal} />
            </View>
            <Text style={styles.title}>You&apos;re up to date</Text>
            <Text style={styles.subtitle}>No update is currently available.</Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: profileColors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    fontFamily: profileFonts.bold,
    fontSize: 17,
    color: profileColors.textDark,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(15, 166, 166, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    fontFamily: profileFonts.bold,
    fontSize: 18,
    color: profileColors.textDark,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: profileFonts.regular,
    fontSize: 14,
    color: profileColors.textMuted,
    textAlign: 'center',
  },
  primaryButton: {
    marginTop: 28,
    backgroundColor: profileColors.teal,
    borderRadius: 40,
    paddingHorizontal: 32,
    paddingVertical: 14,
  },
  primaryButtonLabel: {
    fontFamily: profileFonts.semiBold,
    fontSize: 15,
    color: profileColors.white,
  },
});
