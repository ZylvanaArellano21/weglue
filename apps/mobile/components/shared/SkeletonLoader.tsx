import { useEffect, useRef } from 'react';
import { Animated, View, ViewStyle } from 'react-native';

interface SkeletonProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export function Skeleton({ width = '100%', height = 16, borderRadius = 8, style }: SkeletonProps) {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        {
          width: width as number,
          height,
          borderRadius,
          backgroundColor: '#D1D5DB',
          opacity,
        },
        style,
      ]}
    />
  );
}

export function EventCardSkeleton() {
  return (
    <View
      style={{
        backgroundColor: '#fff',
        borderRadius: 16,
        marginHorizontal: 16,
        marginBottom: 16,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.07,
        shadowRadius: 8,
        elevation: 3,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 }}>
        <Skeleton width={32} height={32} borderRadius={16} />
        <Skeleton width={140} height={14} />
        <View style={{ flex: 1 }} />
        <Skeleton width={64} height={28} borderRadius={14} />
      </View>
      <Skeleton width="100%" height={180} borderRadius={0} />
      <View style={{ padding: 12, gap: 8 }}>
        <Skeleton width="80%" height={18} />
        <Skeleton width="60%" height={13} />
        <Skeleton width="50%" height={13} />
        <Skeleton width="45%" height={13} />
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
          <Skeleton width={80} height={28} borderRadius={14} />
          <View style={{ flex: 1 }} />
          <Skeleton width={72} height={34} borderRadius={17} />
        </View>
      </View>
    </View>
  );
}

export function PostCardSkeleton() {
  return (
    <View
      style={{
        backgroundColor: '#fff',
        borderRadius: 16,
        marginHorizontal: 16,
        marginBottom: 16,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.07,
        shadowRadius: 8,
        elevation: 3,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 }}>
        <Skeleton width={40} height={40} borderRadius={20} />
        <View style={{ gap: 6 }}>
          <Skeleton width={100} height={14} />
          <Skeleton width={80} height={12} />
        </View>
        <View style={{ flex: 1 }} />
        <Skeleton width={80} height={28} borderRadius={14} />
      </View>
      <Skeleton width="100%" height={220} borderRadius={0} />
      <View style={{ padding: 12, gap: 8 }}>
        <View style={{ flexDirection: 'row', gap: 16 }}>
          <Skeleton width={50} height={16} />
          <Skeleton width={50} height={16} />
          <Skeleton width={40} height={16} />
        </View>
        <Skeleton width="75%" height={14} />
        <Skeleton width="35%" height={12} />
      </View>
    </View>
  );
}
