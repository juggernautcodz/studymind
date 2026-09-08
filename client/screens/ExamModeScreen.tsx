import React, { useState, useCallback } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  FlatList,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Icon } from "@/components/Icon";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import { shareOrDownload } from "@/lib/export";
import { useToast } from "@/components/Toast";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { useTheme } from "@/hooks/useTheme";
import { useBilling } from "@/contexts/BillingContext";
import { storage } from "@/lib/storage";
import { Spacing, BorderRadius } from "@/constants/theme";
import type {
  Course,
  Topic,
  QuizQuestion as QuizQuestionType,
} from "@/types";
import {
  QUIZZES_TO_UNLOCK_EXAM,
  QUIZ_PASS_THRESHOLD,
  EXAM_QUESTION_COUNT,
} from "@/types";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

interface CourseProgress {
  course: Course;
  totalTopicsWithQuiz: number;
  passedQuizCount: number;
  examUnlocked: boolean;
  bestExamGrade: string | null;
  topics: Topic[];
}

interface QuizQuestionItem {
  id: string;
  topicId: string;
  question: string;
  options: string[];
  correctIndex: number;
}

type ScreenMode = "overview" | "quiz" | "quiz-result" | "exam" | "exam-result";

export default function ExamModeScreen() {
  const { theme } = useTheme();
  const { showToast } = useToast();
  const { isFeatureAvailable } = useBilling();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const navigation = useNavigation<NativeStackNavigationProp<any>>();

  const [isLoading, setIsLoading] = useState(true);
  const [courseProgressList, setCourseProgressList] = useState<
    CourseProgress[]
  >([]);
  const [screenMode, setScreenMode] = useState<ScreenMode>("overview");

  const [activeCourse, setActiveCourse] = useState<CourseProgress | null>(null);
  const [activeTopic, setActiveTopic] = useState<Topic | null>(null);
  const [questions, setQuestions] = useState<QuizQuestionItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const courses = await storage.getCourses();
      const allTopics = await storage.getTopics();

      const progressList: CourseProgress[] = [];

      for (const course of courses) {
        const courseTopics = allTopics.filter((t) => t.courseId === course.id);

        let topicsWithQuiz = 0;
        const topicsWithQuizList: Topic[] = [];
        for (const topic of courseTopics) {
          const quizData = await storage.getQuiz(topic.id);
          if (quizData && quizData.questions.length > 0) {
            topicsWithQuiz++;
            topicsWithQuizList.push(topic);
          }
        }

        const passedQuizCount = await storage.getPassedQuizCountByCourse(
          course.id,
        );
        const examAttempts = await storage.getExamAttemptsByCourse(course.id);
        const bestExam =
          examAttempts.length > 0
            ? examAttempts.sort((a, b) => b.score - a.score)[0]
            : null;

        if (topicsWithQuiz > 0) {
          progressList.push({
            course,
            totalTopicsWithQuiz: topicsWithQuiz,
            passedQuizCount,
            examUnlocked: passedQuizCount >= QUIZZES_TO_UNLOCK_EXAM,
            bestExamGrade: bestExam?.grade || null,
            topics: topicsWithQuizList,
          });
        }
      }

      setCourseProgressList(progressList);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
      setScreenMode("overview");
    }, [loadData]),
  );

  const startQuiz = async (
    courseProgress: CourseProgress,
    topic: Topic,
  ) => {
    const quizData = await storage.getQuiz(topic.id);
    if (!quizData || quizData.questions.length === 0) return;

    const mapped: QuizQuestionItem[] = quizData.questions.map((q, idx) => ({
      id: `${topic.id}-${idx}`,
      topicId: topic.id,
      question: q.question,
      options: q.options,
      correctIndex: q.correctIndex,
    }));

    setActiveCourse(courseProgress);
    setActiveTopic(topic);
    setQuestions(mapped.sort(() => Math.random() - 0.5));
    setCurrentIndex(0);
    setSelectedAnswer(null);
    setShowResult(false);
    setCorrectCount(0);
    setScreenMode("quiz");
  };

  const startExam = async (courseProgress: CourseProgress) => {
    const allQuestions: QuizQuestionItem[] = [];

    for (const topic of courseProgress.topics) {
      const quizData = await storage.getQuiz(topic.id);
      if (quizData && quizData.questions.length > 0) {
        quizData.questions.forEach((q, idx) => {
          allQuestions.push({
            id: `${topic.id}-${idx}`,
            topicId: topic.id,
            question: q.question,
            options: q.options,
            correctIndex: q.correctIndex,
          });
        });
      }
    }

    const count = Math.min(EXAM_QUESTION_COUNT, allQuestions.length);
    const shuffled = allQuestions
      .sort(() => Math.random() - 0.5)
      .slice(0, count);

    setActiveCourse(courseProgress);
    setActiveTopic(null);
    setQuestions(shuffled);
    setCurrentIndex(0);
    setSelectedAnswer(null);
    setShowResult(false);
    setCorrectCount(0);
    setScreenMode("exam");
  };

  const handleSelectAnswer = (index: number) => {
    if (showResult) return;
    Haptics.selectionAsync();
    setSelectedAnswer(index);
  };

  const handleSubmitAnswer = () => {
    if (selectedAnswer === null) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowResult(true);
    if (selectedAnswer === questions[currentIndex].correctIndex) {
      setCorrectCount((c) => c + 1);
    }
  };

  const handleNextQuestion = async () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex((i) => i + 1);
      setSelectedAnswer(null);
      setShowResult(false);
    } else {
      const totalQuestions = questions.length;
      const score =
        correctCount +
        (selectedAnswer === questions[currentIndex].correctIndex ? 1 : 0);
      const accuracy = score / totalQuestions;
      const passed = accuracy >= QUIZ_PASS_THRESHOLD;

      if (screenMode === "quiz" && activeTopic && activeCourse) {
        await storage.saveQuizAttempt({
          topicId: activeTopic.id,
          courseId: activeCourse.course.id,
          score,
          totalQuestions,
          passed,
        });
        setCorrectCount(score);
        setScreenMode("quiz-result");
      } else if (screenMode === "exam" && activeCourse) {
        const grade =
          accuracy >= 0.9
            ? "A"
            : accuracy >= 0.8
              ? "B"
              : accuracy >= 0.7
                ? "C"
                : accuracy >= 0.6
                  ? "D"
                  : "F";
        await storage.saveExamAttempt({
          courseId: activeCourse.course.id,
          score,
          totalQuestions,
          grade,
        });
        setCorrectCount(score);
        setScreenMode("exam-result");
      }
    }
  };

  const handleCopyResults = useCallback(async () => {
    const totalQuestions = questions.length;
    const accuracy = Math.round((correctCount / totalQuestions) * 100);
    const isExam = screenMode === "exam-result";
    const type = isExam ? "Exam" : "Quiz";
    const courseName = activeCourse?.course.name || "";
    const topicName = activeTopic?.name || "";

    let text = `${type} Results - ${isExam ? courseName : topicName}\n`;
    text += `Score: ${correctCount}/${totalQuestions} (${accuracy}%)\n`;
    if (isExam) {
      const grade = accuracy >= 90 ? "A" : accuracy >= 80 ? "B" : accuracy >= 70 ? "C" : accuracy >= 60 ? "D" : "F";
      text += `Grade: ${grade}\n`;
    }
    text += `Correct: ${correctCount} | Incorrect: ${totalQuestions - correctCount}`;

    await Clipboard.setStringAsync(text);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [correctCount, questions, screenMode, activeCourse, activeTopic]);

  const handleShareResults = useCallback(async () => {
    const totalQuestions = questions.length;
    const accuracy = Math.round((correctCount / totalQuestions) * 100);
    const isExam = screenMode === "exam-result";
    const type = isExam ? "Exam" : "Quiz";
    const courseName = activeCourse?.course.name || "";
    const topicName = activeTopic?.name || "";

    let htmlContent = `<html><body style="font-family: system-ui; padding: 20px;">`;
    htmlContent += `<h1>${type} Results</h1>`;
    htmlContent += `<h2>${isExam ? courseName : topicName}</h2>`;
    htmlContent += `<p><strong>Score:</strong> ${correctCount}/${totalQuestions} (${accuracy}%)</p>`;
    if (isExam) {
      const grade = accuracy >= 90 ? "A" : accuracy >= 80 ? "B" : accuracy >= 70 ? "C" : accuracy >= 60 ? "D" : "F";
      htmlContent += `<p><strong>Grade:</strong> ${grade}</p>`;
    }
    htmlContent += `<p><strong>Correct:</strong> ${correctCount}</p>`;
    htmlContent += `<p><strong>Incorrect:</strong> ${totalQuestions - correctCount}</p>`;
    htmlContent += `</body></html>`;

    const plainText = `${type} Results\n${isExam ? courseName : topicName}\nScore: ${correctCount}/${totalQuestions} (${accuracy}%)\nCorrect: ${correctCount} | Incorrect: ${totalQuestions - correctCount}`;
    const result = await shareOrDownload({ html: htmlContent, plainText, title: `${type} Results` });
    if (result.method === "copied") {
      showToast({ type: "success", title: "Copied", message: "Results copied to clipboard" });
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [correctCount, questions, screenMode, activeCourse, activeTopic, showToast]);

  const handleBackToOverview = () => {
    loadData();
    setScreenMode("overview");
  };

  const getGradeColor = (grade: string) => {
    switch (grade) {
      case "A":
        return theme.success;
      case "B":
        return "#22C55E";
      case "C":
        return theme.warning;
      case "D":
        return "#F97316";
      default:
        return theme.error;
    }
  };

  if (isLoading) {
    return <LoadingState fullScreen message="Loading your progress..." />;
  }

  if (!isFeatureAvailable("hasExamMode")) {
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
            icon="award"
            iconColor={theme.warning}
            title="Exam Mode is a PRO feature"
            description="Combine quizzes from an entire course into one timed exam with a letter grade and analytics — the one thing neither StudySmarter nor NotebookLM offers. Upgrade to unlock it."
            buttonLabel="Upgrade to PRO"
            onButtonPress={() => navigation.navigate("Billing")}
          />
        </View>
      </ThemedView>
    );
  }

  if (screenMode === "overview") {
    return renderOverview();
  }

  if (screenMode === "quiz-result" || screenMode === "exam-result") {
    return renderResultScreen();
  }

  return renderQuestionScreen();

  function renderOverview() {
    if (courseProgressList.length === 0) {
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
              icon="award"
              iconColor={theme.warning}
              title="No Quizzes Available"
              description="Add study materials to topics and generate quizzes first. Pass enough quizzes in a course to unlock the final exam."
              buttonLabel="Go to Dashboard"
              onButtonPress={() =>
                navigation.navigate("Main", { screen: "HomeTab" })
              }
            />
          </View>
        </ThemedView>
      );
    }

    return (
      <ThemedView style={styles.container}>
        <ScrollView
          contentContainerStyle={[
            styles.overviewContent,
            {
              paddingTop: headerHeight + Spacing.lg,
              paddingBottom: insets.bottom + Spacing["3xl"],
            },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.overviewHeader}>
            <Icon name="award" size={28} color={theme.warning} />
            <ThemedText type="h2" style={styles.overviewTitle}>
              Exam Mode
            </ThemedText>
            <ThemedText
              type="body"
              style={{ color: theme.textSecondary, textAlign: "center" }}
            >
              Pass {QUIZZES_TO_UNLOCK_EXAM} quizzes in a course to unlock its
              final exam
            </ThemedText>
          </View>

          {courseProgressList.map((cp) => (
            <Card key={cp.course.id} style={styles.courseCard}>
              <View style={styles.courseCardHeader}>
                <View
                  style={[
                    styles.courseColorDot,
                    { backgroundColor: cp.course.color || theme.link },
                  ]}
                />
                <ThemedText
                  type="h3"
                  style={styles.courseCardTitle}
                  numberOfLines={1}
                >
                  {cp.course.name}
                </ThemedText>
                {cp.bestExamGrade ? (
                  <View
                    style={[
                      styles.gradeBadge,
                      {
                        backgroundColor: getGradeColor(cp.bestExamGrade) + "20",
                      },
                    ]}
                  >
                    <ThemedText
                      type="caption"
                      style={{
                        color: getGradeColor(cp.bestExamGrade),
                        fontWeight: "700",
                      }}
                    >
                      {cp.bestExamGrade}
                    </ThemedText>
                  </View>
                ) : null}
              </View>

              <View style={styles.progressSection}>
                <View style={styles.progressLabelRow}>
                  <ThemedText
                    type="small"
                    style={{ color: theme.textSecondary }}
                  >
                    Quizzes passed
                  </ThemedText>
                  <ThemedText
                    type="small"
                    style={{ color: theme.textSecondary }}
                  >
                    {cp.passedQuizCount} / {QUIZZES_TO_UNLOCK_EXAM}
                  </ThemedText>
                </View>
                <View
                  style={[
                    styles.progressBar,
                    { backgroundColor: theme.border },
                  ]}
                >
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: `${Math.min(100, (cp.passedQuizCount / QUIZZES_TO_UNLOCK_EXAM) * 100)}%`,
                        backgroundColor: cp.examUnlocked
                          ? theme.success
                          : theme.link,
                      },
                    ]}
                  />
                </View>
              </View>

              {cp.examUnlocked ? (
                <Button
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    startExam(cp);
                  }}
                  size="lg"
                  fullWidth
                  style={styles.examButton}
                  testID={`button-start-exam-${cp.course.id}`}
                >
                  Take Final Exam
                </Button>
              ) : (
                <View style={styles.quizListSection}>
                  <ThemedText
                    type="caption"
                    style={[
                      styles.quizListLabel,
                      { color: theme.textSecondary },
                    ]}
                  >
                    Available quizzes
                  </ThemedText>
                  {cp.topics.map((topic) => (
                    <Pressable
                      key={topic.id}
                      style={[styles.quizRow, { borderColor: theme.border }]}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        startQuiz(cp, topic);
                      }}
                      testID={`button-quiz-${topic.id}`}
                    >
                      <View
                        style={[
                          styles.quizRowIcon,
                          {
                            backgroundColor:
                              (cp.course.color || theme.link) + "15",
                          },
                        ]}
                      >
                        <Icon
                          name="help-circle"
                          size={18}
                          color={cp.course.color || theme.link}
                        />
                      </View>
                      <ThemedText
                        type="body"
                        style={styles.quizRowTitle}
                        numberOfLines={1}
                      >
                        {topic.name}
                      </ThemedText>
                      <Icon
                        name="chevron-right"
                        size={18}
                        color={theme.textSecondary}
                      />
                    </Pressable>
                  ))}
                </View>
              )}
            </Card>
          ))}
        </ScrollView>
      </ThemedView>
    );
  }

  function renderQuestionScreen() {
    const currentQuestion = questions[currentIndex];
    const progress =
      questions.length > 0 ? ((currentIndex + 1) / questions.length) * 100 : 0;
    const isExam = screenMode === "exam";

    return (
      <ThemedView style={styles.container}>
        <View
          style={[
            styles.questionContent,
            {
              paddingTop: headerHeight + Spacing.lg,
              paddingBottom: insets.bottom + Spacing.lg,
            },
          ]}
        >
          <View style={styles.questionProgressSection}>
            <View style={styles.questionProgressHeader}>
              <Badge
                label={isExam ? "Final Exam" : "Quiz"}
                variant={isExam ? "warning" : "info"}
              />
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                {currentIndex + 1} / {questions.length}
              </ThemedText>
            </View>
            <View
              style={[styles.progressBar, { backgroundColor: theme.border }]}
            >
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${progress}%`,
                    backgroundColor: isExam ? theme.warning : theme.link,
                  },
                ]}
              />
            </View>
          </View>

          <ScrollView
            style={styles.questionScroll}
            contentContainerStyle={styles.questionContainer}
            showsVerticalScrollIndicator={false}
          >
            <Card style={styles.questionCard}>
              <ThemedText type="h3" style={styles.questionText}>
                {currentQuestion.question}
              </ThemedText>
            </Card>

            <View style={styles.optionsContainer}>
              {currentQuestion.options.map((option, index) => {
                const isSelected = selectedAnswer === index;
                const isCorrect = index === currentQuestion.correctIndex;
                const showCorrect = showResult && isCorrect;
                const showWrong = showResult && isSelected && !isCorrect;

                return (
                  <Pressable
                    key={index}
                    onPress={() => handleSelectAnswer(index)}
                    accessibilityRole="radio"
                    accessibilityLabel={`Option ${String.fromCharCode(65 + index)}: ${option}`}
                    accessibilityState={{ selected: isSelected }}
                    style={[
                      styles.optionButton,
                      {
                        borderColor: isSelected ? theme.link : theme.border,
                        backgroundColor: showCorrect
                          ? theme.success + "15"
                          : showWrong
                            ? theme.error + "15"
                            : isSelected
                              ? theme.link + "10"
                              : theme.backgroundDefault,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.optionIndex,
                        {
                          backgroundColor: showCorrect
                            ? theme.success
                            : showWrong
                              ? theme.error
                              : isSelected
                                ? theme.link
                                : theme.backgroundSecondary,
                        },
                      ]}
                    >
                      <ThemedText
                        type="caption"
                        style={{
                          color:
                            isSelected || showCorrect || showWrong
                              ? "#fff"
                              : theme.textSecondary,
                          fontWeight: "700",
                        }}
                      >
                        {String.fromCharCode(65 + index)}
                      </ThemedText>
                    </View>
                    <ThemedText type="body" style={styles.optionText}>
                      {option}
                    </ThemedText>
                    {showCorrect ? (
                      <Icon
                        name="check-circle"
                        size={20}
                        color={theme.success}
                      />
                    ) : showWrong ? (
                      <Icon name="x-circle" size={20} color={theme.error} />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>

          <View style={styles.actionSection}>
            {!showResult ? (
              <Button
                onPress={handleSubmitAnswer}
                disabled={selectedAnswer === null}
                size="lg"
                fullWidth
                testID="button-check-answer"
              >
                Check Answer
              </Button>
            ) : (
              <Button
                onPress={handleNextQuestion}
                size="lg"
                fullWidth
                testID="button-next-question"
              >
                {currentIndex < questions.length - 1
                  ? "Next Question"
                  : "See Results"}
              </Button>
            )}
          </View>
        </View>
      </ThemedView>
    );
  }

  function renderResultScreen() {
    const totalQuestions = questions.length;
    const accuracy = Math.round((correctCount / totalQuestions) * 100);
    const passed = correctCount / totalQuestions >= QUIZ_PASS_THRESHOLD;
    const isExam = screenMode === "exam-result";
    const grade =
      accuracy >= 90
        ? "A"
        : accuracy >= 80
          ? "B"
          : accuracy >= 70
            ? "C"
            : accuracy >= 60
              ? "D"
              : "F";

    return (
      <ThemedView style={styles.container}>
        <ScrollView
          contentContainerStyle={[
            styles.resultContent,
            {
              paddingTop: headerHeight + Spacing["2xl"],
              paddingBottom: insets.bottom + Spacing["3xl"],
            },
          ]}
        >
          <View style={styles.resultHeader}>
            {isExam ? (
              <View
                style={[
                  styles.gradeCircle,
                  { backgroundColor: getGradeColor(grade) + "15" },
                ]}
              >
                <ThemedText
                  type="display"
                  style={{ color: getGradeColor(grade), fontSize: 56 }}
                >
                  {grade}
                </ThemedText>
              </View>
            ) : (
              <View
                style={[
                  styles.resultIcon,
                  {
                    backgroundColor: passed
                      ? theme.success + "15"
                      : theme.error + "15",
                  },
                ]}
              >
                <Icon
                  name={passed ? "check-circle" : "x-circle"}
                  size={48}
                  color={passed ? theme.success : theme.error}
                />
              </View>
            )}
            <ThemedText type="h1" style={styles.resultTitle}>
              {isExam
                ? "Exam Complete!"
                : passed
                  ? "Quiz Passed!"
                  : "Keep Practicing"}
            </ThemedText>
            <ThemedText
              type="body"
              style={{ color: theme.textSecondary, textAlign: "center" }}
            >
              {isExam
                ? `You scored ${correctCount} out of ${totalQuestions} on the ${activeCourse?.course.name} exam`
                : passed
                  ? `Great job! You scored ${correctCount}/${totalQuestions}. This counts toward your exam unlock.`
                  : `You scored ${correctCount}/${totalQuestions}. You need ${Math.round(QUIZ_PASS_THRESHOLD * 100)}% to pass.`}
            </ThemedText>
          </View>

          <Card style={styles.resultsCard}>
            <View style={styles.resultsRow}>
              <View style={styles.resultItem}>
                <ThemedText type="h2" style={{ color: theme.success }}>
                  {correctCount}
                </ThemedText>
                <ThemedText type="small" style={{ color: theme.textSecondary }}>
                  Correct
                </ThemedText>
              </View>
              <View
                style={[
                  styles.resultDivider,
                  { backgroundColor: theme.border },
                ]}
              />
              <View style={styles.resultItem}>
                <ThemedText type="h2" style={{ color: theme.error }}>
                  {totalQuestions - correctCount}
                </ThemedText>
                <ThemedText type="small" style={{ color: theme.textSecondary }}>
                  Incorrect
                </ThemedText>
              </View>
              <View
                style={[
                  styles.resultDivider,
                  { backgroundColor: theme.border },
                ]}
              />
              <View style={styles.resultItem}>
                <ThemedText type="h2" style={{ color: theme.link }}>
                  {accuracy}%
                </ThemedText>
                <ThemedText type="small" style={{ color: theme.textSecondary }}>
                  Score
                </ThemedText>
              </View>
            </View>
          </Card>

          {!isExam && !passed ? (
            <Card
              style={[styles.tipCard, { borderColor: theme.warning + "30" }]}
            >
              <View style={styles.tipRow}>
                <Icon name="info" size={18} color={theme.warning} />
                <ThemedText
                  type="small"
                  style={{
                    color: theme.textSecondary,
                    flex: 1,
                    marginLeft: Spacing.sm,
                  }}
                >
                  Review the topic material and try again. You need to pass{" "}
                  {QUIZZES_TO_UNLOCK_EXAM} different quizzes to unlock the exam.
                </ThemedText>
              </View>
            </Card>
          ) : null}

          <View style={styles.shareActions}>
            <Button
              onPress={handleCopyResults}
              variant="secondary"
              size="md"
              style={styles.shareButton}
              icon={<Icon name="copy" size={16} color={theme.textSecondary} />}
              testID="button-copy-results"
            >
              Copy Results
            </Button>
            <Button
              onPress={handleShareResults}
              variant="secondary"
              size="md"
              style={styles.shareButton}
              icon={<Icon name="share-2" size={16} color={theme.textSecondary} />}
              testID="button-share-results"
            >
              Share Results
            </Button>
          </View>

          <View style={styles.resultActions}>
            <Button
              onPress={handleBackToOverview}
              size="lg"
              fullWidth
              testID="button-back-overview"
            >
              Back to Overview
            </Button>
            {!isExam && activeTopic && activeCourse ? (
              <Button
                onPress={() => startQuiz(activeCourse, activeTopic)}
                variant="secondary"
                size="lg"
                fullWidth
              >
                Retry Quiz
              </Button>
            ) : null}
            {isExam && activeCourse ? (
              <Button
                onPress={() => startExam(activeCourse)}
                variant="secondary"
                size="lg"
                fullWidth
              >
                Retake Exam
              </Button>
            ) : null}
          </View>
        </ScrollView>
      </ThemedView>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
  },
  overviewContent: {
    paddingHorizontal: Spacing.lg,
  },
  overviewHeader: {
    alignItems: "center",
    marginBottom: Spacing["2xl"],
    gap: Spacing.sm,
  },
  overviewTitle: {
    marginTop: Spacing.xs,
  },
  courseCard: {
    marginBottom: Spacing.lg,
    padding: Spacing.lg,
    shadowColor: "#7C3AED",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 3,
  },
  courseCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  courseColorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: Spacing.sm,
  },
  courseCardTitle: {
    flex: 1,
  },
  gradeBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
    marginLeft: Spacing.sm,
  },
  progressSection: {
    marginBottom: Spacing.lg,
  },
  progressLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: Spacing.xs,
  },
  progressBar: {
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 4,
  },
  examButton: {
    marginTop: Spacing.xs,
  },
  quizListSection: {
    gap: Spacing.sm,
  },
  quizListLabel: {
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontWeight: "600",
    marginBottom: Spacing.xs,
  },
  quizRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
  },
  quizRowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.md,
  },
  quizRowTitle: {
    flex: 1,
  },
  questionContent: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
  },
  questionProgressSection: {
    marginBottom: Spacing.lg,
  },
  questionProgressHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  questionScroll: {
    flex: 1,
  },
  questionContainer: {
    paddingBottom: Spacing.lg,
  },
  questionCard: {
    marginBottom: Spacing.xl,
  },
  questionText: {
    lineHeight: 28,
  },
  optionsContainer: {
    gap: Spacing.md,
  },
  optionButton: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
    borderWidth: 2,
  },
  optionIndex: {
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
  actionSection: {
    paddingTop: Spacing.md,
  },
  resultContent: {
    paddingHorizontal: Spacing.lg,
  },
  resultHeader: {
    alignItems: "center",
    marginBottom: Spacing["2xl"],
  },
  gradeCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xl,
  },
  resultIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xl,
  },
  resultTitle: {
    marginBottom: Spacing.sm,
  },
  resultsCard: {
    marginBottom: Spacing["2xl"],
  },
  resultsRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  resultItem: {
    flex: 1,
    alignItems: "center",
  },
  resultDivider: {
    width: 1,
    height: 40,
  },
  tipCard: {
    marginBottom: Spacing.lg,
    borderWidth: 1,
  },
  tipRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  resultActions: {
    gap: Spacing.md,
  },
  shareActions: {
    flexDirection: "row",
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  shareButton: {
    flex: 1,
  },
});
