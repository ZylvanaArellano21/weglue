import { memo } from 'react';
import { View, Text } from 'react-native';
import { Image } from 'expo-image';
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
        contentFit="cover"
        transition={0}
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

  // Real image URI. `cachePolicy="memory-disk"` is the whole point of this
  // component: unlike core RN Image, expo-image keys its disk+memory cache by
  // URI, so the same avatar rendered again — after scrolling a feed, after a
  // navigation, after a background/foreground cycle — decodes from cache
  // instead of hitting the network and re-decoding every time. `recyclingKey`
  // prevents a stale frame flashing when this exact <Image> slot is reused by
  // FlatList for a different avatar URI (list virtualization).
  if (resizedUri) {
    return (
      <Image
        source={{ uri: resizedUri }}
        recyclingKey={resizedUri}
        cachePolicy="memory-disk"
        contentFit="cover"
        transition={0}
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
