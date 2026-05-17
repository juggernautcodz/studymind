import React, { useEffect } from "react";
import { View, StyleSheet, ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing } from "@/constants/theme";

interface ProgressBarProps {
  progress: number;
  color?: string;
  backgroundColor?: string;
  height?: number;
  style?: ViewStyle;
}

export function ProgressBar({
  progress,
  color,
  backgroundColor,
  height = 8,
  style,
}: ProgressBarProps) {
  const { theme } = useTheme();
  const widthPercent = useSharedValue(Math.min(Math.max(progress, 0), 100));

  useEffect(() => {
    widthPercent.value = withTiming(Math.min(Math.max(progress, 0), 100), {
      duration: 300,
    });
  }, [progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    width: `${widthPercent.value}%`,
  }));

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: backgroundColor || theme.backgroundSecondary,
          height,
        },
        style,
      ]}
    >
      <Animated.View
        style={[
          styles.progress,
          {
            backgroundColor: color || theme.link,
            borderRadius: BorderRadius.full,
          },
          animatedStyle,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    borderRadius: BorderRadius.full,
    overflow: "hidden",
  },
  progress: {
    height: "100%",
  },
});
