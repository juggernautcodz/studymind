import React from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { Icon } from "@/components/Icon";
import { ThemedText } from "@/components/ThemedText";
import { BottomSheet } from "@/components/BottomSheet";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";

export type ContentDestination = "current" | "new-topic" | "new-section";

interface ContentDestinationSheetProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (destination: ContentDestination) => void;
  sourceLabel?: string;
  topicName?: string;
}

export function ContentDestinationSheet({
  visible,
  onClose,
  onSelect,
  sourceLabel,
  topicName,
}: ContentDestinationSheetProps) {
  const { theme } = useTheme();

  const options: {
    key: ContentDestination;
    icon: "plus-circle" | "folder-plus" | "layers";
    title: string;
    subtitle: string;
    color: string;
  }[] = [
    {
      key: "current",
      icon: "plus-circle",
      title: "Add to this topic",
      subtitle: topicName
        ? `Merge into "${topicName}"`
        : "Merge with existing materials",
      color: theme.link,
    },
    {
      key: "new-topic",
      icon: "folder-plus",
      title: "Create new topic",
      subtitle: "Start a separate topic for this content",
      color: theme.success,
    },
    {
      key: "new-section",
      icon: "layers",
      title: "New section in this topic",
      subtitle: topicName
        ? `Add as a labeled section in "${topicName}"`
        : "Save as a distinct section",
      color: "#8B5CF6",
    },
  ];

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={
        sourceLabel
          ? `Save ${sourceLabel} content`
          : "Where should this go?"
      }
      snapPoints={[0.45]}
    >
      <ThemedText
        type="small"
        style={{ color: theme.textSecondary, marginBottom: Spacing.lg }}
      >
        Choose how to organize this content
      </ThemedText>
      {options.map((opt) => (
        <Pressable
          key={opt.key}
          testID={`destination-${opt.key}`}
          onPress={() => onSelect(opt.key)}
          style={({ pressed }) => [
            styles.option,
            {
              backgroundColor: pressed
                ? theme.backgroundSecondary
                : theme.backgroundDefault,
              borderColor: theme.border,
            },
          ]}
        >
          <View
            style={[
              styles.iconWrap,
              { backgroundColor: opt.color + "18" },
            ]}
          >
            <Icon name={opt.icon} size={20} color={opt.color} />
          </View>
          <View style={styles.optionText}>
            <ThemedText type="body" style={{ fontWeight: "600" }}>
              {opt.title}
            </ThemedText>
            <ThemedText
              type="small"
              style={{ color: theme.textSecondary, marginTop: 2 }}
            >
              {opt.subtitle}
            </ThemedText>
          </View>
          <Icon name="chevron-right" size={18} color={theme.textSecondary} />
        </Pressable>
      ))}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  option: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginBottom: Spacing.sm,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.md,
  },
  optionText: {
    flex: 1,
  },
});
