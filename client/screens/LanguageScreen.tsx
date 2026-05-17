import React from "react";
import { View, StyleSheet, ScrollView, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { Icon } from "@/components/Icon";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useTheme } from "@/hooks/useTheme";
import {
  useLanguage,
  SUPPORTED_LANGUAGES,
  LanguageCode,
} from "@/contexts/LanguageContext";
import { Spacing, BorderRadius } from "@/constants/theme";

// RTL indicator languages
const RTL_LANGUAGES = new Set(["ar"]);

export default function LanguageScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { language, setLanguage } = useLanguage();

  const handleSelectLanguage = async (code: LanguageCode) => {
    if (code === language) return;
    Haptics.selectionAsync();
    await setLanguage(code);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  return (
    <ThemedView style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: headerHeight + Spacing.xl,
            paddingBottom: insets.bottom + Spacing["2xl"],
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header description */}
        <View style={[styles.descriptionCard, { backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}>
          <View style={[styles.descriptionIcon, { backgroundColor: "#7C3AED15" }]}>
            <Icon name="globe" size={22} color="#7C3AED" />
          </View>
          <ThemedText
            type="small"
            style={[styles.descriptionText, { color: theme.textSecondary }]}
          >
            Choose your preferred language for the app interface. For Arabic, the layout will switch to RTL automatically.
          </ThemedText>
        </View>

        {/* Language list */}
        <View style={[styles.languageCard, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
          {SUPPORTED_LANGUAGES.map((lang, index) => {
            const isSelected = language === lang.code;
            const isRTLLang = RTL_LANGUAGES.has(lang.code);

            return (
              <React.Fragment key={lang.code}>
                {index > 0 ? (
                  <View style={[styles.divider, { backgroundColor: theme.border }]} />
                ) : null}
                <Pressable
                  style={({ pressed }) => [
                    styles.languageItem,
                    isSelected && {
                      backgroundColor: "#7C3AED12",
                    },
                    pressed && !isSelected && {
                      backgroundColor: theme.backgroundSecondary,
                    },
                  ]}
                  onPress={() => handleSelectLanguage(lang.code)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: isSelected }}
                  accessibilityLabel={`${lang.nativeName} (${lang.name})`}
                >
                  <View style={styles.languageInfo}>
                    <View style={styles.langNameRow}>
                      <ThemedText
                        type="body"
                        style={[
                          styles.languageName,
                          isSelected && { color: "#9F67FF", fontWeight: "700" },
                        ]}
                      >
                        {lang.nativeName}
                      </ThemedText>
                      {isRTLLang ? (
                        <View style={[styles.rtlBadge, { backgroundColor: "#3B82F615" }]}>
                          <ThemedText type="caption" style={{ color: "#3B82F6", fontWeight: "700" }}>
                            RTL
                          </ThemedText>
                        </View>
                      ) : null}
                    </View>
                    <ThemedText
                      type="small"
                      style={{ color: theme.textSecondary }}
                    >
                      {lang.name}
                    </ThemedText>
                  </View>

                  {isSelected ? (
                    <View style={[styles.checkCircle, { backgroundColor: "#7C3AED" }]}>
                      <Icon name="check" size={14} color="white" />
                    </View>
                  ) : (
                    <View style={[styles.uncheckCircle, { borderColor: theme.border }]} />
                  )}
                </Pressable>
              </React.Fragment>
            );
          })}
        </View>

        {/* Note card */}
        <View style={[styles.noteCard, { backgroundColor: "#3B82F608", borderColor: "#3B82F620" }]}>
          <Icon name="info" size={15} color="#3B82F6" />
          <ThemedText
            type="small"
            style={[styles.noteText, { color: theme.textSecondary }]}
          >
            AI-generated study materials (notes, flashcards, quizzes) will be in the language of your input content, regardless of this setting.
          </ThemedText>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
  },
  descriptionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginBottom: Spacing.xl,
  },
  descriptionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  descriptionText: {
    flex: 1,
    lineHeight: 20,
  },
  languageCard: {
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: Spacing.xl,
    shadowColor: "#7C3AED",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  languageItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.lg,
  },
  languageInfo: {
    flex: 1,
    marginRight: Spacing.md,
  },
  langNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: 2,
  },
  languageName: {
    fontWeight: "500",
  },
  rtlBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  uncheckCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    flexShrink: 0,
  },
  divider: {
    height: 1,
    marginLeft: Spacing.lg,
  },
  noteCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    gap: Spacing.sm,
  },
  noteText: {
    flex: 1,
    lineHeight: 18,
  },
});
