import React, { ReactNode } from "react";
import { StyleSheet, View, Pressable } from "react-native";
import { Icon } from "@/components/Icon";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  action?: {
    label: string;
    onPress: () => void;
    icon?: string;
  };
  icon?: string;
  children?: ReactNode;
}

export function SectionHeader({
  title,
  subtitle,
  action,
  icon,
  children,
}: SectionHeaderProps) {
  const { theme } = useTheme();

  return (
    <View style={styles.container}>
      <View style={styles.left}>
        {icon ? (
          <View
            style={[
              styles.iconContainer,
              { backgroundColor: theme.link + "15" },
            ]}
          >
            <Icon name={icon} size={16} color={theme.link} />
          </View>
        ) : null}
        <View style={styles.textContainer}>
          <ThemedText type="h3" style={styles.title}>
            {title}
          </ThemedText>
          {subtitle ? (
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {subtitle}
            </ThemedText>
          ) : null}
        </View>
      </View>
      {action ? (
        <Pressable
          onPress={action.onPress}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={styles.action}
          accessibilityRole="button"
          accessibilityLabel={action.label}
        >
          {action.icon ? (
            <Icon
              name={action.icon}
              size={16}
              color={theme.link}
              style={styles.actionIcon}
            />
          ) : null}
          <ThemedText
            type="small"
            style={{ color: theme.link, fontWeight: "600" }}
          >
            {action.label}
          </ThemedText>
        </Pressable>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.md,
    minHeight: 48,
  },
  left: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  iconContainer: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.sm,
  },
  textContainer: {
    flex: 1,
  },
  title: {},
  action: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
    minHeight: 44,
  },
  actionIcon: {
    marginRight: Spacing.xs,
  },
});
