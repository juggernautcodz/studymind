import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useRoute } from "@react-navigation/native";

import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { BorderRadius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/useTheme";
import { useCourseSources } from "@/lib/sourceLock";

function sourceKindLabel(kind: string) {
  return kind
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export default function SourcesScreen() {
  const route = useRoute<any>();
  const courseId = route.params?.courseId as string;
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const {
    data: sources = [],
    isLoading,
    error,
    refetch,
  } = useCourseSources(courseId);

  if (isLoading) {
    return <LoadingState fullScreen message="Loading Sources..." />;
  }

  if (error) {
    return (
      <ThemedView style={styles.errorContainer}>
        <ErrorState
          title="Sources unavailable"
          message="We couldn't load this course's sources. Check your connection and try again."
          onRetry={() => void refetch()}
        />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: headerHeight + Spacing.md },
        ]}
      >
        {sources.length === 0 ? (
          <View style={styles.emptyContainer}>
            <EmptyState
              icon="inbox"
              title="No sources yet"
              description="Add notes from a camera or gallery image to save them to this course."
              compact
            />
          </View>
        ) : (
          sources.map((source) => {
            const latestRevision = source.revisions[0];
            const detail = latestRevision
              ? `${sourceKindLabel(source.kind)} · ${latestRevision._count.segments} text segment${latestRevision._count.segments === 1 ? "" : "s"}`
              : sourceKindLabel(source.kind);

            return (
              <Card key={source.id} style={styles.sourceCard}>
                <ThemedText type="h4">{source.title}</ThemedText>
                <ThemedText
                  type="small"
                  style={{ color: theme.textSecondary, marginTop: Spacing.xs }}
                >
                  {detail}
                </ThemedText>
                <ThemedText
                  type="small"
                  style={{ color: theme.textSecondary, marginTop: Spacing.xs }}
                >
                  Added {new Date(source.createdAt).toLocaleDateString()}
                </ThemedText>
              </Card>
            );
          })
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  errorContainer: { flex: 1, paddingTop: Spacing["4xl"] },
  content: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing["4xl"] },
  emptyContainer: { paddingTop: Spacing["4xl"] },
  sourceCard: { marginBottom: Spacing.sm, borderRadius: BorderRadius.md },
});
