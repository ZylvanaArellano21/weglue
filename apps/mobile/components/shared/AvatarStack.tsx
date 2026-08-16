import { memo } from 'react';
import { View } from 'react-native';
import { Avatar } from './Avatar';

interface AvatarItem {
  id: string;
  avatar_url: string | null;
  username?: string;
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
            zIndex: i,
          }}
        >
          <Avatar uri={a.avatar_url} size={size} username={a.username} />
        </View>
      ))}
    </View>
  );
});
