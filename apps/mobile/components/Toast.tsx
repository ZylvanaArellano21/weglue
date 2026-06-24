import { useEffect, useRef, useState } from "react";
import { Animated, Text } from "react-native";

export type ToastType = "success" | "error" | "info";

interface ToastState {
  visible: boolean;
  message: string;
  type: ToastType;
}

const BG: Record<ToastType, string> = {
  success: "#0FA6A6",
  error: "#F02719",
  info: "#1A1A1A",
};

interface InlineToastProps {
  message: string;
  type?: ToastType;
  visible: boolean;
}

export function InlineToast({ message, type = "success", visible }: InlineToastProps) {
  const translateY = useRef(new Animated.Value(-100)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }),
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateY, { toValue: -100, duration: 250, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  return (
    <Animated.View
      style={{
        position: "absolute",
        top: 60,
        left: 16,
        right: 16,
        zIndex: 9999,
        transform: [{ translateY }],
        opacity,
        backgroundColor: BG[type],
        borderRadius: 12,
        paddingHorizontal: 20,
        paddingVertical: 14,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 8,
      }}
    >
      <Text style={{ color: "#fff", fontSize: 14, fontWeight: "600", textAlign: "center" }}>
        {message}
      </Text>
    </Animated.View>
  );
}

export function useToast(duration = 3000) {
  const [toast, setToast] = useState<ToastState>({ visible: false, message: "", type: "success" });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function show(message: string, type: ToastType = "success") {
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
