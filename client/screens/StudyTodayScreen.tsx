import React, { useState, useEffect, useCallback } from "react";
import { View, StyleSheet, ScrollView, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Icon } from "@/components/Icon";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { SectionHeader } from "@/components/SectionHeader";
import { LoadingState } from "@/components/LoadingState";
import { EmptyState } from "@/components/EmptyState";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";
import { storage } from "@/lib/storage";
import { getApiUrl, getAuthHeaders } from "@/lib/query-client";
import { Spacing, BorderRadius } from "@/constants/theme";
import type { Topic, Flashcard } from "@/types";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { v4 as uuidv4 } from "uuid";

interface StudyCard {
  id: string;
  front: string;
  back: string;
  topicName: string;
  topicId: string;
  sourceQuote?: string;
}

export default function StudyTodayScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const { user } = useAuth();

  const [allCards, setAllCards] = useState<StudyCard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [wrongCount, setWrongCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [studyComplete, setStudyComplete] = useState(false);

  const flipProgress = useSharedValue(0);

  const loadStudyData = useCallback(async () => {
    setIsLoading(true);
    try {
      const loadedTopics = await storage.getTopics();

      const cards: StudyCard[] = [];
      for (const topic of loadedTopics) {
        const flashcards = await storage.getFlashcards(topic.id);
        if (flashcards.length > 0) {
          flashcards.forEach((fc) => {
            cards.push({
              id: fc.id,
              front: fc.question,
              back: fc.answer,
              topicName: topic.name,
              topicId: topic.id,
              sourceQuote: fc.sourceQuote,
            });
          });
        }
      }

      const shuffled = cards.sort(() => Math.random() - 0.5);
      setAllCards(shuffled);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadStudyData();
      setCurrentIndex(0);
      setCorrectCount(0);
      setWrongCount(0);
      setShowAnswer(false);
      setStudyComplete(false);
    }, [loadStudyData]),
  );

  const handleFlip = () => {
    Haptics.selectionAsync();
    setShowAnswer(!showAnswer);
    flipProgress.value = withSpring(showAnswer ? 0 : 1);
  };

  const recordReview = useCallback(async (flashcardId: string, correct: boolean, eventId: string) => {
    try {
      const authHeaders = await getAuthHeaders();
      if (!authHeaders.Authorization) return;
      await fetch(
        new URL(`/api/adaptive/flashcards/${flashcardId}/answer`, getApiUrl()).toString(),
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          credentials: "include",
          body: JSON.stringify({ correct, eventId }),
        },
      );
    } catch {
      // Best-effort — due-date tracking degrades gracefully offline; the
      // session score above (correctCount/wrongCount) still works locally.
    }
  }, []);

  const handleAnswer = (correct: boolean) => {
    Haptics.impactAsync(
      correct
        ? Haptics.ImpactFeedbackStyle.Light
        : Haptics.ImpactFeedbackStyle.Medium,
    );

    if (correct) {
      setCorrectCount((c) => c + 1);
    } else {
      setWrongCount((c) => c + 1);
    }

    recordReview(currentCard.id, correct, uuidv4());

    if (currentIndex < allCards.length - 1) {
      setCurrentIndex((i) => i + 1);
      setShowAnswer(false);
      flipProgress.value = 0;
    } else {
      setStudyComplete(true);
    }
  };

  const handleCopyCard = useCallback(async () => {
    if (allCards.length === 0 || currentIndex >= allCards.length) return;
    const card = allCards[currentIndex];
    const text = `Q: ${card.front}\nA: ${card.back}`;
    await Clipboard.setStringAsync(text);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [allCards, currentIndex]);

  const handleRestart = () => {
    setCurrentIndex(0);
    setCorrectCount(0);
    setWrongCount(0);
    setShowAnswer(false);
    setStudyComplete(false);
    flipProgress.value = 0;
    setAllCards((cards) => [...cards].sort(() => Math.random() - 0.5));
  };

  const currentCard = allCards[currentIndex];
  const progress =
    allCards.length > 0 ? ((currentIndex + 1) / allCards.length) * 100 : 0;

  const cardFrontStyle = useAnimatedStyle(() => ({
    opacity: 1 - flipProgress.value,
    transform: [{ rotateY: `${flipProgress.value * 180}deg` }],
  }));

  const cardBackStyle = useAnimatedStyle(() => ({
    opacity: flipProgress.value,
    transform: [{ rotateY: `${180 - flipProgress.value * 180}deg` }],
  }));

  if (isLoading) {
    return (
      <LoadingState fullScreen message="Preparing your study session..." />
    );
  }

  if (allCards.length === 0) {
    return (
      <ThemedView style={styles.container}>
        <View
          style={[
            styles.emptyContainer,
            {
              paddingTop: headerHeight + Spacing["2xl"],
              paddingBottom: insets.bottom + Spacing["2xl"],
            },
          ]}
        >
          <EmptyState
            icon="layers"
            iconColor={theme.success}
            title="No Flashcards Yet"
            description="Add study material to a topic and we'll create flashcards automatically."
            buttonLabel="Go to Home"
            onButtonPress={() =>
              navigation.navigate("Main", { screen: "HomeTab" })
            }
          />
        </View>
      </ThemedView>
    );
  }

  if (studyComplete) {
    const totalAnswered = correctCount + wrongCount;
    const accuracy =
      totalAnswered > 0 ? Math.round((correctCount / totalAnswered) * 100) : 0;

    return (
      <ThemedView style={styles.container}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            {
              paddingTop: headerHeight + Spacing["2xl"],
              paddingBottom: insets.bottom + Spacing["3xl"],
            },
          ]}
        >
          <View style={styles.completedHeader}>
            <View
              style={[
                styles.completedIcon,
                { backgroundColor: theme.success + "15" },
              ]}
            >
              <Icon name="check-circle" size={48} color={theme.success} />
            </View>
            <ThemedText type="h1" style={styles.completedTitle}>
              Session Complete!
            </ThemedText>
            <ThemedText
              type="body"
              style={{ color: theme.textSecondary, textAlign: "center" }}
            >
              You reviewed {allCards.length} cards
            </ThemedText>
          </View>

          <Card style={styles.statsCard}>
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <ThemedText type="display" style={{ color: theme.success }}>
                  {correctCount}
                </ThemedText>
                <ThemedText type="small" style={{ color: theme.textSecondary }}>
                  Correct
                </ThemedText>
              </View>
              <View
                style={[styles.statDivider, { backgroundColor: theme.border }]}
              />
              <View style={styles.statItem}>
                <ThemedText type="display" style={{ color: theme.error }}>
                  {wrongCount}
                </ThemedText>
                <ThemedText type="small" style={{ color: theme.textSecondary }}>
                  Needs Work
                </ThemedText>
              </View>
              <View
                style={[styles.statDivider, { backgroundColor: theme.border }]}
              />
              <View style={styles.statItem}>
                <ThemedText type="display" style={{ color: theme.link }}>
                  {accuracy}%
                </ThemedText>
                <ThemedText type="small" style={{ color: theme.textSecondary }}>
                  Accuracy
                </ThemedText>
              </View>
            </View>
          </Card>

          <View style={styles.completedActions}>
            <Button onPress={handleRestart} size="lg" fullWidth>
              Study Again
            </Button>
            <Button
              onPress={() => navigation.navigate("ExamMode")}
              variant="secondary"
              size="lg"
              fullWidth
              style={styles.secondaryButton}
            >
              Take a Quiz
            </Button>
          </View>
        </ScrollView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <View
        style={[
          styles.content,
          {
            paddingTop: headerHeight + Spacing.lg,
            paddingBottom: insets.bottom + Spacing.lg,
          },
        ]}
      >
        <View style={styles.progressSection}>
          <View style={styles.progressHeader}>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              Card {currentIndex + 1} of {allCards.length}
            </ThemedText>
            <View style={styles.scoreContainer}>
              <Badge label={`${correctCount}`} variant="success" />
              <Badge label={`${wrongCount}`} variant="error" />
            </View>
          </View>
          <View style={[styles.progressBar, { backgroundColor: theme.border }]}>
            <View
              style={[
                styles.progressFill,
                { width: `${progress}%`, backgroundColor: theme.link },
              ]}
            />
          </View>
        </View>

        <Pressable
          style={styles.flashcardContainer}
          onPress={handleFlip}
          accessibilityRole="button"
          accessibilityLabel={
            showAnswer ? "Tap to hide answer" : "Tap to reveal answer"
          }
        >
          <Card style={styles.flashcard}>
            <Badge
              label={currentCard.topicName}
              variant="info"
              style={styles.topicLabel}
            />
            <Pressable onPress={handleCopyCard} style={styles.copyButton} testID="button-copy-card">
              <Icon name="copy" size={16} color={theme.textSecondary} />
            </Pressable>

            <View style={styles.cardContent}>
              <ThemedText
                type="caption"
                style={[styles.cardLabel, { color: theme.textSecondary }]}
              >
                {showAnswer ? "ANSWER" : "QUESTION"}
              </ThemedText>
              <ThemedText type="h2" style={styles.cardText}>
                {showAnswer ? currentCard.back : currentCard.front}
              </ThemedText>
              {showAnswer && currentCard.sourceQuote ? (
                <View style={[styles.sourceQuote, { borderTopColor: theme.border }]}>
                  <ThemedText
                    type="small"
                    style={{ color: theme.textSecondary, fontStyle: "italic" }}
                    numberOfLines={3}
                  >
                    {`"${currentCard.sourceQuote}"`}
                  </ThemedText>
                </View>
              ) : null}
            </View>

            {!showAnswer ? (
              <View style={styles.tapHint}>
                <Icon name="refresh-cw" size={14} color={theme.textSecondary} />
                <ThemedText
                  type="small"
                  style={{ color: theme.textSecondary, marginLeft: 6 }}
                >
                  Tap to reveal answer
                </ThemedText>
              </View>
            ) : null}
          </Card>
        </Pressable>

        {showAnswer ? (
          <View style={styles.answerButtons}>
            <Button
              onPress={() => handleAnswer(false)}
              variant="destructive"
              size="lg"
              style={styles.answerButton}
              icon={<Icon name="x" size={18} color="#fff" />}
            >
              Needs Work
            </Button>
            <Button
              onPress={() => handleAnswer(true)}
              size="lg"
              style={[styles.answerButton, { backgroundColor: theme.success }]}
              icon={<Icon name="check" size={18} color="#fff" />}
            >
              Got It
            </Button>
          </View>
        ) : (
          <Button onPress={handleFlip} size="lg" fullWidth>
            Show Answer
          </Button>
        )}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
  },
  progressSection: {
    marginBottom: Spacing.xl,
  },
  progressHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  scoreContainer: {
    flexDirection: "row",
    gap: Spacing.xs,
  },
  progressBar: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
  },
  flashcardContainer: {
    flex: 1,
    justifyContent: "center",
  },
  flashcard: {
    minHeight: 300,
    justifyContent: "space-between",
    shadowColor: "#7C3AED",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  topicLabel: {
    alignSelf: "flex-start",
  },
  cardContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: Spacing["2xl"],
  },
  cardLabel: {
    textTransform: "uppercase",
    letterSpacing: 1,
    fontWeight: "700",
    marginBottom: Spacing.md,
  },
  cardText: {
    textAlign: "center",
    lineHeight: 32,
  },
  tapHint: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingTop: Spacing.md,
  },
  sourceQuote: {
    marginTop: Spacing.lg,
    paddingTop: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderTopWidth: 1,
    maxWidth: "100%",
  },
  answerButtons: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  answerButton: {
    flex: 1,
  },
  completedHeader: {
    alignItems: "center",
    marginBottom: Spacing["2xl"],
  },
  completedIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xl,
  },
  completedTitle: {
    marginBottom: Spacing.sm,
  },
  statsCard: {
    marginBottom: Spacing["2xl"],
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  statItem: {
    flex: 1,
    alignItems: "center",
  },
  statDivider: {
    width: 1,
    height: 40,
  },
  completedActions: {
    gap: Spacing.md,
  },
  secondaryButton: {
    marginTop: 0,
  },
  copyButton: {
    position: "absolute",
    top: Spacing.sm,
    right: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
    zIndex: 1,
  },
});
