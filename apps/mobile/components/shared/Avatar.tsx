import { Image, View, Text } from 'react-native';

interface AvatarProps {
  uri: string | null | undefined;
  size?: number;
  username?: string;
}

/**
 * Returns the hex color when avatar_url is a preset color (e.g. "preset:#2196F3"),
 * or null if the URI is a regular image URL.
 */
export function parsePresetColor(uri: string | null | undefined): string | null {
  if (!uri) return null;
  if (uri.startsWith('preset:')) {
    return uri.slice('preset:'.length);
  }
  return null;
}

export function Avatar({ uri, size = 40, username }: AvatarProps) {
  const initials = username
    ? username.slice(0, 2).toUpperCase()
    : '?';

  const presetColor = parsePresetColor(uri);

  // Preset color avatar — render a solid colored circle
  if (presetColor) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: presetColor,
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

  // Real image URI
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

  // Fallback initials
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
