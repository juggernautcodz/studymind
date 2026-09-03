import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { StyleSheet, View, Pressable } from "react-native";
import Animated, {
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/Icon";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Shadows } from "@/constants/theme";
import { generateToastId } from "@/lib/toastId";

type ToastType = "success" | "error" | "info" | "warning";

interface ToastMessage {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastContextType {
  showToast: (toast: Omit<ToastMessage, "id"> & { id?: string }) => void;
  hideToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastMessage;
  onDismiss: () => void;
}) {
  const { theme } = useTheme();
  const translateY = useSharedValue(-100);
  const opacity = useSharedValue(0);

  React.useEffect(() => {
    translateY.value = withSpring(0, { damping: 15, stiffness: 150 });
    opacity.value = withTiming(1, { duration: 200 });

    const timeout = setTimeout(() => {
      dismiss();
    }, toast.duration || 4500);

    return () => clearTimeout(timeout);
  }, []);

  const dismiss = () => {
    translateY.value = withTiming(-100, { duration: 200 });
    opacity.value = withTiming(0, { duration: 200 }, () => {
      runOnJS(onDismiss)();
    });
  };

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  const getIconName = (): string => {
    switch (toast.type) {
      case "success":
        return "check-circle";
      case "error":
        return "x-circle";
      case "warning":
        return "alert-triangle";
      case "info":
        return "info";
    }
  };

  const getIconColor = () => {
    switch (toast.type) {
      case "success":
        return theme.success;
      case "error":
        return theme.error;
      case "warning":
        return theme.warning;
      case "info":
        return theme.info;
    }
  };

  const getBackgroundColor = () => {
    const color = getIconColor();
    return color + "15";
  };

  return (
    <Animated.View
      style={[
        styles.toast,
        {
          backgroundColor: theme.backgroundDefault,
          borderLeftColor: getIconColor(),
          ...Shadows.lg,
        },
        animatedStyle,
      ]}
    >
      <View
        style={[
          styles.iconContainer,
          { backgroundColor: getBackgroundColor() },
        ]}
      >
        <Icon name={getIconName()} size={20} color={getIconColor()} />
      </View>
      <View style={styles.textContainer}>
        <ThemedText type="h4" style={styles.title}>
          {toast.title}
        </ThemedText>
        {toast.message ? (
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            {toast.message}
          </ThemedText>
        ) : null}
      </View>
      <Pressable onPress={dismiss} hitSlop={8} style={styles.closeButton}>
        <Icon name="x" size={18} color={theme.textSecondary} />
      </Pressable>
    </Animated.View>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = useCallback(
    (toast: Omit<ToastMessage, "id"> & { id?: string }) => {
      const newToast: ToastMessage = {
        ...toast,
        id: toast.id ?? generateToastId(),
      };

      setToasts((prev) => {
        const alreadyExists = prev.some(
          (t) => t.title === newToast.title && t.type === newToast.type,
        );
        return alreadyExists ? prev : [...prev, newToast];
      });
    },
    [],
  );

  const hideToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast, hideToast }}>
      {children}
      <View
        style={[
          styles.container,
          // Math.max guards against unreliable safe-area insets inside
          // native-modal-presented screens (e.g. BillingScreen on iOS),
          // where insets.top can read too small and let the toast render
          // under the notch/Dynamic Island instead of clearing it.
          { top: Math.max(insets.top, 44) + Spacing.md },
        ]}
      >
        {toasts.map((toast, index) => (
          <ToastItem
            key={toast.id ?? `${toast.title}-${index}`}
            toast={toast}
            onDismiss={() => toast.id && hideToast(toast.id)}
          />
        ))}
      </View>
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: Spacing.lg,
    right: Spacing.lg,
    zIndex: 9999,
    gap: Spacing.sm,
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderLeftWidth: 4,
    gap: Spacing.md,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  textContainer: {
    flex: 1,
  },
  title: {
    marginBottom: 2,
  },
  closeButton: {
    padding: Spacing.xs,
  },
});
