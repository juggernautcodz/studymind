import React from "react";
import { View, StyleSheet, ViewStyle } from "react-native";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";

type BadgeVariant = "default" | "success" | "warning" | "error" | "info";

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  style?: ViewStyle;
}

export function Badge({ label, variant = "default", style }: BadgeProps) {
  const { theme, isDark } = useTheme();

  const getColors = () => {
    switch (variant) {
      case "success":
        return {
          bg: isDark ? "rgba(16, 185, 129, 0.2)" : "rgba(16, 185, 129, 0.1)",
          text: theme.success,
        };
      case "warning":
        return {
          bg: isDark ? "rgba(245, 158, 11, 0.2)" : "rgba(245, 158, 11, 0.1)",
          text: theme.warning,
        };
      case "error":
        return {
          bg: isDark ? "rgba(239, 68, 68, 0.2)" : "rgba(239, 68, 68, 0.1)",
          text: theme.error,
        };
      case "info":
        return {
          bg: isDark ? "rgba(59, 130, 246, 0.2)" : "rgba(59, 130, 246, 0.1)",
          text: theme.info,
        };
      default:
        return {
          bg: isDark ? "rgba(107, 114, 128, 0.2)" : "rgba(107, 114, 128, 0.1)",
          text: theme.textSecondary,
        };
    }
  };

  const colors = getColors();

  return (
    <View style={[styles.badge, { backgroundColor: colors.bg }, style]}>
      <ThemedText type="caption" style={[styles.label, { color: colors.text }]}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.xs,
  },
  label: {
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
});
