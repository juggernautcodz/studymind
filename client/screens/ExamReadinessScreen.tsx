import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useRoute } from "@react-navigation/native";

import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ErrorState } from "@/components/ErrorState";
import { Icon } from "@/components/Icon";
import { LoadingState } from "@/components/LoadingState";
import { SectionHeader } from "@/components/SectionHeader";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { BorderRadius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/useTheme";
import { useExamReadiness } from "@/lib/examReadiness";
import {
  classifyExamReadinessError,
  getConceptReadinessGroups,
  getExamReadinessDisplay,
  getExamReadinessViewState,
  readinessBandLabel,
  type ConceptReadiness,
} from "@/lib/examReadinessPresentation";

interface ConceptGroupProps {
  title: string;
  concepts: ConceptReadiness[];
  emptyText: string;
  icon: string;
}

function ConceptGroup({ title, concepts, emptyText, icon }: ConceptGroupProps) {
  const { theme } = useTheme();

  return (
    <>
      <SectionHeader title={title} icon={icon} />
      <Card style={styles.card}>
        {concepts.length === 0 ? (
          <ThemedText type="body" style={{ color: theme.textSecondary }}>
            {emptyText}
          </ThemedText>
        ) : (
          concepts.map((concept) => {
            const assessment =
              concept.status === "UNASSESSED"
                ? "Not assessed yet"
                : `${concept.readinessScore}% readiness · ${concept.confidence}% confidence`;
            return (
              <View
                key={concept.conceptId}
                style={[styles.conceptRow, { borderBottomColor: theme.border }]}
                accessibilityLabel={`${concept.name}. ${assessment}.`}
              >
                <View style={styles.conceptText}>
                  <ThemedText type="body">{concept.name}</ThemedText>
                  <ThemedText
                    type="small"
                    style={{ color: theme.textSecondary }}
                  >
                    {assessment}
                  </ThemedText>
                </View>
                {concept.status !== "UNASSESSED" ? (
                  <ThemedText type="h4">{concept.readinessScore}%</ThemedText>
                ) : null}
              </View>
            );
          })
        )}
      </Card>
    </>
  );
}

function ReadinessError({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  const kind = classifyExamReadinessError(error);
  const copy = {
    AUTHENTICATION: {
      title: "Sign in required",
      message: "Sign in again to view this exam's readiness.",
    },
    ENTITLEMENT: {
      title: "Exam readiness unavailable",
      message: "Exam readiness follows your current Exam Mode access.",
    },
    NOT_FOUND: {
      title: "Exam unavailable",
      message:
        "This exam may have been removed or you may no longer have access to it.",
    },
    UNAVAILABLE: {
      title: "Readiness unavailable",
      message:
        "We couldn't load readiness right now. Check your connection and try again.",
    },
  }[kind];

  return (
    <ThemedView style={styles.errorContainer}>
      <ErrorState title={copy.title} message={copy.message} onRetry={onRetry} />
    </ThemedView>
  );
}

export default function ExamReadinessScreen() {
  const route = useRoute<any>();
  const examId = route.params?.examId as string;
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const {
    data: readiness,
    isLoading,
    error,
    refetch,
    isRefetching,
  } = useExamReadiness(examId);
  const viewState = getExamReadinessViewState({ isLoading, error, readiness });

  if (viewState === "LOADING") {
    return <LoadingState fullScreen message="Loading exam readiness..." />;
  }
  if (viewState === "ERROR" || !readiness) {
    return <ReadinessError error={error} onRetry={() => void refetch()} />;
  }

  const display = getExamReadinessDisplay(readiness);
  const groups = getConceptReadinessGroups(readiness);

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: headerHeight + Spacing.md },
        ]}
      >
        <ThemedText type="h2">{readiness.exam.name}</ThemedText>
        <ThemedText type="body" style={{ color: theme.textSecondary }}>
          {readiness.course.name}
        </ThemedText>
        {readiness.exam.description ? (
          <ThemedText
            type="small"
            style={[styles.description, { color: theme.textSecondary }]}
          >
            {readiness.exam.description}
          </ThemedText>
        ) : null}

        <SectionHeader title="Exam readiness" icon="award" />
        {!display.hasScope ? (
          <Card style={styles.card} accessibilityLabel="No exam scope yet">
            <View style={styles.emptyRow}>
              <Icon name="layers" size={22} color={theme.textSecondary} />
              <View style={styles.emptyText}>
                <ThemedText type="h4">No readiness score yet</ThemedText>
                <ThemedText type="body" style={{ color: theme.textSecondary }}>
                  {display.noScopeMessage}
                </ThemedText>
              </View>
            </View>
          </Card>
        ) : (
          <>
            <Card
              style={styles.card}
              accessibilityLabel={`Exam readiness. ${display.coverageLabel}`}
            >
              <View style={styles.scoreRow}>
                <View style={styles.scoreText}>
                  <ThemedText type="h4">
                    {readinessBandLabel(readiness.readinessBand)}
                  </ThemedText>
                  <ThemedText
                    type="body"
                    style={{ color: theme.textSecondary }}
                  >
                    {display.coverageLabel}
                  </ThemedText>
                </View>
                <View
                  style={[
                    styles.scoreBadge,
                    { backgroundColor: theme.link + "14" },
                  ]}
                >
                  <ThemedText type="h2" style={{ color: theme.link }}>
                    {display.showScore ? `${readiness.readinessScore}%` : "—"}
                  </ThemedText>
                  <ThemedText
                    type="caption"
                    style={{ color: theme.textSecondary }}
                  >
                    {display.showScore ? "readiness" : "unassessed"}
                  </ThemedText>
                </View>
              </View>
              {!display.hasEvidence ? (
                <ThemedText
                  type="small"
                  style={[styles.notice, { color: theme.textSecondary }]}
                >
                  {display.noEvidenceMessage}
                </ThemedText>
              ) : null}
              {display.sparseMessage ? (
                <View
                  style={[
                    styles.noticeBox,
                    { backgroundColor: theme.warning + "14" },
                  ]}
                >
                  <Icon name="info" size={18} color={theme.warning} />
                  <ThemedText
                    type="small"
                    style={[styles.noticeText, { color: theme.textSecondary }]}
                  >
                    {display.sparseMessage}
                  </ThemedText>
                </View>
              ) : null}
            </Card>

            <ConceptGroup
              title="Strong concepts"
              concepts={groups.strong}
              emptyText="No concepts have strong readiness evidence yet."
              icon="check-circle"
            />
            <ConceptGroup
              title="Developing concepts"
              concepts={groups.developing}
              emptyText="No concepts are currently in the developing range."
              icon="activity"
            />
            <ConceptGroup
              title="Weak concepts"
              concepts={groups.weak}
              emptyText="No weak concepts are identified from current evidence."
              icon="alert-triangle"
            />
            <ConceptGroup
              title="Unassessed concepts"
              concepts={groups.unassessed}
              emptyText="Every scoped concept has meaningful mastery evidence."
              icon="help-circle"
            />

            <SectionHeader title="What drives this" icon="info" />
            <Card style={styles.card}>
              {readiness.drivers.map((driver, index) => (
                <View key={`${driver}-${index}`} style={styles.driverRow}>
                  <Icon name="circle" size={10} color={theme.textSecondary} />
                  <ThemedText
                    type="small"
                    style={[styles.driverText, { color: theme.textSecondary }]}
                  >
                    {driver}
                  </ThemedText>
                </View>
              ))}
            </Card>
          </>
        )}

        <Button
          onPress={() => void refetch()}
          loading={isRefetching}
          variant="secondary"
          fullWidth
          accessibilityLabel="Refresh exam readiness"
          style={styles.refreshButton}
        >
          Refresh Readiness
        </Button>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  errorContainer: { flex: 1, paddingTop: Spacing["4xl"] },
  content: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing["4xl"] },
  description: { marginTop: Spacing.xs },
  card: { marginBottom: Spacing.md },
  scoreRow: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  scoreText: { flex: 1 },
  scoreBadge: {
    minWidth: 88,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  notice: { marginTop: Spacing.md },
  noticeBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderRadius: BorderRadius.sm,
    marginTop: Spacing.md,
    padding: Spacing.md,
  },
  noticeText: { flex: 1, marginLeft: Spacing.sm },
  emptyRow: { flexDirection: "row", alignItems: "flex-start" },
  emptyText: { flex: 1, marginLeft: Spacing.md },
  conceptRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  conceptText: { flex: 1 },
  driverRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: Spacing.sm,
  },
  driverText: { flex: 1, marginLeft: Spacing.xs },
  refreshButton: { marginTop: Spacing.lg },
});
