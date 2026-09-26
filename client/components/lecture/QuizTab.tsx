import React, { useRef, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable } from "react-native";
import * as Haptics from "expo-haptics";
import { v4 as uuidv4 } from "uuid";

import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ProgressBar } from "@/components/ProgressBar";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import type { Quiz, QuizQuestion } from "@/types";
import {
  quizAnswersByQuestionId,
  type QuizSubmissionInput,
  type QuizSubmissionResult,
} from "@/lib/studyEvidence";
import { useToast } from "@/components/Toast";

interface QuizTabProps {
  quizData: { quiz: Quiz; questions: QuizQuestion[] } | null;
  isGenerating: boolean;
  onGenerate: () => void;
  onSubmit?: (input: QuizSubmissionInput) => Promise<QuizSubmissionResult>;
}

export default function QuizTab({
  quizData,
  isGenerating,
  onGenerate,
  onSubmit,
}: QuizTabProps) {
  const { theme } = useTheme();
  const { showToast } = useToast();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [score, setScore] = useState(0);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [quizCompleted, setQuizCompleted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [durableResult, setDurableResult] =
    useState<QuizSubmissionResult | null>(null);
  const [submissionId, setSubmissionId] = useState(() => uuidv4());
  const submittingRef = useRef(false);

  if (!quizData || quizData.questions.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <View
          style={[styles.emptyIcon, { backgroundColor: theme.success + "15" }]}
        >
          <ThemedText
            style={{ fontSize: 24, color: theme.success, fontWeight: "700" }}
          >
            Q
          </ThemedText>
        </View>
        <ThemedText type="h3" style={styles.emptyTitle}>
          No Quiz Yet
        </ThemedText>
        <ThemedText
          type="body"
          style={[styles.emptyDescription, { color: theme.textSecondary }]}
        >
          Upload notes, take a photo, or paste text to create a quiz
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

  const { questions } = quizData;
  const currentQuestion = questions[currentIndex];
  if (!currentQuestion) return null;
  const progress = ((currentIndex + 1) / questions.length) * 100;

  const handleSelectAnswer = (index: number) => {
    if (showResult) return;
    Haptics.selectionAsync();
    setSelectedAnswer(index);
  };

  const handleSubmit = () => {
    if (selectedAnswer === null) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setShowResult(true);

    const isCorrect = selectedAnswer === currentQuestion.correctIndex;
    if (isCorrect) {
      setScore(score + 1);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }

    setAnswers([...answers, selectedAnswer]);
  };

  const handleNext = async () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setSelectedAnswer(null);
      setShowResult(false);
    } else if (!onSubmit) {
      setQuizCompleted(true);
    } else if (!submittingRef.current) {
      submittingRef.current = true;
      setIsSubmitting(true);
      setSubmissionError(null);
      try {
        const result = await onSubmit({
          quizId: quizData.quiz.id,
          answers: quizAnswersByQuestionId(questions, answers),
          submissionId,
        });
        setDurableResult(result);
        setQuizCompleted(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast({
          type: "success",
          title: "Quiz saved",
          message: "Your score and mastery evidence are updated.",
        });
      } catch {
        setSubmissionError("Your quiz was not saved. Check your connection and try again.");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        showToast({
          type: "error",
          title: "Quiz not saved",
          message: "Your answers are still here. Try submitting again.",
        });
      } finally {
        submittingRef.current = false;
        setIsSubmitting(false);
      }
    }
  };

  const handleRestart = () => {
    setCurrentIndex(0);
    setSelectedAnswer(null);
    setShowResult(false);
    setScore(0);
    setAnswers([]);
    setQuizCompleted(false);
    setSubmissionError(null);
    setDurableResult(null);
    setSubmissionId(uuidv4());
  };

  if (quizCompleted) {
    const completedScore = durableResult?.score ?? score;
    const completedTotal = durableResult?.totalQuestions ?? questions.length;
    const percentage = Math.round(
      durableResult?.percentage ?? (completedScore / completedTotal) * 100,
    );
    return (
      <View style={styles.resultsContainer}>
        <View
          style={[
            styles.resultsIcon,
            {
              backgroundColor:
                percentage >= 70 ? theme.success + "15" : theme.warning + "15",
            },
          ]}
        >
          <ThemedText
            style={{
              fontSize: 32,
              color: percentage >= 70 ? theme.success : theme.warning,
              fontWeight: "700",
            }}
          >
            {percentage >= 70 ? "A+" : "..."}
          </ThemedText>
        </View>
        <ThemedText type="h2" style={styles.resultsTitle}>
          Quiz Complete!
        </ThemedText>
        <ThemedText
          type="h1"
          style={[
            styles.scoreText,
            { color: percentage >= 70 ? theme.success : theme.warning },
          ]}
        >
          {completedScore}/{completedTotal}
        </ThemedText>
        <ThemedText
          type="body"
          style={[styles.percentageText, { color: theme.textSecondary }]}
        >
          {percentage}% correct
        </ThemedText>
        <Button onPress={handleRestart} style={styles.restartButton}>
          Try Again
        </Button>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          Question {currentIndex + 1} of {questions.length}
        </ThemedText>
        <ProgressBar progress={progress} style={styles.progress} />
      </View>

      <Card style={styles.questionCard}>
        <ThemedText type="h3" style={styles.questionText}>
          {currentQuestion.question}
        </ThemedText>
      </Card>

      <View style={styles.options}>
        {currentQuestion.options.map((option, index) => {
          const isSelected = selectedAnswer === index;
          const isCorrect = index === currentQuestion.correctIndex;
          const showCorrect = showResult && isCorrect;
          const showWrong = showResult && isSelected && !isCorrect;

          let optionStyle = {
            borderColor: theme.border,
            backgroundColor: theme.backgroundDefault,
          };

          if (isSelected && !showResult) {
            optionStyle = {
              borderColor: theme.link,
              backgroundColor: theme.link + "10",
            };
          } else if (showCorrect) {
            optionStyle = {
              borderColor: theme.success,
              backgroundColor: theme.success + "10",
            };
          } else if (showWrong) {
            optionStyle = {
              borderColor: theme.error,
              backgroundColor: theme.error + "10",
            };
          }

          return (
            <Pressable
              key={index}
              onPress={() => handleSelectAnswer(index)}
              style={[styles.option, optionStyle]}
              accessibilityLabel={`Option ${String.fromCharCode(65 + index)}: ${option}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: isSelected, disabled: showResult }}
            >
              <View
                style={[
                  styles.optionIndicator,
                  {
                    backgroundColor: showCorrect
                      ? theme.success
                      : showWrong
                        ? theme.error
                        : isSelected
                          ? theme.link
                          : theme.border,
                  },
                ]}
              >
                {showCorrect ? (
                  <ThemedText style={{ color: "#fff", fontWeight: "700" }}>
                    OK
                  </ThemedText>
                ) : showWrong ? (
                  <ThemedText style={{ color: "#fff", fontWeight: "700" }}>
                    X
                  </ThemedText>
                ) : (
                  <ThemedText
                    type="small"
                    style={{
                      color: isSelected ? "#fff" : theme.textSecondary,
                      fontWeight: "600",
                    }}
                  >
                    {String.fromCharCode(65 + index)}
                  </ThemedText>
                )}
              </View>
              <ThemedText type="body" style={styles.optionText}>
                {option}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.actions}>
        {submissionError ? (
          <ThemedText
            type="small"
            style={[styles.submissionError, { color: theme.error }]}
          >
            {submissionError}
          </ThemedText>
        ) : null}
        {!showResult ? (
          <Button
            onPress={handleSubmit}
            disabled={selectedAnswer === null}
            style={styles.actionButton}
          >
            Check Answer
          </Button>
        ) : (
          <Button
            onPress={() => void handleNext()}
            loading={isSubmitting}
            disabled={isSubmitting}
            style={styles.actionButton}
          >
            {currentIndex < questions.length - 1
              ? "Next Question"
              : "See Results"}
          </Button>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: Spacing["3xl"],
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
  questionCard: {
    marginBottom: Spacing.xl,
  },
  questionText: {
    textAlign: "center",
  },
  options: {
    gap: Spacing.md,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderWidth: 2,
    borderRadius: BorderRadius.md,
  },
  optionIndicator: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.md,
  },
  optionText: {
    flex: 1,
  },
  actions: {
    marginTop: Spacing["2xl"],
  },
  actionButton: {
    width: "100%",
  },
  submissionError: {
    marginBottom: Spacing.md,
    textAlign: "center",
  },
  resultsContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing["2xl"],
  },
  resultsIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xl,
  },
  resultsTitle: {
    marginBottom: Spacing.lg,
  },
  scoreText: {
    fontSize: 48,
    marginBottom: Spacing.sm,
  },
  percentageText: {
    marginBottom: Spacing["2xl"],
  },
  restartButton: {
    minWidth: 160,
  },
});
