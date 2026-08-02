import { memo } from 'react';
import { Image, View, Text } from 'react-native';
import { getResizedImageUrl } from '../../lib/imageResize';
import {
  getPresetAvatar,
  parseLegacyPresetColor,
  parsePresetAvatarId,
  parseTextAvatar as parseTextAvatarValue,
} from '@weglue/shared';
import { getPresetAvatarAsset } from '../../lib/presetAvatarAssets';

interface AvatarProps {
  uri: string | null | undefined;
  size?: number;
  username?: string;
}

export function parsePresetColor(uri: string | null | undefined): string | null {
  return parseLegacyPresetColor(uri);
}

export function parseTextAvatar(uri: string | null | undefined): string | null {
  return parseTextAvatarValue(uri);
}

export const Avatar = memo(function Avatar({ uri, size = 40, username }: AvatarProps) {
  const initials = username
    ? username.slice(0, 2).toUpperCase()
    : '?';

  const presetAvatarId = parsePresetAvatarId(uri);
  const presetColor = parsePresetColor(uri);
  const textContent = parseTextAvatar(uri);
  const resizedUri = getResizedImageUrl(uri, size * 2);

  if (presetAvatarId) {
    const avatar = getPresetAvatar(presetAvatarId);
    return (
      <Image
        source={getPresetAvatarAsset(presetAvatarId)}
        accessibilityRole="image"
        accessibilityLabel={avatar?.label ?? 'We Glue avatar'}
        resizeMode="cover"
        fadeDuration={0}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: '#E5E7EB',
        }}
      />
    );
  }

  if (textContent) {
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
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {textContent}
        </Text>
      </View>
    );
  }

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
  if (resizedUri) {
    return (
      <Image
        source={{ uri: resizedUri }}
        resizeMode="cover"
        fadeDuration={0}
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
});
