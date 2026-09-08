import React, { useState, useCallback } from "react";
import { View, StyleSheet, Pressable, useWindowDimensions } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  interpolate,
  Extrapolation,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import { shareOrDownload } from "@/lib/export";
import { useToast } from "@/components/Toast";

import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { ProgressBar } from "@/components/ProgressBar";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import type { Flashcard } from "@/types";

interface FlashcardsTabProps {
  flashcards: Flashcard[];
  isGenerating: boolean;
  onGenerate: () => void;
}

export default function FlashcardsTab({
  flashcards,
  isGenerating,
  onGenerate,
}: FlashcardsTabProps) {
  const { theme } = useTheme();
  const { showToast } = useToast();
  const { width: screenWidth } = useWindowDimensions();
  const CARD_WIDTH = screenWidth - Spacing.lg * 4;
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const flipProgress = useSharedValue(0);

  const frontAnimatedStyle = useAnimatedStyle(() => {
    const rotateY = interpolate(
      flipProgress.value,
      [0, 1],
      [0, 180],
      Extrapolation.CLAMP,
    );
    return {
      transform: [{ perspective: 1000 }, { rotateY: `${rotateY}deg` }],
      opacity: interpolate(flipProgress.value, [0, 0.5, 1], [1, 0, 0]),
    };
  });

  const backAnimatedStyle = useAnimatedStyle(() => {
    const rotateY = interpolate(
      flipProgress.value,
      [0, 1],
      [180, 360],
      Extrapolation.CLAMP,
    );
    return {
      transform: [{ perspective: 1000 }, { rotateY: `${rotateY}deg` }],
      opacity: interpolate(flipProgress.value, [0, 0.5, 1], [0, 0, 1]),
    };
  });

  const handleCopyCard = useCallback(async () => {
    if (flashcards.length === 0) return;
    const card = flashcards[currentIndex];
    const text = `Q: ${card.question}\nA: ${card.answer}`;
    await Clipboard.setStringAsync(text);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [flashcards, currentIndex]);

  const handleShareAll = useCallback(async () => {
    if (flashcards.length === 0) return;
    const text = flashcards.map((card, i) => `${i + 1}. Q: ${card.question}\n   A: ${card.answer}`).join('\n\n');
    const html = `<html><body style="font-family:system-ui;padding:20px;"><h1>Flashcards</h1>${flashcards.map((card, i) => `<div style="margin:16px 0;padding:12px;border:1px solid #ddd;border-radius:8px;"><p><strong>Q${i+1}:</strong> ${card.question}</p><p><strong>A:</strong> ${card.answer}</p></div>`).join('')}</body></html>`;
    const result = await shareOrDownload({ html, plainText: text, title: "Flashcards" });
    if (result.method === "copied") {
      showToast({ type: "success", title: "Copied", message: "Flashcards copied to clipboard" });
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [flashcards, showToast]);

  if (flashcards.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <View
          style={[styles.emptyIcon, { backgroundColor: theme.accent + "15" }]}
        >
          <ThemedText
            style={{ fontSize: 24, color: theme.accent, fontWeight: "700" }}
          >
            FC
          </ThemedText>
        </View>
        <ThemedText type="h3" style={styles.emptyTitle}>
          No Flashcards Yet
        </ThemedText>
        <ThemedText
          type="body"
          style={[styles.emptyDescription, { color: theme.textSecondary }]}
        >
          Upload notes, take a photo, or paste text to create flashcards
        </ThemedText>
        <Button
          onPress={onGenerate}
          disabled={isGenerating}
          style={styles.generateButton}
        >
          {isGenerating ? "Generating..." : "Generate Study Materials"}
        </Button>
      </View>
    );
  }

  const currentCard = flashcards[currentIndex];
  const progress = ((currentIndex + 1) / flashcards.length) * 100;

  const handleFlip = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsFlipped(!isFlipped);
    flipProgress.value = withSpring(isFlipped ? 0 : 1, {
      damping: 15,
      stiffness: 150,
    });
  };

  const handleNext = () => {
    if (currentIndex < flashcards.length - 1) {
      Haptics.selectionAsync();
      setCurrentIndex(currentIndex + 1);
      setIsFlipped(false);
      flipProgress.value = 0;
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      Haptics.selectionAsync();
      setCurrentIndex(currentIndex - 1);
      setIsFlipped(false);
      flipProgress.value = 0;
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          Card {currentIndex + 1} of {flashcards.length}
        </ThemedText>
        <ProgressBar progress={progress} style={styles.progress} />
      </View>

      <View style={styles.cardContainer}>
        <Pressable onPress={handleFlip} style={[styles.cardWrapper, { width: CARD_WIDTH, height: CARD_WIDTH * 0.7 }]}>
          <Animated.View
            style={[
              styles.card,
              { backgroundColor: theme.backgroundDefault },
              frontAnimatedStyle,
            ]}
          >
            <View style={styles.cardLabel}>
              <ThemedText type="caption" style={{ color: theme.link }}>
                QUESTION
              </ThemedText>
            </View>
            <ThemedText type="h3" style={styles.cardText}>
              {currentCard.question}
            </ThemedText>
            <ThemedText
              type="small"
              style={[styles.tapHint, { color: theme.textSecondary }]}
            >
              Tap to reveal answer
            </ThemedText>
          </Animated.View>

          <Animated.View
            style={[
              styles.card,
              styles.cardBack,
              { backgroundColor: theme.link + "10" },
              backAnimatedStyle,
            ]}
          >
            <View style={styles.cardLabel}>
              <ThemedText type="caption" style={{ color: theme.success }}>
                ANSWER
              </ThemedText>
            </View>
            <ThemedText type="body" style={styles.cardText}>
              {currentCard.answer}
            </ThemedText>
            {currentCard.sourceQuote ? (
              <View
                style={[
                  styles.sourceQuote,
                  { borderTopColor: theme.border },
                ]}
              >
                <ThemedText
                  type="caption"
                  style={{ color: theme.textSecondary, fontStyle: "italic" }}
                  numberOfLines={3}
                >
                  {`"${currentCard.sourceQuote}"`}
                </ThemedText>
              </View>
            ) : null}
          </Animated.View>
        </Pressable>
      </View>

      <View style={styles.navigation}>
        <Pressable
          onPress={handlePrev}
          disabled={currentIndex === 0}
          style={[
            styles.navButton,
            { backgroundColor: theme.backgroundSecondary },
            currentIndex === 0 && styles.navButtonDisabled,
          ]}
          accessibilityLabel="Previous card"
          accessibilityRole="button"
          accessibilityState={{ disabled: currentIndex === 0 }}
        >
          <Icon
            name="chevron-left"
            size={22}
            color={currentIndex === 0 ? theme.textSecondary : theme.text}
          />
        </Pressable>

        <Pressable
          onPress={handleFlip}
          style={[styles.flipButton, { backgroundColor: theme.link }]}
          accessibilityLabel="Flip card to reveal answer"
          accessibilityRole="button"
        >
          <ThemedText style={styles.flipButtonText}>Flip</ThemedText>
        </Pressable>

        <Pressable
          onPress={handleNext}
          disabled={currentIndex === flashcards.length - 1}
          style={[
            styles.navButton,
            { backgroundColor: theme.backgroundSecondary },
            currentIndex === flashcards.length - 1 && styles.navButtonDisabled,
          ]}
          accessibilityLabel="Next card"
          accessibilityRole="button"
          accessibilityState={{ disabled: currentIndex === flashcards.length - 1 }}
        >
          <Icon
            name="chevron-right"
            size={22}
            color={currentIndex === flashcards.length - 1 ? theme.textSecondary : theme.text}
          />
        </Pressable>
      </View>

      <View style={styles.cardActions}>
        <Pressable
          onPress={handleCopyCard}
          style={[styles.cardActionButton, { backgroundColor: theme.success + "12" }]}
          accessibilityLabel="Copy this card to clipboard"
          accessibilityRole="button"
        >
          <Icon name="copy" size={16} color={theme.success} />
          <ThemedText type="small" style={{ color: theme.success, fontWeight: "600" }}>Copy Card</ThemedText>
        </Pressable>
        <Pressable
          onPress={handleShareAll}
          style={[styles.cardActionButton, { backgroundColor: theme.info + "12" }]}
          accessibilityLabel="Share all flashcards"
          accessibilityRole="button"
        >
          <Icon name="share" size={16} color={theme.info} />
          <ThemedText type="small" style={{ color: theme.info, fontWeight: "600" }}>Share All</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing["2xl"],
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: BorderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xl,
  },
  emptyTitle: {
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  emptyDescription: {
    textAlign: "center",
    marginBottom: Spacing["2xl"],
  },
  generateButton: {
    minWidth: 200,
  },
  header: {
    marginBottom: Spacing.xl,
  },
  progress: {
    marginTop: Spacing.sm,
  },
  cardContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  cardWrapper: {
    // width and height applied inline via CARD_WIDTH from useWindowDimensions
  },
  card: {
    position: "absolute",
    width: "100%",
    height: "100%",
    borderRadius: BorderRadius.xl,
    padding: Spacing["2xl"],
    backfaceVisibility: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
  cardBack: {
    position: "absolute",
  },
  cardLabel: {
    position: "absolute",
    top: Spacing.lg,
    left: Spacing.lg,
  },
  cardText: {
    textAlign: "center",
    paddingHorizontal: Spacing.md,
  },
  tapHint: {
    position: "absolute",
    bottom: Spacing.lg,
  },
  sourceQuote: {
    marginTop: Spacing.lg,
    paddingTop: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderTopWidth: 1,
    maxWidth: "100%",
  },
  navigation: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: Spacing.xl,
    gap: Spacing.lg,
  },
  navButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  navButtonDisabled: {
    opacity: 0.5,
  },
  flipButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.full,
    gap: Spacing.sm,
  },
  flipButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
  cardActions: {
    flexDirection: "row",
    justifyContent: "center",
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  cardActionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
  },
});
