import React, { useCallback, useEffect } from "react";
import {
  View,
  StyleSheet,
  Modal,
  Pressable,
  Dimensions,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const MAX_TRANSLATE_Y = -SCREEN_HEIGHT * 0.95;

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  snapPoints?: number[];
}

export function BottomSheet({
  visible,
  onClose,
  title,
  children,
  snapPoints = [0.85],
}: BottomSheetProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(0);
  const context = useSharedValue({ y: 0 });
  const active = useSharedValue(false);

  const defaultSnapPoint = -SCREEN_HEIGHT * snapPoints[0];

  useEffect(() => {
    if (visible) {
      translateY.value = withSpring(defaultSnapPoint, {
        damping: 20,
        stiffness: 150,
      });
      active.value = true;
    } else {
      translateY.value = withTiming(0, { duration: 200 });
      active.value = false;
    }
  }, [visible, defaultSnapPoint]);

  const scrollTo = useCallback((destination: number) => {
    "worklet";
    translateY.value = withSpring(destination, {
      damping: 20,
      stiffness: 150,
    });
  }, []);

  const closeSheet = useCallback(() => {
    onClose();
  }, [onClose]);

  const gesture = Gesture.Pan()
    .onStart(() => {
      context.value = { y: translateY.value };
    })
    .onUpdate((event) => {
      translateY.value = event.translationY + context.value.y;
      translateY.value = Math.max(translateY.value, MAX_TRANSLATE_Y);
    })
    .onEnd((event) => {
      if (translateY.value > -SCREEN_HEIGHT / 4 || event.velocityY > 500) {
        scrollTo(0);
        runOnJS(closeSheet)();
      } else {
        scrollTo(defaultSnapPoint);
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: active.value
      ? withTiming(1, { duration: 200 })
      : withTiming(0, { duration: 200 }),
  }));

  if (!visible && translateY.value === 0) {
    return null;
  }

  return (
    <Modal transparent visible={visible} animationType="none">
      <KeyboardAvoidingView
        style={styles.modalRoot}
        behavior="padding"
        keyboardVerticalOffset={0}
      >
        <Animated.View
          style={[
            styles.backdrop,
            { backgroundColor: "rgba(0,0,0,0.5)" },
            backdropStyle,
          ]}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>
        <GestureDetector gesture={gesture}>
          <Animated.View
            style={[
              styles.container,
              {
                backgroundColor: theme.backgroundDefault,
                paddingBottom: insets.bottom + Spacing.lg,
              },
              animatedStyle,
            ]}
          >
            <View style={styles.handleContainer}>
              <View
                style={[styles.handle, { backgroundColor: theme.border }]}
              />
            </View>
            {title ? (
              <View style={styles.header}>
                <ThemedText type="h3">{title}</ThemedText>
              </View>
            ) : null}
            <ScrollView
              style={styles.content}
              contentContainerStyle={styles.contentInner}
              keyboardShouldPersistTaps="handled"
              bounces={false}
            >
              {children}
            </ScrollView>
          </Animated.View>
        </GestureDetector>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  container: {
    height: SCREEN_HEIGHT,
    width: "100%",
    position: "absolute",
    top: SCREEN_HEIGHT,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
  },
  handleContainer: {
    alignItems: "center",
    paddingVertical: Spacing.md,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  header: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(128,128,128,0.2)",
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
  },
  contentInner: {
    paddingBottom: Spacing.xl,
  },
});
