/**
 * Update screen — reached from the sidebar's "Update" row ONLY when no
 * update is available (SidebarOverlay's handleUpdatePress intercepts the
 * available case and opens the store directly, with no internal screen at
 * all — see that file). So this screen has exactly one state to render.
 */
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { profileColors, profileFonts } from '../../components/profile/profileTheme';

export default function UpdateScreen() {
  const router = useRouter();

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
        <View style={styles.iconCircle}>
          <Ionicons name="checkmark-circle-outline" size={40} color={profileColors.teal} />
        </View>
        <Text style={styles.title}>You&apos;re up to date</Text>
        <Text style={styles.subtitle}>No update is currently available.</Text>
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
});
