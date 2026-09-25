import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Icon } from "@/components/Icon";
import { LoadingState } from "@/components/LoadingState";
import { SectionHeader } from "@/components/SectionHeader";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { BorderRadius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/useTheme";
import { useStudyToday, type StudyTodayRecommendation } from "@/lib/studyToday";
import {
  classifyStudyTodayError,
  examRelevanceLabel,
  getStudyTodayActionDestination,
  getStudyTodayDisplay,
  getStudyTodayViewState,
  masteryStateLabel,
  priorityLabel,
  studyTodayReasonLabel,
  suggestedActionLabel,
} from "@/lib/studyTodayPresentation";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

function priorityVariant(priority: StudyTodayRecommendation["priority"]) {
  switch (priority) {
    case "HIGH":
      return "error" as const;
    case "MEDIUM":
      return "warning" as const;
    case "LOW":
      return "info" as const;
  }
}

function StudyTodayError({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  const kind = classifyStudyTodayError(error);
  const copy =
    kind === "AUTHENTICATION"
      ? {
          title: "Sign in required",
          message: "Sign in again to load your Study Today plan.",
        }
      : {
          title: "Study Today unavailable",
          message:
            "We couldn't load your current study plan. Check your connection and try again.",
        };

  return (
    <ThemedView style={styles.stateContainer}>
      <ErrorState title={copy.title} message={copy.message} onRetry={onRetry} />
    </ThemedView>
  );
}

function RecommendationCard({
  recommendation,
  rank,
  onPress,
}: {
  recommendation: StudyTodayRecommendation;
  rank: number;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  const examLabel = examRelevanceLabel(recommendation);
  const masterySummary =
    recommendation.mastery.score === null
      ? "No meaningful mastery evidence yet"
      : `${recommendation.mastery.score}% mastery · ${recommendation.mastery.confidence}% confidence`;

  return (
    <Card
      style={styles.recommendationCard}
      accessibilityLabel={`Recommendation ${rank}. ${recommendation.concept.name} for ${recommendation.course.name}. ${priorityLabel(recommendation.priority)}. ${masterySummary}.`}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardTitle}>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            #{rank} · {recommendation.course.name}
          </ThemedText>
          <ThemedText type="h4" style={styles.conceptName}>
            {recommendation.concept.name}
          </ThemedText>
        </View>
        <Badge
          label={priorityLabel(recommendation.priority)}
          variant={priorityVariant(recommendation.priority)}
        />
      </View>

      <ThemedText type="small" style={{ color: theme.textSecondary }}>
        {masteryStateLabel(recommendation.mastery.state)} · {masterySummary}
      </ThemedText>

      {examLabel ? (
        <View style={[styles.examRow, { backgroundColor: theme.link + "12" }]}>
          <Icon name="calendar" size={15} color={theme.link} />
          <ThemedText
            type="small"
            style={[styles.examText, { color: theme.link }]}
          >
            {examLabel}
          </ThemedText>
        </View>
      ) : null}

      <ThemedText
        type="caption"
        style={[styles.whyLabel, { color: theme.textSecondary }]}
      >
        WHY THIS IS RECOMMENDED
      </ThemedText>
      <View style={styles.reasonList}>
        {recommendation.reasons.map((reason) => (
          <View
            key={reason.code}
            style={[
              styles.reasonChip,
              { backgroundColor: theme.backgroundSecondary },
            ]}
          >
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {studyTodayReasonLabel(reason.code)}
            </ThemedText>
          </View>
        ))}
      </View>

      <Button
        onPress={onPress}
        variant="secondary"
        fullWidth
        accessibilityLabel={`${suggestedActionLabel(recommendation.suggestedAction.code)} for ${recommendation.concept.name}`}
        accessibilityHint={recommendation.suggestedAction.label}
        style={styles.actionButton}
      >
        {suggestedActionLabel(recommendation.suggestedAction.code)}
      </Button>
    </Card>
  );
}

export default function StudyTodayScreen() {
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const {
    data: studyToday,
    isLoading,
    error,
    refetch,
    isRefetching,
  } = useStudyToday();
  const viewState = getStudyTodayViewState({ isLoading, error, studyToday });

  if (viewState === "LOADING") {
    return (
      <LoadingState fullScreen message="Preparing your Study Today plan..." />
    );
  }
  if (viewState === "ERROR" || !studyToday) {
    return <StudyTodayError error={error} onRetry={() => void refetch()} />;
  }

  const emptyStates = {
    NO_COURSES: {
      icon: "book-open",
      title: "No courses yet",
      description:
        "Add a course and study material first. Your Study Today plan will appear when concepts are available.",
      buttonLabel: "Go to Home",
      onPress: () => navigation.navigate("Main"),
    },
    NO_CONCEPTS: {
      icon: "layers",
      title: "No concepts to prioritize yet",
      description:
        "Add or process study material in a course to build concepts for a personalized plan.",
      buttonLabel: "Go to Home",
      onPress: () => navigation.navigate("Main"),
    },
    EMPTY: {
      icon: "check-circle",
      title: "No study priorities right now",
      description:
        "Your current evidence does not identify a specific action. Add practice or refresh after your next study session.",
      buttonLabel: "Refresh plan",
      onPress: () => void refetch(),
    },
  };

  if (viewState !== "READY") {
    const empty = emptyStates[viewState];
    return (
      <ThemedView style={styles.stateContainer}>
        <EmptyState
          icon={empty.icon}
          iconColor={theme.link}
          title={empty.title}
          description={empty.description}
          buttonLabel={empty.buttonLabel}
          onButtonPress={empty.onPress}
        />
      </ThemedView>
    );
  }

  const display = getStudyTodayDisplay(studyToday);

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: headerHeight + Spacing.md },
        ]}
      >
        <ThemedText type="h2">Study today</ThemedText>
        <ThemedText type="body" style={{ color: theme.textSecondary }}>
          Your plan is ranked from your mastery, available evidence, due cards,
          and upcoming exams.
        </ThemedText>

        {display.hasEvidenceGap ? (
          <View
            style={[
              styles.evidenceNotice,
              { backgroundColor: theme.warning + "14" },
            ]}
            accessibilityRole="summary"
            accessibilityLabel="Some recommendations have limited mastery evidence."
          >
            <Icon name="info" size={18} color={theme.warning} />
            <ThemedText
              type="small"
              style={[
                styles.evidenceNoticeText,
                { color: theme.textSecondary },
              ]}
            >
              Some recommendations have limited mastery evidence. Practice can
              make future priorities more representative.
            </ThemedText>
          </View>
        ) : null}

        <SectionHeader title="Your prioritized plan" icon="list" />
        {display.recommendations.map((recommendation, index) => (
          <RecommendationCard
            key={recommendation.concept.id}
            recommendation={recommendation}
            rank={index + 1}
            onPress={() => {
              const destination =
                getStudyTodayActionDestination(recommendation);
              navigation.navigate(destination.screen, destination.params);
            }}
          />
        ))}

        <Button
          onPress={() => void refetch()}
          loading={isRefetching}
          variant="secondary"
          fullWidth
          accessibilityLabel="Refresh Study Today plan"
          style={styles.refreshButton}
        >
          Refresh Plan
        </Button>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  stateContainer: { flex: 1, paddingTop: Spacing["4xl"] },
  content: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing["4xl"] },
  recommendationCard: { marginBottom: Spacing.md },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
  },
  cardTitle: { flex: 1 },
  conceptName: { marginTop: Spacing.xs },
  examRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: BorderRadius.xs,
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  examText: { marginLeft: Spacing.xs, flexShrink: 1 },
  whyLabel: { fontWeight: "700", letterSpacing: 0.7, marginTop: Spacing.md },
  reasonList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  reasonChip: {
    borderRadius: BorderRadius.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  actionButton: { marginTop: Spacing.lg },
  evidenceNotice: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderRadius: BorderRadius.sm,
    marginTop: Spacing.lg,
    padding: Spacing.md,
  },
  evidenceNoticeText: { flex: 1, marginLeft: Spacing.sm },
  refreshButton: { marginTop: Spacing.lg },
});
