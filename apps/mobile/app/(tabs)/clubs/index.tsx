import { View, Text, FlatList, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@weglue/shared';
import { useMyClubs } from '../../../hooks/useClubTab';
import { Skeleton } from '../../../components/shared/SkeletonLoader';
import type { ClubWithNextEvent } from '../../../services/clubTabService';

function formatTime(t: string | null): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

function ClubRow({ club }: { club: ClubWithNextEvent }) {
  const router = useRouter();
  const subtitle = club.next_event
    ? `${club.next_event.emoji ? club.next_event.emoji + ' ' : ''}${club.next_event.title}`
    : club.meeting_schedule
    ? `${club.meeting_schedule.day}s ${formatTime(club.meeting_schedule.time_start)}`
    : null;

  return (
    <TouchableOpacity
      onPress={() =>
        router.push({ pathname: '/(tabs)/clubs/[clubId]', params: { clubId: club.id } })
      }
      activeOpacity={0.75}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: '#fff',
        borderRadius: 14,
        marginBottom: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
        elevation: 2,
      }}
    >
      {/* Avatar */}
      {club.avatar_url ? (
        <Image
          source={{ uri: club.avatar_url }}
          style={{ width: 50, height: 50, borderRadius: 12, backgroundColor: '#E5E7EB' }}
          resizeMode="cover"
        />
      ) : (
        <View
          style={{
            width: 50,
            height: 50,
            borderRadius: 12,
            backgroundColor: '#E5E7EB',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 20 }}>🎓</Text>
        </View>
      )}

      {/* Info */}
      <View style={{ flex: 1 }}>
        <Text
          style={{ fontSize: 15, fontWeight: '700', color: '#111827', fontFamily: 'Inter_700Bold' }}
          numberOfLines={1}
        >
          {club.name}
        </Text>
        {club.officer_role && (
          <Text
            style={{ fontSize: 12, color: '#0FA6A6', fontFamily: 'Inter_600SemiBold', marginTop: 1 }}
            numberOfLines={1}
          >
            {club.officer_role}
          </Text>
        )}
        {subtitle && (
          <Text
            style={{ fontSize: 12, color: '#6B7280', fontFamily: 'Inter_400Regular', marginTop: 2 }}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        )}
      </View>

      <Text style={{ fontSize: 18, color: '#D1D5DB' }}>›</Text>
    </TouchableOpacity>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <Text
      style={{
        fontSize: 13,
        fontWeight: '700',
        color: '#9CA3AF',
        fontFamily: 'Inter_700Bold',
        letterSpacing: 0.8,
        textTransform: 'uppercase',
        marginBottom: 10,
        marginTop: 4,
      }}
    >
      {title}
    </Text>
  );
}

export default function ClubsTabScreen() {
  const router = useRouter();
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const { data, isLoading } = useMyClubs(userId);

  const hasOfficer = (data?.officer_clubs.length ?? 0) > 0;
  const hasMember = (data?.member_clubs.length ?? 0) > 0;
  const isEmpty = !isLoading && !hasOfficer && !hasMember;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FEFCF0' }} edges={['top']}>
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 16,
          paddingTop: 8,
          paddingBottom: 12,
        }}
      >
        <Text style={{ fontSize: 26, fontWeight: '800', color: '#111827', fontFamily: 'Zain_800ExtraBold' }}>
          My Clubs
        </Text>
        <TouchableOpacity
          onPress={() => router.push('/home/new-event' as any)}
          activeOpacity={0.7}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: '#0FA6A6',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: '#fff', fontSize: 22, lineHeight: 26 }}>+</Text>
        </TouchableOpacity>
      </View>

      {isLoading && (
        <View style={{ paddingHorizontal: 16, gap: 12 }}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} width="100%" height={74} borderRadius={14} />
          ))}
        </View>
      )}

      {isEmpty && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <Text style={{ fontSize: 40, marginBottom: 16 }}>🎓</Text>
          <Text
            style={{
              fontSize: 18,
              fontWeight: '700',
              color: '#111827',
              fontFamily: 'Zain_700Bold',
              textAlign: 'center',
              marginBottom: 8,
            }}
          >
            No clubs yet
          </Text>
          <Text
            style={{
              fontSize: 14,
              color: '#6B7280',
              fontFamily: 'Inter_400Regular',
              textAlign: 'center',
              lineHeight: 22,
            }}
          >
            Search for clubs on your campus and join the ones that match your interests.
          </Text>
        </View>
      )}

      {!isLoading && !isEmpty && (
        <FlatList
          data={[]}
          renderItem={null}
          ListHeaderComponent={
            <View style={{ paddingHorizontal: 16 }}>
              {hasOfficer && (
                <>
                  <SectionHeader title="Officer" />
                  {data!.officer_clubs.map((club) => (
                    <ClubRow key={club.id} club={club} />
                  ))}
                </>
              )}
              {hasMember && (
                <>
                  <SectionHeader title={hasOfficer ? 'Member' : 'Joined'} />
                  {data!.member_clubs.map((club) => (
                    <ClubRow key={club.id} club={club} />
                  ))}
                </>
              )}
            </View>
          }
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          keyExtractor={() => 'list-header'}
        />
      )}
    </SafeAreaView>
  );
}
