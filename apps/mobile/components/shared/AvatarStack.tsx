import { memo } from 'react';
import { View, Image } from 'react-native';
import { parsePresetColor } from './Avatar';
import { getResizedImageUrl } from '../../lib/imageResize';

interface AvatarItem {
  id: string;
  avatar_url: string | null;
}

interface AvatarStackProps {
  avatars: AvatarItem[];
  size?: number;
  overlap?: number;
  maxCount?: number;
  borderWidth?: number;
}

export const AvatarStack = memo(function AvatarStack({
  avatars,
  size = 28,
  overlap = 8,
  maxCount = 4,
  borderWidth = 2,
}: AvatarStackProps) {
  const displayed = avatars.slice(0, maxCount);
  const totalWidth = displayed.length > 0
    ? size + (displayed.length - 1) * (size - overlap)
    : 0;

  return (
    <View style={{ width: totalWidth, height: size, position: 'relative' }}>
      {displayed.map((a, i) => (
        <View
          key={a.id}
          style={{
            position: 'absolute',
            left: i * (size - overlap),
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth,
            borderColor: '#FEFCF0',
            overflow: 'hidden',
            backgroundColor: '#E5E7EB',
            zIndex: i,
          }}
        >
          {a.avatar_url && !parsePresetColor(a.avatar_url) ? (
            <Image
              source={{ uri: getResizedImageUrl(a.avatar_url, size * 2) ?? undefined }}
              resizeMode="cover"
              style={{ width: size, height: size }}
            />
          ) : (
            <View
              style={{
                width: size,
                height: size,
                backgroundColor: parsePresetColor(a.avatar_url) ?? '#0FA6A6',
              }}
            />
          )}
        </View>
      ))}
    </View>
  );
});
