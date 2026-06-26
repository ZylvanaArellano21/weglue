import { View, Image } from 'react-native';

interface AvatarItem {
  id: string;
  avatar_url: string | null;
}

interface AvatarStackProps {
  avatars: AvatarItem[];
  size?: number;
  overlap?: number;
  maxCount?: number;
}

export function AvatarStack({ avatars, size = 28, overlap = 8, maxCount = 4 }: AvatarStackProps) {
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
            borderWidth: 2,
            borderColor: '#FEFCF0',
            overflow: 'hidden',
            backgroundColor: '#E5E7EB',
            zIndex: i,
          }}
        >
          {a.avatar_url ? (
            <Image
              source={{ uri: a.avatar_url }}
              style={{ width: size, height: size }}
            />
          ) : (
            <View style={{ width: size, height: size, backgroundColor: '#0FA6A6' }} />
          )}
        </View>
      ))}
    </View>
  );
}
