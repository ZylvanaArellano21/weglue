import { Image, View, Text } from 'react-native';

interface AvatarProps {
  uri: string | null | undefined;
  size?: number;
  username?: string;
}

export function Avatar({ uri, size = 40, username }: AvatarProps) {
  const initials = username
    ? username.slice(0, 2).toUpperCase()
    : '?';

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: '#E5E7EB',
        }}
      />
    );
  }

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: '#0FA6A6',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          color: '#fff',
          fontSize: size * 0.35,
          fontWeight: '700',
        }}
      >
        {initials}
      </Text>
    </View>
  );
}
