import { TouchableOpacity, Text } from 'react-native';

type PillVariant = 'join' | 'joined' | 'follow' | 'following' | 'gluemate' | 'rsvp' | 'accept' | 'followBack' | 'custom';

interface PillProps {
  variant: PillVariant;
  onPress?: () => void;
  loading?: boolean;
  label?: string;
  disabled?: boolean;
}

const VARIANT_STYLES: Record<
  PillVariant,
  { bg: string; border?: string; text: string; textColor: string }
> = {
  join: { bg: '#0FA6A6', text: 'Join', textColor: '#FFFFFF' },
  joined: {
    bg: 'rgba(15,166,166,0.1)',
    border: '#0FA6A6',
    text: 'Joined ✓',
    textColor: '#0FA6A6',
  },
  follow: { bg: '#0FA6A6', text: 'Follow', textColor: '#FFFFFF' },
  following: {
    bg: 'transparent',
    border: '#9CA3AF',
    text: 'Following',
    textColor: '#6B7280',
  },
  gluemate: {
    bg: 'rgba(15,166,166,0.1)',
    border: '#0FA6A6',
    text: 'Gluemate',
    textColor: '#0FA6A6',
  },
  rsvp: { bg: '#0FA6A6', text: 'RSVP', textColor: '#FFFFFF' },
  accept: { bg: '#0FA6A6', text: 'Accept', textColor: '#FFFFFF' },
  followBack: { bg: '#0FA6A6', text: 'Follow back', textColor: '#FFFFFF' },
  custom: { bg: '#0FA6A6', text: '', textColor: '#FFFFFF' },
};

export function Pill({ variant, onPress, loading = false, label, disabled = false }: PillProps) {
  const style = VARIANT_STYLES[variant];
  const displayText = label ?? style.text;
  const isFilled = !style.border;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.75}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 6,
        borderRadius: 20,
        backgroundColor: isFilled ? style.bg : style.bg === 'transparent' ? 'transparent' : style.bg,
        borderWidth: style.border ? 1.5 : 0,
        borderColor: style.border ?? 'transparent',
        minWidth: 72,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: loading ? 0.6 : 1,
      }}
    >
      <Text
        style={{
          color: style.textColor,
          fontSize: 12,
          fontWeight: '600',
          fontFamily: 'Inter_600SemiBold',
        }}
      >
        {displayText}
      </Text>
    </TouchableOpacity>
  );
}
