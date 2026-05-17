import React from "react";
import { View, StyleSheet } from "react-native";
import { Icon } from "@/components/Icon";
import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  compact?: boolean;
  icon?: string;
}

export function ErrorState({
  title = "Something went wrong",
  message = "We couldn't load this content. Please check your connection and try again.",
  onRetry,
  retryLabel = "Try Again",
  compact = false,
  icon = "alert-triangle",
}: ErrorStateProps) {
  const { theme } = useTheme();

  return (
    <View
      style={[styles.container, compact && styles.compactContainer]}
      accessibilityRole="alert"
      accessibilityLabel={`${title}. ${message}`}
    >
      <View
        style={[
          styles.iconContainer,
          { backgroundColor: theme.error + "12" },
          compact && styles.compactIconContainer,
        ]}
        accessibilityElementsHidden
      >
        <Icon name={icon} size={compact ? 24 : 32} color={theme.error} />
      </View>

      <ThemedText type={compact ? "h4" : "h3"} style={styles.title}>
        {title}
      </ThemedText>

      <ThemedText
        type="body"
        style={[styles.message, { color: theme.textSecondary }]}
      >
        {message}
      </ThemedText>

      {onRetry ? (
        <Button
          onPress={onRetry}
          variant="secondary"
          size={compact ? "sm" : "md"}
          icon={<Icon name="refresh-cw" size={16} color={theme.link} />}
          style={styles.retryButton}
          accessibilityLabel={retryLabel}
        >
          {retryLabel}
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing["2xl"],
    paddingVertical: Spacing["4xl"],
  },
  compactContainer: {
    flex: 0,
    paddingVertical: Spacing["2xl"],
  },
  iconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xl,
  },
  compactIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginBottom: Spacing.lg,
  },
  title: {
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  message: {
    textAlign: "center",
    maxWidth: 300,
    lineHeight: 22,
    marginBottom: Spacing["2xl"],
  },
  retryButton: {
    minWidth: 160,
  },
});
