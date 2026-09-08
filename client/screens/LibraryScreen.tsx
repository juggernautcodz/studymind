import React, { useCallback, useMemo, useState } from "react";
import { View, StyleSheet, FlatList, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Icon } from "@/components/Icon";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { useTheme } from "@/hooks/useTheme";
import { storage } from "@/lib/storage";
import { Spacing, BorderRadius } from "@/constants/theme";
import { RootStackParamList } from "@/navigation/RootStackNavigator";

type LibraryItemType = "note" | "flashcard" | "quiz";
type FilterKey = "all" | "note" | "flashcard" | "quiz";

interface LibraryItem {
  id: string;
  type: LibraryItemType;
  title: string;
  subtitle: string;
  topicId: string;
  courseId: string;
  createdAt: string;
  count?: number;
}

const TYPE_COLORS: Record<LibraryItemType, string> = {
  note: "#F59E0B",
  flashcard: "#3B82F6",
  quiz: "#7C3AED",
};

const TYPE_ICONS: Record<LibraryItemType, string> = {
  note: "file-text",
  flashcard: "layers",
  quiz: "help-circle",
};

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "note", label: "Notes" },
  { key: "flashcard", label: "Flashcards" },
  { key: "quiz", label: "Quizzes" },
];

export default function LibraryScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [items, setItems] = useState<LibraryItem[]>([]);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [isLoading, setIsLoading] = useState(true);

  const loadLibrary = useCallback(async () => {
    setIsLoading(true);
    try {
      const [topics, courses, notes, flashcards, quizzes] = await Promise.all([
        storage.getTopics(),
        storage.getCourses(),
        storage.getAllNotes(),
        storage.getAllFlashcards(),
        storage.getAllQuizzes(),
      ]);

      const courseNameById = new Map(courses.map((c) => [c.id, c.name]));
      const topicById = new Map(topics.map((t) => [t.id, t]));

      const flashcardCountByTopic = new Map<string, number>();
      for (const card of flashcards) {
        flashcardCountByTopic.set(
          card.topicId,
          (flashcardCountByTopic.get(card.topicId) || 0) + 1,
        );
      }

      const built: LibraryItem[] = [];

      for (const note of notes) {
        const topic = topicById.get(note.topicId);
        if (!topic) continue;
        built.push({
          id: `note-${note.id}`,
          type: "note",
          title: note.title || topic.name,
          subtitle: `${topic.name} · ${courseNameById.get(topic.courseId) || ""}`,
          topicId: topic.id,
          courseId: topic.courseId,
          createdAt: note.updatedAt || note.createdAt,
        });
      }

      for (const [topicId, count] of flashcardCountByTopic) {
        const topic = topicById.get(topicId);
        if (!topic || count === 0) continue;
        built.push({
          id: `flashcard-${topicId}`,
          type: "flashcard",
          title: `${count} flashcard${count > 1 ? "s" : ""}`,
          subtitle: `${topic.name} · ${courseNameById.get(topic.courseId) || ""}`,
          topicId: topic.id,
          courseId: topic.courseId,
          createdAt: topic.createdAt,
          count,
        });
      }

      for (const quiz of quizzes) {
        const topic = topicById.get(quiz.topicId);
        if (!topic) continue;
        built.push({
          id: `quiz-${quiz.id}`,
          type: "quiz",
          title: `Quiz · ${topic.name}`,
          subtitle: courseNameById.get(topic.courseId) || "",
          topicId: topic.id,
          courseId: topic.courseId,
          createdAt: quiz.createdAt,
        });
      }

      built.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      setItems(built);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadLibrary();
    }, [loadLibrary]),
  );

  const filteredItems = useMemo(
    () => (filter === "all" ? items : items.filter((i) => i.type === filter)),
    [items, filter],
  );

  const handlePress = (item: LibraryItem) => {
    navigation.navigate("Topic", {
      topicId: item.topicId,
      courseId: item.courseId,
    });
  };

  const renderChip = ({ key, label }: { key: FilterKey; label: string }) => {
    const active = filter === key;
    return (
      <Pressable
        key={key}
        onPress={() => setFilter(key)}
        style={[
          styles.chip,
          {
            backgroundColor: active
              ? theme.link + "20"
              : theme.backgroundDefault,
            borderColor: active ? theme.link : theme.border,
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel={label}
        testID={`library-filter-${key}`}
      >
        <ThemedText
          type="small"
          style={{
            color: active ? theme.link : theme.textSecondary,
            fontWeight: "600",
          }}
        >
          {label}
        </ThemedText>
      </Pressable>
    );
  };

  const renderItem = ({ item }: { item: LibraryItem }) => {
    const color = TYPE_COLORS[item.type];
    return (
      <Pressable
        onPress={() => handlePress(item)}
        accessibilityRole="button"
        accessibilityLabel={item.title}
        testID={`library-item-${item.id}`}
      >
        <View
          style={[
            styles.itemCard,
            {
              backgroundColor: theme.backgroundDefault,
              borderColor: theme.border,
            },
          ]}
        >
          <View style={[styles.itemIcon, { backgroundColor: color + "20" }]}>
            <Icon name={TYPE_ICONS[item.type]} size={18} color={color} />
          </View>
          <View style={styles.itemContent}>
            <ThemedText
              style={{ color: theme.text, fontWeight: "600" }}
              numberOfLines={1}
            >
              {item.title}
            </ThemedText>
            <ThemedText
              type="small"
              style={{ color: theme.textSecondary, marginTop: 2 }}
              numberOfLines={1}
            >
              {item.subtitle}
            </ThemedText>
          </View>
          <Icon name="chevron-right" size={18} color={theme.textSecondary} />
        </View>
      </Pressable>
    );
  };

  if (isLoading) {
    return <LoadingState fullScreen message="Loading your library..." />;
  }

  return (
    <ThemedView
      style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
    >
      <View style={styles.chipsRow}>{FILTERS.map((f) => renderChip(f))}</View>

      {filteredItems.length === 0 ? (
        <View style={styles.emptyContainer}>
          <EmptyState
            icon="inbox"
            title="Nothing here yet"
            description={
              filter === "all"
                ? "Add study material to a topic and it'll show up here."
                : `No ${filter}s yet. Add study material to a topic to create some.`
            }
            compact
          />
        </View>
      ) : (
        <FlatList
          data={filteredItems}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + Spacing.xl },
          ]}
          showsVerticalScrollIndicator={false}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  chipsRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
  },
  itemCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginBottom: Spacing.sm,
  },
  itemIcon: {
    width: 38,
    height: 38,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.md,
  },
  itemContent: {
    flex: 1,
  },
});
