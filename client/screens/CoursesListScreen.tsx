import React, { useState, useCallback } from "react";
import { View, StyleSheet, FlatList, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Icon } from "@/components/Icon";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { SkeletonList } from "@/components/Skeleton";
import { useTheme } from "@/hooks/useTheme";
import { storage } from "@/lib/storage";
import { Spacing, BorderRadius } from "@/constants/theme";
import type { Course, Semester, Topic } from "@/types";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

export default function CoursesListScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation<NativeStackNavigationProp<any>>();

  const [courses, setCourses] = useState<Course[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [loadedCourses, loadedSemesters, loadedTopics] =
        await Promise.all([
          storage.getCourses(),
          storage.getSemesters(),
          storage.getTopics(),
        ]);
      setCourses(loadedCourses);
      setSemesters(loadedSemesters);
      setTopics(loadedTopics);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  const getSemesterName = (semesterId: string) => {
    return semesters.find((s) => s.id === semesterId)?.name || "";
  };

  const getStats = (courseId: string) => {
    const courseTopics = topics.filter((t) => t.courseId === courseId);
    const completedTopics = courseTopics.filter(
      (t) => t.status === "completed",
    );
    return {
      topics: courseTopics.length,
      completed: completedTopics.length,
    };
  };

  // Derive a nice accent color per course, cycling through preset palette
  const COURSE_ACCENT_COLORS = [
    "#7C3AED",
    "#3B82F6",
    "#06B6D4",
    "#10B981",
    "#F59E0B",
    "#EF4444",
    "#8B5CF6",
    "#EC4899",
  ];

  const getCourseColor = (course: Course, index: number) => {
    if (course.color) return course.color;
    return COURSE_ACCENT_COLORS[index % COURSE_ACCENT_COLORS.length];
  };

  const renderCourse = ({ item, index }: { item: Course; index: number }) => {
    const stats = getStats(item.id);
    const semesterName = getSemesterName(item.semesterId);
    const accentColor = getCourseColor(item, index);
    const progress = stats.topics > 0 ? stats.completed / stats.topics : 0;

    return (
      <Pressable
        style={({ pressed }) => [
          styles.courseCard,
          {
            backgroundColor: theme.backgroundDefault,
            borderColor: pressed ? accentColor + "60" : theme.border,
            shadowColor: accentColor,
            shadowOpacity: pressed ? 0.25 : 0.1,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 4 },
            elevation: 4,
            opacity: pressed ? 0.95 : 1,
          },
        ]}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          navigation.navigate("Course", { courseId: item.id });
        }}
        testID={`card-course-${item.id}`}
        accessibilityRole="button"
        accessibilityLabel={`Open course ${item.name}`}
      >
        {/* Top accent bar */}
        <View style={[styles.accentBar, { backgroundColor: accentColor }]} />

        <View style={styles.cardInner}>
          {/* Icon + badge row */}
          <View style={styles.cardTop}>
            <View
              style={[
                styles.iconContainer,
                { backgroundColor: accentColor + "20" },
              ]}
            >
              <Icon name="book" size={22} color={accentColor} />
            </View>
            {stats.completed > 0 ? (
              <View style={[styles.badge, { backgroundColor: "#10B98120" }]}>
                <View style={[styles.badgeDot, { backgroundColor: "#10B981" }]} />
                <ThemedText style={[styles.badgeText, { color: "#10B981" }]}>
                  {stats.completed} ready
                </ThemedText>
              </View>
            ) : null}
          </View>

          {/* Course name */}
          <ThemedText type="h4" style={[styles.courseName, { color: theme.text }]} numberOfLines={2}>
            {item.name}
          </ThemedText>

          {/* Semester label */}
          {semesterName ? (
            <ThemedText
              type="caption"
              style={[styles.semesterLabel, { color: theme.textSecondary }]}
              numberOfLines={1}
            >
              {semesterName}
            </ThemedText>
          ) : null}

          {/* Stats row */}
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Icon name="folder" size={13} color={theme.textSecondary} />
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                {stats.topics} {stats.topics === 1 ? "topic" : "topics"}
              </ThemedText>
            </View>
            {stats.topics > 0 ? (
              <ThemedText type="caption" style={{ color: accentColor, fontWeight: "600" }}>
                {Math.round(progress * 100)}%
              </ThemedText>
            ) : null}
          </View>

          {/* Progress bar */}
          {stats.topics > 0 ? (
            <View style={[styles.progressTrack, { backgroundColor: theme.border }]}>
              <View
                style={[
                  styles.progressFill,
                  { backgroundColor: accentColor, width: `${Math.round(progress * 100)}%` as any },
                ]}
              />
            </View>
          ) : null}
        </View>
      </Pressable>
    );
  };

  if (isLoading) {
    return (
      <View
        style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      >
        <View
          style={{
            paddingTop: headerHeight + Spacing.lg,
            paddingHorizontal: Spacing.lg,
          }}
        >
          <SkeletonList count={4} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <FlatList
        data={courses}
        renderItem={renderCourse}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.list,
          {
            paddingTop: headerHeight + Spacing.lg,
            paddingBottom: tabBarHeight + Spacing.xl,
          },
        ]}
        scrollIndicatorInsets={{ bottom: insets.bottom }}
        numColumns={2}
        columnWrapperStyle={courses.length > 1 ? styles.row : undefined}
        ListEmptyComponent={
          <EmptyState
            icon="book"
            iconColor="#7C3AED"
            title="No Courses Yet"
            description="Create a semester first, then add courses from the Home tab."
            buttonLabel="Go to Home"
            onButtonPress={() =>
              navigation.navigate("HomeTab")
            }
            compact
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  list: {
    paddingHorizontal: Spacing.lg,
    flexGrow: 1,
  },
  row: {
    justifyContent: "space-between",
  },
  courseCard: {
    width: "48%",
    marginBottom: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    overflow: "hidden",
  },
  accentBar: {
    height: 4,
    width: "100%",
  },
  cardInner: {
    padding: Spacing.md,
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: Spacing.sm,
  },
  iconContainer: {
    width: 42,
    height: 42,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "700",
  },
  courseName: {
    marginBottom: Spacing.xs,
  },
  semesterLabel: {
    marginBottom: Spacing.sm,
    fontSize: 11,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  statItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 2,
    minWidth: 2,
  },
});
