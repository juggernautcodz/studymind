import React from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  useSharedValue,
} from "react-native-reanimated";
import { Icon } from "@/components/Icon";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";

export type StepStatus = "pending" | "active" | "completed" | "error";

export interface ProcessingStep {
  id: string;
  label: string;
  status: StepStatus;
  subtitle?: string;
}

interface ProcessingTimelineProps {
  steps: ProcessingStep[];
  compact?: boolean;
}

function TimelineStep({
  step,
  isLast,
  compact,
}: {
  step: ProcessingStep;
  isLast: boolean;
  compact?: boolean;
}) {
  const { theme } = useTheme();
  const pulseOpacity = useSharedValue(1);

  React.useEffect(() => {
    if (step.status === "active") {
      pulseOpacity.value = withRepeat(
        withSequence(
          withTiming(0.4, { duration: 600 }),
          withTiming(1, { duration: 600 }),
        ),
        -1,
        true,
      );
    }
  }, [step.status]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: step.status === "active" ? pulseOpacity.value : 1,
  }));

  const getIconColor = () => {
    switch (step.status) {
      case "completed":
        return theme.success;
      case "active":
        return theme.info;
      case "error":
        return theme.error;
      default:
        return theme.textSecondary;
    }
  };

  const getIcon = (): string => {
    switch (step.status) {
      case "completed":
        return "check-circle";
      case "active":
        return "loader";
      case "error":
        return "x-circle";
      default:
        return "circle";
    }
  };

  const getBackgroundColor = () => {
    const color = getIconColor();
    return step.status === "pending" ? "transparent" : color + "15";
  };

  const getLineColor = () => {
    if (step.status === "completed") {
      return theme.success;
    }
    return theme.border;
  };

  return (
    <View
      style={[styles.stepContainer, compact && styles.stepContainerCompact]}
    >
      <View style={styles.stepLeft}>
        <Animated.View
          style={[
            styles.iconCircle,
            compact && styles.iconCircleCompact,
            { backgroundColor: getBackgroundColor() },
            pulseStyle,
          ]}
        >
          <Icon
            name={getIcon()}
            size={compact ? 14 : 18}
            color={getIconColor()}
          />
        </Animated.View>
        {!isLast ? (
          <View
            style={[
              styles.line,
              compact && styles.lineCompact,
              { backgroundColor: getLineColor() },
            ]}
          />
        ) : null}
      </View>
      <View style={[styles.stepContent, compact && styles.stepContentCompact]}>
        <ThemedText
          type={compact ? "small" : "body"}
          style={[
            styles.stepLabel,
            step.status === "pending" && { color: theme.textSecondary },
            step.status === "completed" && { color: theme.success },
            step.status === "active" && {
              color: theme.info,
              fontWeight: "600",
            },
            step.status === "error" && { color: theme.error },
          ]}
        >
          {step.label}
        </ThemedText>
        {step.subtitle && !compact ? (
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {step.subtitle}
          </ThemedText>
        ) : null}
      </View>
    </View>
  );
}

export function ProcessingTimeline({
  steps,
  compact = false,
}: ProcessingTimelineProps) {
  return (
    <View style={[styles.container, compact && styles.containerCompact]}>
      {steps.map((step, index) => (
        <TimelineStep
          key={step.id}
          step={step}
          isLast={index === steps.length - 1}
          compact={compact}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: Spacing.md,
  },
  containerCompact: {
    paddingVertical: Spacing.sm,
  },
  stepContainer: {
    flexDirection: "row",
    minHeight: 56,
  },
  stepContainerCompact: {
    minHeight: 32,
  },
  stepLeft: {
    alignItems: "center",
    width: 40,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  iconCircleCompact: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  line: {
    width: 2,
    flex: 1,
    marginVertical: 4,
    borderRadius: 1,
  },
  lineCompact: {
    marginVertical: 2,
  },
  stepContent: {
    flex: 1,
    paddingLeft: Spacing.sm,
    paddingBottom: Spacing.md,
    justifyContent: "center",
  },
  stepContentCompact: {
    paddingBottom: Spacing.xs,
  },
  stepLabel: {},
});
