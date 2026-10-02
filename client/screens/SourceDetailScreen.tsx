import React from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { Image } from "expo-image";
import { useHeaderHeight } from "@react-navigation/elements";
import { useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card } from "@/components/Card";
import { ErrorState } from "@/components/ErrorState";
import { Icon } from "@/components/Icon";
import { LoadingState } from "@/components/LoadingState";
import { SectionHeader } from "@/components/SectionHeader";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { BorderRadius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/useTheme";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import {
  sourceOriginalImageUrl,
  useSourceDetail,
} from "@/lib/sourceLock";
import { getAuthHeaders } from "@/lib/query-client";

const MAX_IMAGE_PREVIEW_SCALE = 4;

function clampPreviewTranslation(value: number, limit: number) {
  "worklet";
  return Math.min(Math.max(value, -limit), limit);
}

function sourceKindLabel(kind: string) {
  return kind
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString();
}

function safeImageErrorDiagnostic(error: string): string {
  const status = error.match(
    /\b(?:http(?:\s+status)?|status(?:\s+code)?)\D{0,8}(\d{3})\b/i,
  )?.[1];
  if (status) return `HTTP ${status}`;

  const summary = error
    .split(/\r?\n/, 1)[0]
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(?:https?|file):\/\/[^\s"'<>]+/gi, "[url]")
    .replace(/\boriginal-images\/[^\s"'<>]+/gi, "[object-key]")
    .replace(/\s+/g, " ")
    .trim();

  return summary.slice(0, 300) || "Image load failed";
}

export default function SourceDetailScreen() {
  const route = useRoute<RouteProp<RootStackParamList, "SourceDetail">>();
  const { courseId, sourceId } = route.params;
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const { data: source, isLoading, error, refetch } = useSourceDetail(
    courseId,
    sourceId,
  );
  const [imageHeaders, setImageHeaders] = React.useState<
    Record<string, string> | null
  >(null);
  const [isImageLoading, setIsImageLoading] = React.useState(false);
  const [imageFailed, setImageFailed] = React.useState(false);
  const [isImagePreviewVisible, setIsImagePreviewVisible] =
    React.useState(false);

  const imageUrl = React.useMemo(
    () =>
      source?.whiteboardImageId
        ? sourceOriginalImageUrl(courseId, sourceId)
        : null,
    [courseId, source?.whiteboardImageId, sourceId],
  );

  React.useEffect(() => {
    let active = true;

    if (!imageUrl) {
      setImageHeaders(null);
      setIsImageLoading(false);
      setImageFailed(false);
      return () => {
        active = false;
      };
    }

    setImageHeaders(null);
    setIsImageLoading(true);
    setImageFailed(false);
    void getAuthHeaders()
      .then((headers) => {
        if (!active) return;
        if (!headers.Authorization) {
          setImageFailed(true);
          setIsImageLoading(false);
          return;
        }
        setImageHeaders(headers);
      })
      .catch(() => {
        if (!active) return;
        setImageFailed(true);
        setIsImageLoading(false);
      });

    return () => {
      active = false;
    };
  }, [imageUrl]);

  if (isLoading) {
    return <LoadingState fullScreen message="Loading source..." />;
  }

  if (error || !source) {
    return (
      <ThemedView style={styles.errorContainer}>
        <ErrorState
          title="Source unavailable"
          message="We couldn't load this source. Check your connection and try again."
          onRetry={() => void refetch()}
        />
      </ThemedView>
    );
  }

  const revision = source.revisions[0];
  const segments = revision
    ? revision.segments.slice().sort((a, b) => a.position - b.position)
    : [];

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: headerHeight + Spacing.md },
        ]}
      >
        <ThemedText type="h2">{source.title}</ThemedText>
        <ThemedText type="body" style={{ color: theme.textSecondary }}>
          {sourceKindLabel(source.kind)}
        </ThemedText>

        <SectionHeader title="Source details" icon="file-text" />
        <Card style={styles.card}>
          <DetailRow label="Created" value={formatDate(source.createdAt)} />
          <DetailRow label="Updated" value={formatDate(source.updatedAt)} />
          <DetailRow label="Revision" value={`${source.currentRevision}`} />
          {source.topicId ? (
            <DetailRow label="Topic" value="Linked to a course topic" />
          ) : null}
        </Card>

        {source.whiteboardImageId ? (
          <>
            <SectionHeader title="Original image" icon="image" />
            <Card style={styles.card}>
              {imageFailed ? (
                <ImageUnavailable />
              ) : (
                <View style={styles.imageContainer}>
                  {isImageLoading ? (
                    <View style={styles.imageLoading}>
                      <ActivityIndicator size="small" color={theme.link} />
                      <ThemedText
                        type="small"
                        style={{ color: theme.textSecondary, marginTop: Spacing.sm }}
                      >
                        Loading original image...
                      </ThemedText>
                    </View>
                  ) : null}
                  {imageUrl && imageHeaders ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Open original source image full screen"
                      onPress={() => setIsImagePreviewVisible(true)}
                    >
                      <Image
                        source={{ uri: imageUrl, headers: imageHeaders }}
                        style={styles.image}
                        contentFit="contain"
                        onLoadStart={() => setIsImageLoading(true)}
                        onLoadEnd={() => setIsImageLoading(false)}
                        onError={({ error }) => {
                          console.warn(
                            "[SourceDetail image error]",
                            safeImageErrorDiagnostic(error),
                          );
                          setImageFailed(true);
                          setIsImageLoading(false);
                        }}
                        accessibilityLabel="Original source image"
                      />
                    </Pressable>
                  ) : null}
                </View>
              )}
            </Card>
          </>
        ) : null}

        <SectionHeader
          title="Source text"
          subtitle={revision ? `Revision ${revision.revision}` : undefined}
          icon="layers"
        />
        {segments.length > 0 ? (
          segments.map((segment) => (
            <Card key={segment.id} style={styles.segmentCard}>
              {segment.locatorLabel ? (
                <ThemedText
                  type="caption"
                  style={{ color: theme.textSecondary, marginBottom: Spacing.xs }}
                >
                  {segment.locatorLabel}
                </ThemedText>
              ) : null}
              <ThemedText type="body">{segment.content}</ThemedText>
            </Card>
          ))
        ) : (
          <Card style={styles.card}>
            <ThemedText type="body" style={{ color: theme.textSecondary }}>
              No source text is available for this revision.
            </ThemedText>
          </Card>
        )}
      </ScrollView>
      <ZoomableImagePreview
        visible={isImagePreviewVisible}
        imageUrl={imageUrl}
        imageHeaders={imageHeaders}
        onClose={() => setIsImagePreviewVisible(false)}
      />
    </ThemedView>
  );
}

function ZoomableImagePreview({
  visible,
  imageUrl,
  imageHeaders,
  onClose,
}: {
  visible: boolean;
  imageUrl: string | null;
  imageHeaders: Record<string, string> | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width: previewWidth, height: windowHeight } = useWindowDimensions();
  const previewHeight = windowHeight * 0.8;
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translationX = useSharedValue(0);
  const translationY = useSharedValue(0);
  const savedTranslationX = useSharedValue(0);
  const savedTranslationY = useSharedValue(0);

  const resetTransform = React.useCallback(() => {
    scale.value = 1;
    savedScale.value = 1;
    translationX.value = 0;
    translationY.value = 0;
    savedTranslationX.value = 0;
    savedTranslationY.value = 0;
  }, [
    savedScale,
    savedTranslationX,
    savedTranslationY,
    scale,
    translationX,
    translationY,
  ]);

  React.useEffect(() => {
    resetTransform();
  }, [resetTransform, visible]);

  const closePreview = React.useCallback(() => {
    resetTransform();
    onClose();
  }, [onClose, resetTransform]);

  const pinchGesture = React.useMemo(
    () =>
      Gesture.Pinch()
        .onUpdate((event) => {
          const nextScale = Math.min(
            Math.max(savedScale.value * event.scale, 1),
            MAX_IMAGE_PREVIEW_SCALE,
          );
          const horizontalLimit = (previewWidth * (nextScale - 1)) / 2;
          const verticalLimit = (previewHeight * (nextScale - 1)) / 2;

          scale.value = nextScale;
          translationX.value = clampPreviewTranslation(
            translationX.value,
            horizontalLimit,
          );
          translationY.value = clampPreviewTranslation(
            translationY.value,
            verticalLimit,
          );
        })
        .onFinalize(() => {
          savedScale.value = scale.value;
          savedTranslationX.value = translationX.value;
          savedTranslationY.value = translationY.value;
        }),
    [
      previewHeight,
      previewWidth,
      savedScale,
      savedTranslationX,
      savedTranslationY,
      scale,
      translationX,
      translationY,
    ],
  );

  const panGesture = React.useMemo(
    () =>
      Gesture.Pan()
        .onUpdate((event) => {
          if (scale.value <= 1) {
            translationX.value = 0;
            translationY.value = 0;
            return;
          }

          const horizontalLimit = (previewWidth * (scale.value - 1)) / 2;
          const verticalLimit = (previewHeight * (scale.value - 1)) / 2;

          translationX.value = clampPreviewTranslation(
            savedTranslationX.value + event.translationX,
            horizontalLimit,
          );
          translationY.value = clampPreviewTranslation(
            savedTranslationY.value + event.translationY,
            verticalLimit,
          );
        })
        .onFinalize(() => {
          savedTranslationX.value = translationX.value;
          savedTranslationY.value = translationY.value;
        }),
    [
      previewHeight,
      previewWidth,
      savedTranslationX,
      savedTranslationY,
      scale,
      translationX,
      translationY,
    ],
  );

  const previewGesture = React.useMemo(
    () => Gesture.Simultaneous(pinchGesture, panGesture),
    [panGesture, pinchGesture],
  );

  const animatedImageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translationX.value },
      { translateY: translationY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={closePreview}
    >
      <GestureHandlerRootView style={styles.imagePreviewRoot}>
        <View style={styles.imagePreviewOverlay} accessibilityViewIsModal>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={closePreview}
            accessible={false}
          />
          {imageUrl && imageHeaders ? (
            <GestureDetector gesture={previewGesture}>
              <Animated.View
                style={[styles.imagePreviewGestureArea, animatedImageStyle]}
              >
                <Image
                  source={{ uri: imageUrl, headers: imageHeaders }}
                  style={styles.imagePreview}
                  contentFit="contain"
                  accessibilityLabel="Original source image, full screen"
                />
              </Animated.View>
            </GestureDetector>
          ) : null}
          <Pressable
            style={[
              styles.imagePreviewCloseButton,
              {
                top: insets.top + Spacing.md,
                backgroundColor: "rgba(0,0,0,0.6)",
              },
            ]}
            onPress={closePreview}
            accessibilityRole="button"
            accessibilityLabel="Close full screen image"
            hitSlop={Spacing.sm}
          >
            <Icon name="x" size={24} color="#fff" />
          </Pressable>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const { theme } = useTheme();

  return (
    <View style={styles.detailRow}>
      <ThemedText type="small" style={{ color: theme.textSecondary }}>
        {label}
      </ThemedText>
      <ThemedText type="small" style={styles.detailValue}>
        {value}
      </ThemedText>
    </View>
  );
}

function ImageUnavailable() {
  const { theme } = useTheme();

  return (
    <View style={styles.imageUnavailable} accessibilityRole="alert">
      <Icon name="image" size={28} color={theme.textSecondary} />
      <ThemedText type="body" style={{ marginTop: Spacing.sm }}>
        Original image unavailable
      </ThemedText>
      <ThemedText
        type="small"
        style={{ color: theme.textSecondary, marginTop: Spacing.xs }}
      >
        This image may be missing or unsupported on this device.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  errorContainer: { flex: 1, paddingTop: Spacing["4xl"] },
  content: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing["4xl"] },
  card: { marginBottom: Spacing.md },
  segmentCard: { marginBottom: Spacing.sm, borderRadius: BorderRadius.md },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.xs,
  },
  detailValue: { flex: 1, marginLeft: Spacing.lg, textAlign: "right" },
  imageContainer: { minHeight: 180, justifyContent: "center" },
  image: { width: "100%", height: 280 },
  imagePreviewOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
    justifyContent: "center",
    alignItems: "center",
  },
  imagePreviewRoot: { flex: 1 },
  imagePreviewGestureArea: { width: "100%", height: "80%" },
  imagePreview: { width: "100%", height: "100%" },
  imagePreviewCloseButton: {
    position: "absolute",
    right: Spacing.lg,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  imageLoading: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 180,
  },
  imageUnavailable: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 180,
  },
});
