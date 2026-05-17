import React, { useState, useCallback, useEffect, useRef } from "react";
import { View, StyleSheet, ScrollView, Pressable, Modal } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import {
  useFocusEffect,
  useNavigation,
  useRoute,
} from "@react-navigation/native";
import { Icon } from "@/components/Icon";
import * as Haptics from "expo-haptics";
// Animations removed - using native modal slide animation instead

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { BottomSheet } from "@/components/BottomSheet";
import { Input } from "@/components/Input";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { LoadingState } from "@/components/LoadingState";
import { useTheme } from "@/hooks/useTheme";
import { storage } from "@/lib/storage";
import { Spacing, BorderRadius } from "@/constants/theme";
import type { Course, Topic, MindmapNode } from "@/types";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

interface TreeNode extends MindmapNode {
  children: TreeNode[];
}

export default function MindmapScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const route = useRoute<any>();
  const { courseId } = route.params;

  const [course, setCourse] = useState<Course | null>(null);
  const [nodes, setNodes] = useState<MindmapNode[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);
  const [nodeName, setNodeName] = useState("");
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
  const isMountedRef = useRef(true);

  // Cleanup on unmount to prevent freeze/memory leaks
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Dismiss any open modals/sheets on unmount
      setSelectedNode(null);
      setShowAddSheet(false);
    };
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [loadedCourse, loadedNodes, loadedTopics] =
        await Promise.all([
          storage.getCourse(courseId),
          storage.getMindmapNodes(courseId),
          storage.getTopicsByCourse(courseId),
        ]);

      setCourse(loadedCourse);
      setTopics(loadedTopics);

      if (loadedNodes.length === 0 && loadedCourse) {
        const user = await storage.getUser();
        if (user) {
          const rootNode = await storage.createMindmapNode({
            userId: user.id,
            courseId,
            parentId: null,
            nodeType: "course",
            title: loadedCourse.name,
            depth: 0,
            orderIndex: 0,
          });

          for (let i = 0; i < loadedTopics.length; i++) {
            await storage.createMindmapNode({
              userId: user.id,
              courseId,
              parentId: rootNode.id,
              nodeType: "topic",
              title: loadedTopics[i].name,
              depth: 1,
              orderIndex: i,
              linkedItemId: loadedTopics[i].id,
            });
          }

          const updatedNodes = await storage.getMindmapNodes(courseId);
          setNodes(updatedNodes);
          const allIds = updatedNodes.map((n) => n.id);
          setExpandedNodes(new Set(allIds));
        }
      } else {
        setNodes(loadedNodes);
        const allIds = loadedNodes.map((n) => n.id);
        setExpandedNodes(new Set(allIds));
      }
    } finally {
      setIsLoading(false);
    }
  }, [courseId]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  React.useLayoutEffect(() => {
    if (course) {
      navigation.setOptions({
        headerTitle: "Mind Map",
      });
    }
  }, [navigation, course]);

  const buildTree = (parentId: string | null): TreeNode[] => {
    return nodes
      .filter((n) => n.parentId === parentId)
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((node) => ({
        ...node,
        children: buildTree(node.id),
      }));
  };

  const toggleExpand = (nodeId: string) => {
    Haptics.selectionAsync();
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const handleNodePress = (node: TreeNode) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedNode(node);
  };

  const handleAddNode = async () => {
    if (!nodeName.trim()) return;

    try {
      const user = await storage.getUser();
      if (!user) return;

      const parentNode = selectedParentId
        ? nodes.find((n) => n.id === selectedParentId)
        : null;
      const siblings = nodes.filter((n) => n.parentId === selectedParentId);

      await storage.createMindmapNode({
        userId: user.id,
        courseId,
        parentId: selectedParentId,
        nodeType: "concept",
        title: nodeName.trim(),
        depth: parentNode ? parentNode.depth + 1 : 0,
        orderIndex: siblings.length,
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setNodeName("");
      setShowAddSheet(false);
      setSelectedParentId(null);
      loadData();
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const getNodeIcon = (nodeType: MindmapNode["nodeType"]): string => {
    switch (nodeType) {
      case "course":
        return "book";
      case "topic":
        return "folder";
      case "concept":
        return "tag";
      default:
        return "circle";
    }
  };

  const getNodeColor = (nodeType: MindmapNode["nodeType"]) => {
    switch (nodeType) {
      case "course":
        return course?.color || theme.link;
      case "topic":
        return theme.warning;
      case "concept":
        return theme.info;
      default:
        return theme.textSecondary;
    }
  };

  const getNodeLabel = (nodeType: MindmapNode["nodeType"]) => {
    switch (nodeType) {
      case "course":
        return "Course";
      case "topic":
        return "Topic";
      case "concept":
        return "Concept";
      default:
        return "Node";
    }
  };

  const renderNode = (node: TreeNode, level: number = 0) => {
    const isExpanded = expandedNodes.has(node.id);
    const hasChildren = node.children.length > 0;
    const iconColor = getNodeColor(node.nodeType);
    const isRoot = level === 0;

    return (
      <View key={node.id}>
        <Pressable
          onPress={() => handleNodePress(node)}
          style={[
            styles.nodeRow,
            {
              paddingLeft: Spacing.md + level * Spacing.lg,
              backgroundColor:
                selectedNode?.id === node.id
                  ? theme.link + "10"
                  : "transparent",
            },
          ]}
        >
          {hasChildren ? (
            <Pressable
              onPress={() => toggleExpand(node.id)}
              style={styles.expandButton}
              hitSlop={8}
            >
              <Icon
                name={isExpanded ? "chevron-down" : "chevron-right"}
                size={16}
                color={theme.textSecondary}
              />
            </Pressable>
          ) : (
            <View style={styles.expandPlaceholder} />
          )}

          <View
            style={[styles.nodeIcon, { backgroundColor: iconColor + "20" }]}
          >
            <Icon
              name={getNodeIcon(node.nodeType)}
              size={14}
              color={iconColor}
            />
          </View>

          <View style={styles.nodeContent}>
            <ThemedText
              type={isRoot ? "h4" : "body"}
              style={styles.nodeTitle}
              numberOfLines={1}
            >
              {node.title}
            </ThemedText>
            {hasChildren ? (
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                {node.children.length} item
                {node.children.length !== 1 ? "s" : ""}
              </ThemedText>
            ) : null}
          </View>

          <Icon name="chevron-right" size={16} color={theme.textSecondary} />
        </Pressable>

        {isExpanded &&
          node.children.map((child) => renderNode(child, level + 1))}
      </View>
    );
  };

  const renderNodeDrawer = () => {
    if (!selectedNode) return null;

    const nodeColor = getNodeColor(selectedNode.nodeType);
    const linkedTopic = selectedNode.linkedItemId
      ? topics.find((t) => t.id === selectedNode.linkedItemId)
      : null;

    return (
      <Modal
        visible={!!selectedNode}
        transparent
        animationType="slide"
        presentationStyle="overFullScreen"
        onRequestClose={() => setSelectedNode(null)}
        statusBarTranslucent
      >
        <Pressable
          style={styles.drawerOverlay}
          onPress={() => setSelectedNode(null)}
        >
          <View
            style={[
              styles.drawer,
              {
                backgroundColor: theme.backgroundDefault,
                paddingBottom: insets.bottom + Spacing.lg,
              },
            ]}
          >
            <Pressable onPress={(e) => e.stopPropagation()}>
              <View style={styles.drawerHandle}>
                <View
                  style={[
                    styles.handleBar,
                    { backgroundColor: theme.textSecondary + "40" },
                  ]}
                />
              </View>

              <View style={styles.drawerHeader}>
                <View
                  style={[
                    styles.drawerIcon,
                    { backgroundColor: nodeColor + "15" },
                  ]}
                >
                  <Icon
                    name={getNodeIcon(selectedNode.nodeType)}
                    size={28}
                    color={nodeColor}
                  />
                </View>
                <View style={styles.drawerTitleSection}>
                  <Badge
                    label={getNodeLabel(selectedNode.nodeType)}
                    variant={
                      selectedNode.nodeType === "topic"
                        ? "warning"
                        : "info"
                    }
                  />
                  <ThemedText type="h2" style={styles.drawerTitle}>
                    {selectedNode.title}
                  </ThemedText>
                </View>
              </View>

              <View style={styles.drawerStats}>
                <View
                  style={[
                    styles.statBox,
                    { backgroundColor: theme.backgroundSecondary },
                  ]}
                >
                  <Icon name="layers" size={18} color={theme.info} />
                  <ThemedText type="h4">
                    {selectedNode.children.length}
                  </ThemedText>
                  <ThemedText
                    type="caption"
                    style={{ color: theme.textSecondary }}
                  >
                    Children
                  </ThemedText>
                </View>
                <View
                  style={[
                    styles.statBox,
                    { backgroundColor: theme.backgroundSecondary },
                  ]}
                >
                  <Icon name="git-branch" size={18} color={theme.warning} />
                  <ThemedText type="h4">{selectedNode.depth}</ThemedText>
                  <ThemedText
                    type="caption"
                    style={{ color: theme.textSecondary }}
                  >
                    Depth
                  </ThemedText>
                </View>
                <View
                  style={[
                    styles.statBox,
                    { backgroundColor: theme.backgroundSecondary },
                  ]}
                >
                  <Icon name="hash" size={18} color={theme.success} />
                  <ThemedText type="h4">
                    {selectedNode.orderIndex + 1}
                  </ThemedText>
                  <ThemedText
                    type="caption"
                    style={{ color: theme.textSecondary }}
                  >
                    Order
                  </ThemedText>
                </View>
              </View>

              <View style={styles.drawerActions}>
                {linkedTopic ? (
                  <>
                    <View style={styles.quickActionRow}>
                      <Pressable
                        style={[
                          styles.drawerQuickAction,
                          { backgroundColor: theme.success + "15" },
                        ]}
                        onPress={() => {
                          setSelectedNode(null);
                          navigation.navigate("StudyToday");
                        }}
                      >
                        <Icon name="layers" size={20} color={theme.success} />
                        <ThemedText
                          type="small"
                          style={{ color: theme.success, fontWeight: "600" }}
                        >
                          Study Cards
                        </ThemedText>
                      </Pressable>
                      <Pressable
                        style={[
                          styles.drawerQuickAction,
                          { backgroundColor: theme.warning + "15" },
                        ]}
                        onPress={() => {
                          setSelectedNode(null);
                          navigation.navigate("ExamMode");
                        }}
                      >
                        <Icon name="award" size={20} color={theme.warning} />
                        <ThemedText
                          type="small"
                          style={{ color: theme.warning, fontWeight: "600" }}
                        >
                          Take Quiz
                        </ThemedText>
                      </Pressable>
                    </View>
                    <Button
                      onPress={() => {
                        setSelectedNode(null);
                        navigation.navigate("Topic", {
                          topicId: linkedTopic.id,
                          courseId,
                        });
                      }}
                      size="lg"
                      fullWidth
                      icon={<Icon name="book-open" size={18} color="#fff" />}
                    >
                      View Topic
                    </Button>
                  </>
                ) : null}

                <Button
                  onPress={() => {
                    setSelectedParentId(selectedNode.id);
                    setSelectedNode(null);
                    setShowAddSheet(true);
                  }}
                  variant={linkedTopic ? "secondary" : "primary"}
                  size="lg"
                  fullWidth
                  icon={
                    <Icon
                      name="plus"
                      size={18}
                      color={linkedTopic ? undefined : "#fff"}
                    />
                  }
                >
                  Add Subtopic
                </Button>

                        <Button
                    onPress={() => {
                      setSelectedNode(null);
                    }}
                    variant="ghost"
                    size="lg"
                    fullWidth
                  >
                    Close
                  </Button>
              </View>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    );
  };

  if (isLoading) {
    return <LoadingState fullScreen message="Building your mind map..." />;
  }

  const tree = buildTree(null);

  return (
    <ThemedView style={[styles.container, { flex: 1 }]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: headerHeight + Spacing.lg,
            paddingBottom: insets.bottom + Spacing["3xl"],
            flexGrow: 1,
          },
        ]}
      >
        {tree.length === 0 ? (
          <EmptyState
            image={require("../../assets/images/empty-mindmap.png")}
            title="Your Knowledge Map"
            description="Add topics to your course to see them visualized as an interactive mind map."
            buttonLabel="Go to Course"
            onButtonPress={() => {
              navigation.navigate("Course", { courseId });
            }}
          />
        ) : (
          <>
            <Card style={styles.courseHeader}>
              <View style={styles.courseHeaderContent}>
                <View
                  style={[
                    styles.courseIcon,
                    { backgroundColor: (course?.color || theme.link) + "15" },
                  ]}
                >
                  <Icon
                    name="share-2"
                    size={24}
                    color={course?.color || theme.link}
                  />
                </View>
                <View style={styles.courseInfo}>
                  <ThemedText type="h3">{course?.name}</ThemedText>
                  <ThemedText
                    type="small"
                    style={{ color: theme.textSecondary }}
                  >
                    {topics.length} topics
                  </ThemedText>
                </View>
              </View>
            </Card>

            <View
              style={[
                styles.treeContainer,
                {
                  backgroundColor: theme.backgroundDefault,
                  borderWidth: 1,
                  borderColor: theme.border,
                },
              ]}
            >
              {tree.map((node) => renderNode(node))}
            </View>

            <View style={styles.hintContainer}>
              <Icon name="info" size={14} color={theme.textSecondary} />
              <ThemedText
                type="small"
                style={[styles.hint, { color: theme.textSecondary }]}
              >
                Tap any node to see details and actions
              </ThemedText>
            </View>
          </>
        )}
      </ScrollView>

      {renderNodeDrawer()}

      <BottomSheet
        visible={showAddSheet}
        onClose={() => {
          setShowAddSheet(false);
          setNodeName("");
          setSelectedParentId(null);
        }}
        title="Add Concept"
      >
        <ThemedText
          type="small"
          style={[styles.sheetHint, { color: theme.textSecondary }]}
        >
          Add a key concept, term, or idea to expand your knowledge map
        </ThemedText>
        <Input
          placeholder="e.g., Mitochondria, Newton's Laws"
          value={nodeName}
          onChangeText={setNodeName}
          autoFocus
        />
        <Button
          onPress={handleAddNode}
          disabled={!nodeName.trim()}
          size="lg"
          fullWidth
        >
          Add Concept
        </Button>
      </BottomSheet>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
  },
  courseHeader: {
    marginBottom: Spacing.lg,
  },
  courseHeaderContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  courseIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  courseInfo: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  treeContainer: {
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.sm,
    overflow: "hidden",
  },
  nodeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    paddingRight: Spacing.md,
  },
  expandButton: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  expandPlaceholder: {
    width: 24,
  },
  nodeIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.sm,
  },
  nodeContent: {
    flex: 1,
  },
  nodeTitle: {
    marginBottom: 0,
  },
  hintContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: Spacing.xl,
    gap: Spacing.xs,
  },
  hint: {
    textAlign: "center",
  },
  sheetHint: {
    marginBottom: Spacing.md,
  },
  drawerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  drawer: {
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    paddingHorizontal: Spacing.lg,
  },
  drawerHandle: {
    alignItems: "center",
    paddingVertical: Spacing.md,
  },
  handleBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  drawerHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.xl,
  },
  drawerIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.lg,
  },
  drawerTitleSection: {
    flex: 1,
    gap: Spacing.xs,
  },
  drawerTitle: {
    marginTop: Spacing.xs,
  },
  drawerStats: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  statBox: {
    flex: 1,
    alignItems: "center",
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    gap: Spacing.xs,
  },
  drawerActions: {
    gap: Spacing.md,
  },
  quickActionRow: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  drawerQuickAction: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    gap: Spacing.sm,
  },
});
