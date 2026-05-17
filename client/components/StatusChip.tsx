import React from "react";
import { StyleSheet, View } from "react-native";
import { Icon } from "@/components/Icon";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";

type ChipVariant = "default" | "success" | "warning" | "error" | "info";

interface StatusChipProps {
  label: string;
  variant?: ChipVariant;
  icon?: string;
  filled?: boolean;
}

export function StatusChip({
  label,
  variant = "default",
  icon,
  filled = false,
}: StatusChipProps) {
  const { theme } = useTheme();

  const getColor = () => {
    switch (variant) {
      case "success":
        return theme.success;
      case "warning":
        return theme.warning;
      case "error":
        return theme.error;
      case "info":
        return theme.info;
      default:
        return theme.textSecondary;
    }
  };

  const color = getColor();

  return (
    <View
      style={[
        styles.chip,
        {
          backgroundColor: filled ? color : color + "15",
          borderColor: color,
        },
      ]}
    >
      {icon ? (
        <Icon
          name={icon}
          size={12}
          color={filled ? "#fff" : color}
          style={styles.icon}
        />
      ) : null}
      <ThemedText
        type="caption"
        style={[styles.label, { color: filled ? "#fff" : color }]}
      >
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
  },
  icon: {
    marginRight: 4,
  },
  label: {
    fontWeight: "600",
  },
});
