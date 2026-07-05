import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

const CREAM = '#FEFCF0';
const TEAL = '#0FA6A6';

interface HomePostEventPromptProps {
  onPress?: () => void;
}

export function HomePostEventPrompt({ onPress }: HomePostEventPromptProps) {
  const router = useRouter();

  const handlePress = () => {
    if (onPress) {
      onPress();
      return;
    }
    router.push('/home/new-event');
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.88}
      style={{
        marginHorizontal: 20,
        marginTop: 12,
        marginBottom: 4,
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        borderWidth: 1.5,
        borderColor: 'rgba(15,166,166,0.25)',
        paddingHorizontal: 20,
        paddingVertical: 18,
        alignItems: 'center',
        shadowColor: '#0FA6A6',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
        elevation: 3,
      }}
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: 24,
          backgroundColor: 'rgba(15,166,166,0.12)',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 10,
        }}
      >
        <Ionicons name="calendar" size={24} color={TEAL} />
      </View>

      <Text
        style={{
          fontSize: 18,
          fontWeight: '700',
          color: '#111827',
          fontFamily: 'Zain_700Bold',
          marginBottom: 4,
          textAlign: 'center',
        }}
      >
        Post an Event
      </Text>

      <Text
        style={{
          fontSize: 13,
          color: '#6B7280',
          fontFamily: 'Inter_400Regular',
          textAlign: 'center',
          lineHeight: 19,
          marginBottom: 14,
          paddingHorizontal: 8,
        }}
      >
        Share your next club event with the community
      </Text>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          backgroundColor: TEAL,
          borderRadius: 24,
          paddingHorizontal: 22,
          paddingVertical: 11,
          minWidth: 180,
        }}
      >
        <Ionicons name="add-circle-outline" size={18} color={CREAM} />
        <Text
          style={{
            fontSize: 14,
            fontWeight: '600',
            color: CREAM,
            fontFamily: 'Inter_600SemiBold',
          }}
        >
          Create Event
        </Text>
      </View>
    </TouchableOpacity>
  );
}
