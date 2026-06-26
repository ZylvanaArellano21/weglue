import { useEffect } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { useOfficerStore } from '../../../../store/officerStore';
import { Skeleton } from '../../../../components/shared/SkeletonLoader';

export type EditClubParams = {
  clubId: string;
};

export default function EditClubScreen() {
  const { clubId } = useLocalSearchParams<EditClubParams>();
  const { session } = useAuthStore();
  const router = useRouter();
  const { officerClubIds } = useOfficerStore();

  const isOfficer = !!clubId && officerClubIds.includes(clubId);

  useEffect(() => {
    if (clubId && officerClubIds.length > 0 && !isOfficer) {
      Alert.alert('Access Denied', 'Only officers can edit club settings.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    }
  }, [isOfficer, officerClubIds.length]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FEFCF0' }} edges={['top']}>
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: '#F3F4F6',
        }}
      >
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} style={{ marginRight: 12 }}>
          <Ionicons name="chevron-back" size={26} color="#111827" />
        </TouchableOpacity>
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#111827', fontFamily: 'Zain_700Bold' }}>
          Edit Club
        </Text>
      </View>

      {/* Skeleton placeholder — Cursor will build the form UI */}
      <View style={{ padding: 16, gap: 16 }}>
        <Skeleton width="100%" height={120} borderRadius={12} />
        <Skeleton width="100%" height={48} borderRadius={12} />
        <Skeleton width="100%" height={100} borderRadius={12} />
        <Skeleton width="100%" height={48} borderRadius={12} />
        <Skeleton width="100%" height={48} borderRadius={12} />
      </View>
    </SafeAreaView>
  );
}
