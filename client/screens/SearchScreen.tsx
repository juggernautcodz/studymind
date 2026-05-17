import React, { useState, useCallback } from "react";
import {
  View,
  StyleSheet,
  TextInput,
  FlatList,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/Icon";
import { useQuery } from "@tanstack/react-query";
import { useDebounce } from "@/hooks/useDebounce";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { RootStackParamList } from "@/navigation/RootStackNavigator";
import { getApiUrl } from "@/lib/query-client";

type SearchResult = {
  id: string;
  type: "topic" | "flashcard" | "course";
  title?: string;
  name?: string;
  front?: string;
  back?: string;
  snippet?: string;
  topic?: string;
  course?: string;
  topicId?: string;
  courseId?: string;
};

type SearchResponse = {
  lectures: SearchResult[];
  flashcards: SearchResult[];
  topics: SearchResult[];
  courses: SearchResult[];
  total: number;
};

// Premium dark palette icon colors
const ICON_COLORS: Record<string, string> = {
  topic: "#F59E0B",
  flashcard: "#3B82F6",
  course: "#7C3AED",
};

export default function SearchScreen() {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 300);
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();

  const { data, isLoading, error } = useQuery<SearchResponse>({
    queryKey: ["/api/search", debouncedQuery],
    queryFn: async () => {
      if (!debouncedQuery || debouncedQuery.length < 2) {
        return {
          lectures: [],
          flashcards: [],
          topics: [],
          courses: [],
          total: 0,
        };
      }
      const url = new URL("/api/search", getApiUrl());
      url.searchParams.set("q", debouncedQuery);
      const res = await fetch(url.toString(), { credentials: "include" });
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    enabled: debouncedQuery.length >= 2,
    staleTime: 30000,
  });

  const allResults: SearchResult[] = [
    ...(data?.lectures || []).map((item) => ({ ...item, type: "topic" as const })),
    ...(data?.flashcards || []),
    ...(data?.topics || []),
    ...(data?.courses || []),
  ];

  const handleResultPress = useCallback(
    (item: SearchResult) => {
      switch (item.type) {
        case "topic":
          if (item.courseId) {
            navigation.navigate("Topic", { topicId: item.id, courseId: item.courseId });
          }
          break;
        case "flashcard":
          if (item.topicId && item.courseId) {
            navigation.navigate("Topic", { topicId: item.topicId, courseId: item.courseId });
          }
          break;
        case "course":
          navigation.navigate("Course", { courseId: item.id });
          break;
      }
    },
    [navigation],
  );

  const getIcon = (type: string): string => {
    switch (type) {
      case "topic":
        return "bookmark";
      case "flashcard":
        return "layers";
      case "course":
        return "book";
      default:
        return "search";
    }
  };

  const getTitle = (item: SearchResult): string => {
    if (item.title) return item.title;
    if (item.name) return item.name;
    if (item.front) return item.front;
    return "Untitled";
  };

  const getSubtitle = (item: SearchResult): string => {
    const parts = [];
    if (item.course) parts.push(item.course);
    if (item.topic) parts.push(item.topic);
    return parts.join(" > ");
  };

  const renderResult = ({ item }: { item: SearchResult }) => {
    const iconColor = ICON_COLORS[item.type] || "#7C3AED";

    return (
      <Pressable
        onPress={() => handleResultPress(item)}
        accessibilityRole="button"
        accessibilityLabel={`${item.type}: ${getTitle(item)}`}
        testID={`search-result-${item.type}-${item.id}`}
      >
        <View
          style={[
            styles.resultCard,
            {
              backgroundColor: theme.backgroundDefault,
              borderColor: theme.border,
              shadowColor: "#7C3AED",
              shadowOpacity: 0.1,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 2 },
              elevation: 2,
            },
          ]}
        >
          <View style={styles.resultRow}>
            <View
              style={[
                styles.iconContainer,
                { backgroundColor: iconColor + "20" },
              ]}
            >
              <Icon name={getIcon(item.type)} size={18} color={iconColor} />
            </View>
            <View style={styles.resultContent}>
              <ThemedText
                style={[styles.resultTitle, { color: theme.text }]}
                numberOfLines={1}
              >
                {getTitle(item)}
              </ThemedText>
              <View style={styles.resultMeta}>
                <View style={[styles.typeTag, { backgroundColor: iconColor + "15" }]}>
                  <ThemedText style={[styles.resultType, { color: iconColor }]}>
                    {item.type.charAt(0).toUpperCase() + item.type.slice(1)}
                  </ThemedText>
                </View>
                {getSubtitle(item) ? (
                  <ThemedText
                    style={[styles.resultPath, { color: theme.textSecondary }]}
                    numberOfLines={1}
                  >
                    {" > "}
                    {getSubtitle(item)}
                  </ThemedText>
                ) : null}
              </View>
              {item.snippet ? (
                <ThemedText
                  style={[styles.snippet, { color: theme.textSecondary }]}
                  numberOfLines={2}
                >
                  {item.snippet}
                </ThemedText>
              ) : null}
              {item.back ? (
                <ThemedText
                  style={[styles.snippet, { color: theme.textSecondary }]}
                  numberOfLines={2}
                >
                  {item.back}
                </ThemedText>
              ) : null}
            </View>
            <Icon name="chevron-right" size={16} color={theme.textSecondary} />
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <ThemedView
      style={[styles.container, { backgroundColor: theme.backgroundRoot, paddingTop: insets.top + Spacing.lg }]}
    >
      {/* Search bar */}
      <View style={styles.searchContainer}>
        <View
          style={[
            styles.searchInputWrapper,
            {
              backgroundColor: theme.backgroundDefault,
              borderColor: "#7C3AED50",
              shadowColor: "#7C3AED",
              shadowOpacity: 0.15,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 2 },
              elevation: 3,
            },
          ]}
        >
          <Icon
            name="search"
            size={20}
            color="#7C3AED"
            style={styles.searchIcon}
          />
          <TextInput
            style={[styles.searchInput, { color: theme.text }]}
            placeholder="Search topics, flashcards, courses..."
            placeholderTextColor={theme.textSecondary}
            value={query}
            onChangeText={setQuery}
            autoFocus
            returnKeyType="search"
            accessibilityLabel="Search"
            testID="input-search"
          />
          {query.length > 0 ? (
            <Pressable
              onPress={() => setQuery("")}
              style={styles.clearButton}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <View style={[styles.clearIcon, { backgroundColor: theme.backgroundSecondary }]}>
                <Icon name="x" size={14} color={theme.textSecondary} />
              </View>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Results area */}
      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#7C3AED" />
          <ThemedText style={[styles.emptyText, { color: theme.textSecondary }]}>
            Searching...
          </ThemedText>
        </View>
      ) : query.length < 2 ? (
        <View style={styles.centered}>
          <View style={[styles.emptyIconWrap, { backgroundColor: "#7C3AED15" }]}>
            <Icon name="search" size={32} color="#7C3AED" />
          </View>
          <ThemedText type="h4" style={{ color: theme.text, marginTop: Spacing.lg, textAlign: "center" }}>
            Search your study materials
          </ThemedText>
          <ThemedText
            style={[styles.emptyText, { color: theme.textSecondary, marginTop: Spacing.sm }]}
          >
            Enter at least 2 characters to search
          </ThemedText>
        </View>
      ) : allResults.length === 0 ? (
        <View style={styles.centered}>
          <View style={[styles.emptyIconWrap, { backgroundColor: theme.backgroundSecondary }]}>
            <Icon name="inbox" size={32} color={theme.textSecondary} />
          </View>
          <ThemedText type="h4" style={{ color: theme.text, marginTop: Spacing.lg, textAlign: "center" }}>
            No results found
          </ThemedText>
          <ThemedText
            style={[styles.emptyText, { color: theme.textSecondary, marginTop: Spacing.sm }]}
          >
            {`Try different keywords for "${query}"`}
          </ThemedText>
        </View>
      ) : (
        <FlatList
          data={allResults}
          renderItem={renderResult}
          keyExtractor={(item, index) => `${item.type}-${item.id}-${index}`}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + Spacing.lg },
          ]}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={styles.resultsHeader}>
              <View style={[styles.resultsBadge, { backgroundColor: "#7C3AED20" }]}>
                <ThemedText style={[styles.resultsCount, { color: "#9F67FF" }]}>
                  {data?.total || 0} result{(data?.total || 0) !== 1 ? "s" : ""}
                </ThemedText>
              </View>
            </View>
          }
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchContainer: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  searchInputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    height: 52,
    borderWidth: 1.5,
  },
  searchIcon: {
    marginRight: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    height: "100%",
  },
  clearButton: {
    padding: Spacing.xs,
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  clearIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing["2xl"],
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    marginTop: Spacing.sm,
    textAlign: "center",
    lineHeight: 20,
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
  },
  resultsHeader: {
    marginBottom: Spacing.md,
    flexDirection: "row",
  },
  resultsBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.xs,
  },
  resultsCount: {
    fontSize: 13,
    fontWeight: "600",
  },
  resultCard: {
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginBottom: Spacing.md,
    padding: Spacing.md,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  iconContainer: {
    width: 38,
    height: 38,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.md,
    flexShrink: 0,
  },
  resultContent: {
    flex: 1,
  },
  resultTitle: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 4,
  },
  resultMeta: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
    flexWrap: "wrap",
    gap: 4,
  },
  typeTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  resultType: {
    fontSize: 11,
    fontWeight: "700",
  },
  resultPath: {
    fontSize: 12,
    flex: 1,
  },
  snippet: {
    fontSize: 13,
    marginTop: 4,
    lineHeight: 18,
  },
});
