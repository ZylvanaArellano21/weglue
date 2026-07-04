import { useState } from 'react';
import {
  View,
  Text,
  Switch,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthStore } from '@weglue/shared';
import {
  usePrivacySettings,
  useSetPrivateAccount,
  useSetHideInterests,
  useSetHideEvents,
} from '../../hooks/usePrivacyCenter';
import { ProfileScreenHeader } from '../../components/profile/ProfileScreenHeader';
import { ProfileConfirmationModal } from '../../components/profile/ProfileConfirmationModal';
import { profileColors, profileFonts } from '../../components/profile/profileTheme';

const PRIVATE_INFO_KEY = 'weglue_private_info_seen';

export default function PrivacyCenterScreen() {
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const router = useRouter();
  const setPrivate = useSetPrivateAccount(userId);
  const setHideInterests = useSetHideInterests(userId);
  const setHideEvents = useSetHideEvents(userId);

  const { data: settings, isLoading } = usePrivacySettings(userId);

  const [privateInfoVisible, setPrivateInfoVisible] = useState(false);

  const onTogglePrivate = async (value: boolean) => {
    if (value) {
      const seen = await AsyncStorage.getItem(PRIVATE_INFO_KEY);
      if (!seen) {
        setPrivateInfoVisible(true);
        await AsyncStorage.setItem(PRIVATE_INFO_KEY, '1');
      }
    }
    setPrivate.mutate(value);
  };

  const onToggleHideInterests = (value: boolean) => setHideInterests.mutate(value);
  const onToggleHideEvents = (value: boolean) => setHideEvents.mutate(value);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator size="large" color={profileColors.teal} />
      </SafeAreaView>
    );
  }

  const isPrivate = settings?.is_private ?? false;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ProfileScreenHeader title="Privacy Center" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={styles.scroll}>
        <PrivacyToggleRow
          title="Account visibility"
          description={
            isPrivate
              ? 'Your profile is Private. New followers must request to follow you.'
              : 'Your profile is Public. Anyone on campus can view your profile.'
          }
          valueLabel={isPrivate ? 'Private' : 'Public'}
          value={isPrivate}
          onValueChange={onTogglePrivate}
        />

        <View style={styles.divider} />

        <PrivacyToggleRow
          title="Hide Interests"
          description={
            settings?.hide_interests
              ? 'Your interests are hidden from other users.'
              : 'Your interests are visible on your profile.'
          }
          valueLabel={settings?.hide_interests ? 'Hidden' : 'Visible'}
          value={settings?.hide_interests ?? false}
          onValueChange={onToggleHideInterests}
        />

        <View style={styles.divider} />

        <PrivacyToggleRow
          title="Hide Events"
          description={
            settings?.hide_events
              ? 'Your weekly events are hidden from other users.'
              : 'Your weekly events are visible on your profile.'
          }
          valueLabel={settings?.hide_events ? 'Hidden' : 'Visible'}
          value={settings?.hide_events ?? false}
          onValueChange={onToggleHideEvents}
        />
      </ScrollView>

      <ProfileConfirmationModal
        visible={privateInfoVisible}
        title="Going private"
        message="Going private does not remove existing Gluemates. Current accepted follows stay in place. Only new follow requests will need your approval."
        confirmLabel="Got it"
        cancelLabel="Close"
        onConfirm={() => setPrivateInfoVisible(false)}
        onCancel={() => setPrivateInfoVisible(false)}
      />
    </SafeAreaView>
  );
}

function PrivacyToggleRow({
  title,
  description,
  valueLabel,
  value,
  onValueChange,
}: {
  title: string;
  description: string;
  valueLabel: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowDesc}>{description}</Text>
        <Text style={styles.valueLabel}>{valueLabel}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: profileColors.border, true: profileColors.teal }}
        thumbColor={profileColors.white}
        ios_backgroundColor={profileColors.border}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: profileColors.bg },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: profileColors.bg,
  },
  scroll: { padding: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 8,
  },
  rowText: { flex: 1 },
  rowTitle: {
    fontFamily: profileFonts.bold,
    fontSize: 16,
    color: profileColors.textDark,
    marginBottom: 4,
  },
  rowDesc: {
    fontFamily: profileFonts.regular,
    fontSize: 13,
    color: profileColors.textMuted,
    lineHeight: 19,
    marginBottom: 6,
  },
  valueLabel: {
    fontFamily: profileFonts.semiBold,
    fontSize: 13,
    color: profileColors.teal,
  },
  divider: {
    height: 1,
    backgroundColor: profileColors.border,
    marginVertical: 20,
  },
});
