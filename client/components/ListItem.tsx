import React from "react";
import { View, StyleSheet, Pressable, ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { Icon } from "@/components/Icon";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";

interface ListItemProps {
  title: string;
  subtitle?: string;
  leftIcon?: string;
  leftIconColor?: string;
  rightIcon?: string;
  rightContent?: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  style?: ViewStyle;
  testID?: string;
  accessibilityLabel?: string;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function ListItem({
  title,
  subtitle,
  leftIcon,
  leftIconColor,
  rightIcon = "chevron-right",
  rightContent,
  onPress,
  onLongPress,
  disabled,
  style,
  testID,
  accessibilityLabel,
}: ListItemProps) {
  const { theme } = useTheme();
  const pressed = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    backgroundColor:
      pressed.value > 0 ? theme.backgroundSecondary : theme.backgroundDefault,
    transform: [{ scale: 1 - pressed.value * 0.01 }],
  }));

  const handlePressIn = () => {
    pressed.value = withTiming(1, { duration: 100 });
  };

  const handlePressOut = () => {
    pressed.value = withTiming(0, { duration: 150 });
  };

  return (
    <AnimatedPressable
      onPress={disabled ? undefined : onPress}
      onLongPress={disabled ? undefined : onLongPress}
      onPressIn={disabled ? undefined : handlePressIn}
      onPressOut={disabled ? undefined : handlePressOut}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityHint={subtitle}
      accessibilityState={{ disabled }}
      style={[styles.container, animatedStyle, style, disabled && { opacity: 0.5 }]}
      testID={testID}
    >
      {leftIcon ? (
        <View
          style={[
            styles.iconContainer,
            { backgroundColor: (leftIconColor || theme.link) + "15" },
          ]}
        >
          <Icon name={leftIcon} size={20} color={leftIconColor || theme.link} />
        </View>
      ) : null}
      <View style={styles.content}>
        <ThemedText type="body" style={styles.title} numberOfLines={1}>
          {title}
        </ThemedText>
        {subtitle ? (
          <ThemedText
            type="small"
            style={[styles.subtitle, { color: theme.textSecondary }]}
            numberOfLines={1}
          >
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
      {rightContent ? (
        rightContent
      ) : rightIcon ? (
        <Icon name={rightIcon} size={20} color={theme.textSecondary} />
      ) : null}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    minHeight: 56,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.xs,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.md,
  },
  content: {
    flex: 1,
    marginRight: Spacing.md,
  },
  title: {
    fontWeight: "500",
  },
  subtitle: {
    marginTop: 2,
  },
});
