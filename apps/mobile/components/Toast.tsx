import { useEffect, useRef, useState } from 'react';
import { Animated, Text, Platform } from 'react-native';

export type ToastType = 'success' | 'error' | 'info';

interface ToastState {
  visible: boolean;
  message: string;
  type: ToastType;
}

const BG: Record<ToastType, string> = {
  success: '#0FA6A6',
  error: '#F02719',
  info: '#1A1A1A',
};

interface InlineToastProps {
  message: string;
  type?: ToastType;
  visible: boolean;
}

export function InlineToast({ message, type = 'success', visible }: InlineToastProps) {
  const translateY = useRef(new Animated.Value(-80)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, tension: 90, friction: 11 }),
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateY, { toValue: -80, duration: 220, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }),
      ]).start();
    }
  }, [visible, opacity, translateY]);

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: Platform.OS === 'ios' ? 54 : 44,
        left: 20,
        right: 20,
        zIndex: 9999,
        transform: [{ translateY }],
        opacity,
        backgroundColor: BG[type],
        borderRadius: 10,
        paddingHorizontal: 16,
        paddingVertical: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 6,
        elevation: 6,
        alignSelf: 'center',
        maxWidth: '100%',
      }}
    >
      <Text
        style={{
          color: '#FFFFFF',
          fontSize: 13,
          fontWeight: '600',
          textAlign: 'center',
          fontFamily: 'Inter_600SemiBold',
        }}
        numberOfLines={2}
      >
        {message}
      </Text>
    </Animated.View>
  );
}

export function useToast(duration = 2800) {
  const [toast, setToast] = useState<ToastState>({ visible: false, message: '', type: 'success' });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function show(message: string, type: ToastType = 'success') {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast({ visible: true, message, type });
    timerRef.current = setTimeout(() => {
      setToast((prev) => ({ ...prev, visible: false }));
    }, duration);
  }

  function hide() {
    setToast((prev) => ({ ...prev, visible: false }));
  }

  const ToastComponent = (
    <InlineToast visible={toast.visible} message={toast.message} type={toast.type} />
  );

  return { show, hide, ToastComponent, toast };
}
