import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useRoute } from "@react-navigation/native";

import { Card } from "@/components/Card";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { SectionHeader } from "@/components/SectionHeader";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useTheme } from "@/hooks/useTheme";
import { useCourseBrain } from "@/lib/courseBrain";
import { useCourseMastery, useRecalculateCourseMastery } from "@/lib/mastery";
import { Button } from "@/components/Button";
import { BorderRadius, Spacing } from "@/constants/theme";

export default function CourseBrainScreen() {
  const route = useRoute<any>();
  const courseId = route.params?.courseId as string;
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const { data: brain, isLoading, error, refetch } = useCourseBrain(courseId);
  const { data: mastery = [], refetch: refetchMastery } = useCourseMastery(courseId);
  const recalculate = useRecalculateCourseMastery(courseId);

  if (isLoading) return <LoadingState fullScreen message="Loading Course Brain..." />;
  if (error || !brain) {
    return (
      <ThemedView style={styles.errorContainer}>
        <ErrorState
          title="Course Brain unavailable"
          message="We couldn't load this course summary. Check your connection and try again."
          onRetry={() => void refetch()}
        />
      </ThemedView>
    );
  }

  const countItems = [
    ["Topics", brain.totals.topics],
    ["Recordings", brain.totals.recordings],
    ["Flashcards", brain.totals.flashcards],
    ["Quizzes", brain.totals.quizzes],
    ["Quiz attempts", brain.totals.quizAttempts],
    ["Mind map items", brain.totals.mindMapNodes],
    ["Sources", brain.totals.sources],
  ] as const;

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: headerHeight + Spacing.md },
        ]}
      >
        <ThemedText type="h2">{brain.course.name}</ThemedText>
        {brain.semester ? (
          <ThemedText type="body" style={{ color: theme.textSecondary }}>
            {brain.semester.name}
          </ThemedText>
        ) : null}

        <SectionHeader title="Course overview" icon="book-open" />
        <Card style={styles.card}>
          <View style={styles.countGrid}>
            {countItems.map(([label, value]) => (
              <View key={label} style={styles.countItem}>
                <ThemedText type="h3">{value}</ThemedText>
                <ThemedText type="small" style={{ color: theme.textSecondary }}>
                  {label}
                </ThemedText>
              </View>
            ))}
          </View>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            {brain.quizPerformance.accuracyPercent === null
              ? "No quiz results yet"
              : `Quiz accuracy: ${brain.quizPerformance.accuracyPercent}% (${brain.quizPerformance.score}/${brain.quizPerformance.questions})`}
          </ThemedText>
          {brain.lastActivityAt ? (
            <ThemedText type="small" style={{ color: theme.textSecondary, marginTop: Spacing.sm }}>
              Updated {new Date(brain.lastActivityAt).toLocaleDateString()}
            </ThemedText>
          ) : null}
        </Card>

        <SectionHeader title="Topics" icon="layers" />
        {brain.topics.length === 0 ? (
          <Card style={styles.card}>
            <ThemedText type="body" style={{ color: theme.textSecondary }}>
              No topics have been added to this course yet.
            </ThemedText>
          </Card>
        ) : (
          brain.topics.map((topic) => (
            <Card key={topic.id} style={styles.topicCard}>
              <ThemedText type="h4">{topic.name}</ThemedText>
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                {`${topic.counts.recordings} recordings · ${topic.counts.flashcards} flashcards · ${topic.counts.quizzes} quizzes · ${topic.counts.quizAttempts} attempts`}
              </ThemedText>
            </Card>
          ))
        )}

        <SectionHeader title="Mastery" icon="award" />
        <Card style={styles.card}>
          {mastery.length === 0 ? (
            <>
              <ThemedText type="body" style={{ color: theme.textSecondary }}>
                Complete a quiz or review flashcards to measure understanding by topic.
              </ThemedText>
              <Button onPress={() => recalculate.mutate()} disabled={recalculate.isPending} style={{ marginTop: Spacing.md }}>
                {recalculate.isPending ? "Calculating..." : "Calculate Mastery"}
              </Button>
            </>
          ) : mastery.slice().sort((a, b) => (a.score ?? -1) - (b.score ?? -1)).map((item) => (
            <View key={item.conceptId} style={styles.masteryRow}>
              <View style={{ flex: 1 }}>
                <ThemedText type="body">{item.name}</ThemedText>
                <ThemedText type="small" style={{ color: theme.textSecondary }}>
                  {item.evidenceCount
                    ? `${item.evidenceCount} evidence events · ${Math.round(item.confidence * 100)}% confidence · ${item.trend.toLowerCase()}`
                    : "Not yet assessed"}
                </ThemedText>
              </View>
              <ThemedText type="h4" style={{ color: item.score === null ? theme.textSecondary : item.score >= 0.7 ? theme.success : theme.warning }}>
                {item.score === null ? "—" : `${Math.round(item.score * 100)}%`}
              </ThemedText>
            </View>
          ))}
          <Button onPress={() => { recalculate.mutate(); void refetchMastery(); }} disabled={recalculate.isPending} variant="ghost" style={{ marginTop: Spacing.sm }}>
            Refresh Mastery
          </Button>
        </Card>

        <SectionHeader title="Exam context" icon="calendar" />
        <Card style={styles.card}>
          {brain.exams.length === 0 ? (
            <ThemedText type="body" style={{ color: theme.textSecondary }}>
              No course-specific exams are available yet.
            </ThemedText>
          ) : (
            brain.exams.map((exam) => (
              <View key={exam.id} style={styles.examRow}>
                <ThemedText type="body">{exam.name}</ThemedText>
                <ThemedText type="small" style={{ color: theme.textSecondary }}>
                  {new Date(exam.examDate).toLocaleDateString()}
                </ThemedText>
              </View>
            ))
          )}
        </Card>

        <ThemedText type="small" style={[styles.futureNote, { color: theme.textSecondary }]}>
          Mastery uses your quiz and flashcard practice evidence.
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  errorContainer: { flex: 1, paddingTop: Spacing["4xl"] },
  content: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing["4xl"] },
  card: { marginBottom: Spacing.md },
  countGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: Spacing.md,
  },
  countItem: { width: "33.33%", paddingVertical: Spacing.sm },
  topicCard: { marginBottom: Spacing.sm, borderRadius: BorderRadius.md },
  examRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.sm,
  },
  masteryRow: { flexDirection: "row", alignItems: "center", paddingVertical: Spacing.sm },
  futureNote: { textAlign: "center", marginTop: Spacing.lg },
});
