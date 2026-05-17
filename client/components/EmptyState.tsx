import React from "react";
import { View, StyleSheet, Image, ImageSourcePropType } from "react-native";
import { Icon } from "@/components/Icon";

import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";

interface EmptyStateProps {
  image?: ImageSourcePropType;
  icon?: string;
  iconColor?: string;
  title: string;
  description?: string;
  buttonLabel?: string;
  onButtonPress?: () => void;
  secondaryButtonLabel?: string;
  onSecondaryButtonPress?: () => void;
  compact?: boolean;
}

export function EmptyState({
  image,
  icon,
  iconColor,
  title,
  description,
  buttonLabel,
  onButtonPress,
  secondaryButtonLabel,
  onSecondaryButtonPress,
  compact = false,
}: EmptyStateProps) {
  const { theme } = useTheme();
  const finalIconColor = iconColor || theme.link;

  return (
    <View
      style={[styles.container, compact && styles.compactContainer]}
      accessibilityRole="summary"
      accessibilityLabel={`${title}. ${description || ""}`}
    >
      {image ? (
        <Image
          source={image}
          style={[styles.image, compact && styles.compactImage]}
          resizeMode="contain"
          accessibilityElementsHidden
        />
      ) : icon ? (
        <View
          style={[
            styles.iconContainer,
            { backgroundColor: finalIconColor + "12" },
            compact && styles.compactIconContainer,
          ]}
          accessibilityElementsHidden
        >
          <Icon name={icon} size={compact ? 28 : 40} color={finalIconColor} />
        </View>
      ) : null}

      <ThemedText type={compact ? "h4" : "h2"} style={styles.title}>
        {title}
      </ThemedText>

      {description ? (
        <ThemedText
          type="body"
          style={[styles.description, { color: theme.textSecondary }]}
        >
          {description}
        </ThemedText>
      ) : null}

      {buttonLabel && onButtonPress ? (
        <View style={styles.buttonContainer}>
          <Button
            onPress={onButtonPress}
            size="lg"
            style={styles.primaryButton}
            accessibilityLabel={buttonLabel}
          >
            {buttonLabel}
          </Button>

          {secondaryButtonLabel && onSecondaryButtonPress ? (
            <Button
              onPress={onSecondaryButtonPress}
              variant="ghost"
              size="md"
              accessibilityLabel={secondaryButtonLabel}
            >
              {secondaryButtonLabel}
            </Button>
          ) : null}
        </View>
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
    paddingVertical: Spacing["2xl"],
  },
  image: {
    width: 140,
    height: 140,
    marginBottom: Spacing["2xl"],
    opacity: 0.9,
  },
  compactImage: {
    width: 100,
    height: 100,
    marginBottom: Spacing.lg,
  },
  iconContainer: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xl,
  },
  compactIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    marginBottom: Spacing.lg,
  },
  title: {
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  description: {
    textAlign: "center",
    maxWidth: 300,
    lineHeight: 22,
    marginBottom: Spacing["2xl"],
  },
  buttonContainer: {
    alignItems: "center",
    gap: Spacing.sm,
    width: "100%",
    paddingHorizontal: Spacing.lg,
  },
  primaryButton: {
    minWidth: 220,
    paddingHorizontal: Spacing["2xl"],
  },
});
