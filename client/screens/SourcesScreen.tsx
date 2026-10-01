import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Icon } from "@/components/Icon";
import { BorderRadius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/useTheme";
import { useCourseSources } from "@/lib/sourceLock";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

function sourceKindLabel(kind: string) {
  return kind
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export default function SourcesScreen() {
  const route = useRoute<any>();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
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
              <Card
                key={source.id}
                style={styles.sourceCard}
                onPress={() =>
                  navigation.navigate("SourceDetail", {
                    courseId,
                    sourceId: source.id,
                  })
                }
                accessibilityLabel={`View source ${source.title}`}
              >
                <View style={styles.sourceHeader}>
                  <ThemedText type="h4" style={styles.sourceTitle}>
                    {source.title}
                  </ThemedText>
                  <Icon
                    name="chevron-right"
                    size={20}
                    color={theme.textSecondary}
                  />
                </View>
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
  sourceHeader: { flexDirection: "row", alignItems: "center" },
  sourceTitle: { flex: 1, marginRight: Spacing.sm },
});
