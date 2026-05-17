import React, { useState, useCallback } from "react";
import { View, StyleSheet, FlatList, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import {
  useFocusEffect,
  useNavigation,
  useRoute,
} from "@react-navigation/native";
import { Icon } from "@/components/Icon";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { BottomSheet } from "@/components/BottomSheet";
import { Input } from "@/components/Input";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { SectionHeader } from "@/components/SectionHeader";
import { LoadingState } from "@/components/LoadingState";
import { useTheme } from "@/hooks/useTheme";
import { useToast } from "@/components/Toast";
import { storage } from "@/lib/storage";
import { Spacing, BorderRadius } from "@/constants/theme";
import type { Semester, Course, Topic } from "@/types";
import { COURSE_COLORS } from "@/types";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

export default function SemesterScreen() {
  const { theme } = useTheme();
  const { showToast } = useToast();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const route = useRoute<any>();
  const { semesterId } = route.params;

  const [semester, setSemester] = useState<Semester | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [showDeleteSheet, setShowDeleteSheet] = useState(false);
  const [deleteCourseTarget, setDeleteCourseTarget] = useState<Course | null>(null);
  const [courseName, setCourseName] = useState("");
  const [courseCode, setCourseCode] = useState("");

  const loadData = useCallback(async () => {
    try {
      const [semesters, loadedCourses, loadedTopics] =
        await Promise.all([
          storage.getSemesters(),
          storage.getCoursesBySemester(semesterId),
          storage.getTopics(),
        ]);
      setSemester(semesters.find((s) => s.id === semesterId) || null);
      setCourses(loadedCourses);
      setTopics(loadedTopics);
    } finally {
      setIsLoading(false);
    }
  }, [semesterId]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  React.useLayoutEffect(() => {
    if (semester) {
      navigation.setOptions({
        headerTitle: semester.name,
      });
    }
  }, [navigation, semester]);

  const getStatsForCourse = (courseId: string) => {
    const courseTopics = topics.filter((t) => t.courseId === courseId);
    const completedTopics = courseTopics.filter((t) => t.status === "completed");
    return {
      topics: courseTopics.length,
      completed: completedTopics.length,
    };
  };

  const handleAddCourse = async () => {
    if (!courseName.trim()) return;

    try {
      const user = await storage.getUser();
      if (!user) return;

      const colorIndex = courses.length % COURSE_COLORS.length;
      await storage.createCourse({
        userId: user.id,
        semesterId,
        name: courseName.trim(),
        code: courseCode.trim() || "",
        color: COURSE_COLORS[colorIndex],
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({
        type: "success",
        title: "Course added!",
        message: "Now add topics to organize your study materials",
      });
      setCourseName("");
      setCourseCode("");
      setShowAddSheet(false);
      loadData();
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({
        type: "error",
        title: "Failed",
        message: "Could not create course",
      });
    }
  };

  const handleDeleteCourse = (course: Course) => {
    setDeleteCourseTarget(course);
    setShowDeleteSheet(true);
  };

  const confirmDeleteCourse = async () => {
    if (!deleteCourseTarget) return;
    setShowDeleteSheet(false);
    await storage.deleteCourse(deleteCourseTarget.id);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast({
      type: "success",
      title: "Deleted",
      message: "Course removed",
    });
    setDeleteCourseTarget(null);
    loadData();
  };

  const COURSE_ACCENT_COLORS = [
    "#7C3AED", "#3B82F6", "#06B6D4", "#10B981",
    "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899",
  ];

  const renderCourse = ({ item, index }: { item: Course; index: number }) => {
    const stats = getStatsForCourse(item.id);
    const accentColor = item.color || COURSE_ACCENT_COLORS[index % COURSE_ACCENT_COLORS.length];
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
        onLongPress={() => handleDeleteCourse(item)}
      >
        <View style={[styles.accentBar, { backgroundColor: accentColor }]} />
        <View style={styles.cardInner}>
          <View style={styles.cardTop}>
            <View style={[styles.iconContainer, { backgroundColor: accentColor + "20" }]}>
              <Icon name="book" size={20} color={accentColor} />
            </View>
            {stats.completed > 0 ? (
              <View style={[styles.completedBadge, { backgroundColor: "#10B98120" }]}>
                <View style={[styles.badgeDot, { backgroundColor: "#10B981" }]} />
                <ThemedText style={[styles.badgeText, { color: "#10B981" }]}>
                  {stats.completed} done
                </ThemedText>
              </View>
            ) : null}
          </View>
          {item.code ? (
            <ThemedText type="caption" style={[styles.courseCode, { color: accentColor }]}>
              {item.code}
            </ThemedText>
          ) : null}
          <ThemedText type="h4" numberOfLines={2} style={[styles.courseName, { color: theme.text }]}>
            {item.name}
          </ThemedText>
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
    return <LoadingState fullScreen message="Loading courses..." />;
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <FlatList
        data={courses}
        renderItem={renderCourse}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={courses.length > 1 ? styles.row : undefined}
        contentContainerStyle={[
          styles.list,
          {
            paddingTop: headerHeight + Spacing.lg,
            paddingBottom: insets.bottom + Spacing["4xl"],
          },
        ]}
        scrollIndicatorInsets={{ bottom: insets.bottom }}
        ListHeaderComponent={
          courses.length > 0 ? (
            <SectionHeader
              title="Your Courses"
              icon="book"
              subtitle={`${courses.length} course${courses.length !== 1 ? "s" : ""} in this semester`}
              action={{
                label: "Add",
                icon: "plus",
                onPress: () => setShowAddSheet(true),
              }}
            />
          ) : null
        }
        ListEmptyComponent={
          <EmptyState
            image={require("../../assets/images/empty-courses.png")}
            title="Add Your First Course"
            description="Add your courses and we'll help you build notes, flashcards, and quizzes to ace every exam."
            buttonLabel="Add Course"
            onButtonPress={() => setShowAddSheet(true)}
          />
        }
      />

      {courses.length > 0 ? (
        <Pressable
          style={[
            styles.fab,
            { backgroundColor: theme.link, bottom: insets.bottom + 20 },
          ]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            setShowAddSheet(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="Add new course"
        >
          <Icon name="plus" size={20} color="#fff" />
          <ThemedText style={styles.fabText}>New</ThemedText>
        </Pressable>
      ) : null}

      <BottomSheet
        visible={showAddSheet}
        onClose={() => {
          setShowAddSheet(false);
          setCourseName("");
          setCourseCode("");
        }}
        title="New Course"
      >
        <Input
          label="Course Name"
          placeholder="e.g., Introduction to Computer Science"
          value={courseName}
          onChangeText={setCourseName}
          autoFocus
        />
        <Input
          label="Course Code (optional)"
          placeholder="e.g., CS101"
          value={courseCode}
          onChangeText={setCourseCode}
        />
        <Button
          onPress={handleAddCourse}
          disabled={!courseName.trim()}
          size="lg"
          fullWidth
        >
          Create Course
        </Button>
      </BottomSheet>

      <BottomSheet
        visible={showDeleteSheet}
        onClose={() => { setShowDeleteSheet(false); setDeleteCourseTarget(null); }}
        title="Delete Course?"
      >
        <ThemedText type="body" style={{ color: theme.textSecondary, marginBottom: Spacing.lg }}>
          {deleteCourseTarget ? `This will permanently delete "${deleteCourseTarget.name}" and all its topics and content.` : ""}
        </ThemedText>
        <Button
          variant="destructive"
          fullWidth
          onPress={confirmDeleteCourse}
        >
          Delete
        </Button>
        <Button
          variant="ghost"
          fullWidth
          onPress={() => { setShowDeleteSheet(false); setDeleteCourseTarget(null); }}
          style={{ marginTop: Spacing.sm }}
        >
          Cancel
        </Button>
      </BottomSheet>
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
    width: 40,
    height: 40,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  completedBadge: {
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
  courseCode: {
    marginBottom: 2,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontSize: 10,
    fontWeight: "700",
  },
  courseName: {
    marginBottom: Spacing.xs,
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
  fab: {
    position: "absolute",
    right: Spacing.xl,
    flexDirection: "row",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    elevation: 4,
  },
  fabText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
  },
});
