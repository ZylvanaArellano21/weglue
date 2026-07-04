import { useRef } from 'react';
import {
  View,
  Text,
  Animated,
  PanResponder,
  TouchableOpacity,
  StyleSheet,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { profileColors, profileFonts } from './profileTheme';

const DELETE_WIDTH = 80;
const SWIPE_THRESHOLD = 50;

interface SwipeableDeleteRowProps {
  children: React.ReactNode;
  onDelete: () => void;
  style?: ViewStyle;
}

export function SwipeableDeleteRow({ children, onDelete, style }: SwipeableDeleteRowProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const openRef = useRef(false);

  const snapTo = (open: boolean) => {
    openRef.current = open;
    Animated.spring(translateX, {
      toValue: open ? -DELETE_WIDTH : 0,
      useNativeDriver: true,
      tension: 120,
      friction: 14,
    }).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > Math.abs(g.dy) && Math.abs(g.dx) > 8,
      onPanResponderMove: (_, g) => {
        const next = Math.min(0, Math.max(-DELETE_WIDTH, g.dx + (openRef.current ? -DELETE_WIDTH : 0)));
        translateX.setValue(next);
      },
      onPanResponderRelease: (_, g) => {
        const current = (translateX as any)._value as number;
        if (current < -SWIPE_THRESHOLD || g.vx < -0.5) {
          snapTo(true);
        } else {
          snapTo(false);
        }
      },
    }),
  ).current;

  return (
    <View style={[styles.wrapper, style]}>
      <View style={styles.deleteAction}>
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={() => {
            snapTo(false);
            onDelete();
          }}
          activeOpacity={0.8}
        >
          <Ionicons name="trash-outline" size={22} color={profileColors.white} />
          <Text style={styles.deleteLabel}>Delete</Text>
        </TouchableOpacity>
      </View>
      <Animated.View
        style={[styles.content, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    overflow: 'hidden',
    borderRadius: 12,
    marginBottom: 10,
  },
  deleteAction: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'flex-end',
    justifyContent: 'center',
    backgroundColor: profileColors.alertRed,
  },
  deleteBtn: {
    width: DELETE_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  deleteLabel: {
    color: profileColors.white,
    fontSize: 11,
    fontFamily: profileFonts.semiBold,
  },
  content: {
    backgroundColor: profileColors.white,
  },
});
