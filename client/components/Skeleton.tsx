import React from "react";
import { View, StyleSheet, ViewStyle, DimensionValue } from "react-native";
import Animated, {
  useAnimatedStyle,
  withRepeat,
  withTiming,
  useSharedValue,
} from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing } from "@/constants/theme";

interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export function Skeleton({
  width = "100%",
  height = 20,
  borderRadius = BorderRadius.md,
  style,
}: SkeletonProps) {
  const { theme } = useTheme();
  const opacity = useSharedValue(0.3);

  React.useEffect(() => {
    opacity.value = withRepeat(withTiming(0.7, { duration: 1000 }), -1, true);
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        styles.skeleton,
        { width, height, borderRadius, backgroundColor: theme.textSecondary },
        animatedStyle,
        style,
      ]}
    />
  );
}

interface SkeletonListProps {
  count?: number;
  itemHeight?: number;
  spacing?: number;
}

export function SkeletonList({
  count = 3,
  itemHeight = 72,
  spacing = Spacing.md,
}: SkeletonListProps) {
  return (
    <View style={styles.list}>
      {Array.from({ length: count }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.listItem,
            { marginBottom: i < count - 1 ? spacing : 0 },
          ]}
        >
          <Skeleton width={48} height={48} borderRadius={BorderRadius.lg} />
          <View style={styles.listItemContent}>
            <Skeleton width="70%" height={16} style={{ marginBottom: 8 }} />
            <Skeleton width="40%" height={12} />
          </View>
        </View>
      ))}
    </View>
  );
}

interface SkeletonCardProps {
  height?: number;
}

export function SkeletonCard({ height = 120 }: SkeletonCardProps) {
  const { theme } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundSecondary }]}>
      <Skeleton width="60%" height={20} style={{ marginBottom: 12 }} />
      <Skeleton width="90%" height={14} style={{ marginBottom: 8 }} />
      <Skeleton width="40%" height={14} />
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: "#E0E0E0",
  },
  list: {
    paddingHorizontal: Spacing.xl,
  },
  listItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  listItemContent: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  card: {
    padding: Spacing.xl,
    borderRadius: BorderRadius["2xl"],
    marginHorizontal: Spacing.xl,
    marginBottom: Spacing.md,
  },
});
