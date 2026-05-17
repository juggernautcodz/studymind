import React from "react";
import { StyleSheet, View, ActivityIndicator } from "react-native";
import Animated, {
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  useSharedValue,
} from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";

interface LoadingStateProps {
  message?: string;
  fullScreen?: boolean;
  size?: "small" | "large";
}

export function LoadingState({
  message = "Loading...",
  fullScreen = false,
  size = "large",
}: LoadingStateProps) {
  const { theme } = useTheme();
  const opacity = useSharedValue(0.5);

  React.useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 800 }),
        withTiming(0.5, { duration: 800 }),
      ),
      -1,
      true,
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const content = (
    <View style={styles.content}>
      <ActivityIndicator
        size={size}
        color={theme.link}
        style={styles.spinner}
      />
      <Animated.View style={animatedStyle}>
        <ThemedText
          type="body"
          style={[styles.message, { color: theme.textSecondary }]}
        >
          {message}
        </ThemedText>
      </Animated.View>
    </View>
  );

  if (fullScreen) {
    return <ThemedView style={styles.fullScreen}>{content}</ThemedView>;
  }

  return <View style={styles.container}>{content}</View>;
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing["3xl"],
    alignItems: "center",
    justifyContent: "center",
  },
  fullScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    alignItems: "center",
  },
  spinner: {
    marginBottom: Spacing.md,
  },
  message: {
    textAlign: "center",
  },
});
