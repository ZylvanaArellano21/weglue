/**
 * Update screen — reached from the sidebar's "Update" row. It reflects the
 * single source of truth (useAppUpdateStatus) and renders one of four states:
 *
 *   checking        → the check is still in flight
 *   update available → a newer public store version exists; "Update now" opens
 *                      the correct App Store / Play Store listing
 *   up to date      → the installed version is current
 *   couldn't check  → the check failed; NEVER shown as "up to date", offers Retry
 */
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppUpdateStatus } from '../../hooks/useAppUpdateStatus';
import { openStoreListing } from '../../lib/storeLinks';
import { profileColors, profileFonts } from '../../components/profile/profileTheme';

export default function UpdateScreen() {
  const router = useRouter();
  const {
    updateAvailable,
    checkFailed,
    isLoading,
    latestVersion,
    installedVersion,
    storeUrl,
    refetch,
  } = useAppUpdateStatus();

  const [openError, setOpenError] = useState(false);

  const handleOpenStore = useCallback(() => {
    setOpenError(false);
    void openStoreListing(storeUrl).then((ok) => {
      if (!ok) setOpenError(true);
    });
  }, [storeUrl]);

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
        {isLoading && !checkFailed ? (
          <>
            <View style={styles.iconCircle}>
              <ActivityIndicator color={profileColors.teal} />
            </View>
            <Text style={styles.title}>Checking for updates…</Text>
          </>
        ) : checkFailed ? (
          <>
            <View style={[styles.iconCircle, styles.iconCircleWarn]}>
              <Ionicons
                name="cloud-offline-outline"
                size={40}
                color={profileColors.alertRed}
              />
            </View>
            <Text style={styles.title}>Couldn&apos;t check for updates</Text>
            <Text style={styles.subtitle}>
              Check your connection and try again.
            </Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => refetch()}
              accessibilityRole="button"
              accessibilityLabel="Try again"
            >
              <Text style={styles.primaryBtnText}>Try again</Text>
            </TouchableOpacity>
          </>
        ) : updateAvailable ? (
          <>
            <View style={styles.iconCircle}>
              <Ionicons
                name="arrow-down-circle-outline"
                size={40}
                color={profileColors.teal}
              />
            </View>
            <Text style={styles.title}>Update available</Text>
            <Text style={styles.subtitle}>
              {latestVersion
                ? `Version ${latestVersion} is ready to download.`
                : 'A newer version is ready to download.'}
            </Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={handleOpenStore}
              accessibilityRole="button"
              accessibilityLabel="Update now"
            >
              <Text style={styles.primaryBtnText}>Update now</Text>
            </TouchableOpacity>
            {openError ? (
              <Text style={styles.errorNote}>
                We couldn&apos;t open the store. Search for &ldquo;We Glue&rdquo;
                in the {Platform.OS === 'ios' ? 'App Store' : 'Play Store'}.
              </Text>
            ) : null}
          </>
        ) : (
          <>
            <View style={styles.iconCircle}>
              <Ionicons
                name="checkmark-circle-outline"
                size={40}
                color={profileColors.teal}
              />
            </View>
            <Text style={styles.title}>You&apos;re up to date</Text>
            <Text style={styles.subtitle}>
              {installedVersion
                ? `You have the latest version (${installedVersion}).`
                : 'No update is currently available.'}
            </Text>
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
  iconCircleWarn: {
    backgroundColor: 'rgba(240, 39, 25, 0.1)',
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
  primaryBtn: {
    marginTop: 24,
    minHeight: 46,
    paddingHorizontal: 28,
    borderRadius: 23,
    backgroundColor: profileColors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    fontFamily: profileFonts.semiBold,
    fontSize: 15,
    color: profileColors.white,
  },
  errorNote: {
    marginTop: 14,
    fontFamily: profileFonts.regular,
    fontSize: 13,
    color: profileColors.textMuted,
    textAlign: 'center',
  },
});
