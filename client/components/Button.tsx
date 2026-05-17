import React, { ReactNode } from "react";
import {
  StyleSheet,
  Pressable,
  ViewStyle,
  StyleProp,
  ActivityIndicator,
  View,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  WithSpringConfig,
} from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing } from "@/constants/theme";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps {
  onPress?: () => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  loading?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  fullWidth?: boolean;
  testID?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

const springConfig: WithSpringConfig = {
  damping: 15,
  mass: 0.3,
  stiffness: 150,
  overshootClamping: true,
  energyThreshold: 0.001,
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function Button({
  onPress,
  children,
  style,
  disabled = false,
  loading = false,
  variant = "primary",
  size = "md",
  icon,
  fullWidth = false,
  testID,
  accessibilityLabel,
  accessibilityHint,
}: ButtonProps) {
  const { theme } = useTheme();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    if (!disabled && !loading) {
      scale.value = withSpring(0.97, springConfig);
    }
  };

  const handlePressOut = () => {
    if (!disabled && !loading) {
      scale.value = withSpring(1, springConfig);
    }
  };

  const getBackgroundColor = () => {
    if (disabled || loading) {
      switch (variant) {
        case "primary":
          return theme.link + "60";
        case "secondary":
          return theme.backgroundSecondary;
        case "ghost":
          return "transparent";
        case "destructive":
          return theme.error + "60";
      }
    }
    switch (variant) {
      case "primary":
        return theme.link;
      case "secondary":
        return theme.backgroundSecondary;
      case "ghost":
        return "transparent";
      case "destructive":
        return theme.error;
    }
  };

  const getTextColor = () => {
    switch (variant) {
      case "primary":
        return theme.buttonText;
      case "secondary":
        return theme.text;
      case "ghost":
        return theme.link;
      case "destructive":
        return theme.buttonText;
    }
  };

  const getBorderStyle = (): ViewStyle => {
    if (variant === "secondary") {
      return {
        borderWidth: 1,
        borderColor: theme.border,
      };
    }
    if (variant === "ghost") {
      return {};
    }
    return {};
  };

  const getSizeStyle = (): ViewStyle => {
    switch (size) {
      case "sm":
        return {
          height: 44,
          paddingHorizontal: Spacing.lg,
          borderRadius: BorderRadius.sm,
        };
      case "md":
        return {
          height: Spacing.buttonHeight,
          paddingHorizontal: Spacing.xl,
          borderRadius: BorderRadius.lg,
        };
      case "lg":
        return {
          height: 56,
          paddingHorizontal: Spacing["2xl"],
          borderRadius: BorderRadius.xl,
        };
    }
  };

  const getTextSize = () => {
    switch (size) {
      case "sm":
        return { fontSize: 14 };
      case "md":
        return { fontSize: 16 };
      case "lg":
        return { fontSize: 18 };
    }
  };

  const label = typeof children === "string" ? children : undefined;

  return (
    <AnimatedPressable
      onPress={disabled || loading ? undefined : onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      testID={testID}
      style={[
        styles.button,
        getSizeStyle(),
        getBorderStyle(),
        {
          backgroundColor: getBackgroundColor(),
          opacity: disabled ? 0.5 : 1,
          width: fullWidth ? "100%" : undefined,
        },
        style,
        animatedStyle,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={getTextColor()} size="small" />
      ) : (
        <View style={styles.content}>
          {icon ? <View style={styles.icon}>{icon}</View> : null}
          <ThemedText
            type="body"
            style={[
              styles.buttonText,
              getTextSize(),
              { color: getTextColor() },
            ]}
          >
            {children}
          </ThemedText>
        </View>
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  icon: {
    marginRight: Spacing.sm,
  },
  buttonText: {
    fontWeight: "600",
  },
});
