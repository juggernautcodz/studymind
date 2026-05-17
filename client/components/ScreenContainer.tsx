import React, { ReactNode } from "react";
import {
  View,
  ScrollView,
  StyleSheet,
  ViewStyle,
  StyleProp,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";

interface ScreenContainerProps {
  children: ReactNode;
  scrollable?: boolean;
  padded?: boolean;
  headerMode?: "transparent" | "opaque" | "none";
  hasTabBar?: boolean;
  tabBarHeight?: number;
  refreshing?: boolean;
  onRefresh?: () => void;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

export function ScreenContainer({
  children,
  scrollable = false,
  padded = true,
  headerMode = "transparent",
  hasTabBar = false,
  tabBarHeight = 0,
  refreshing = false,
  onRefresh,
  style,
  contentContainerStyle,
  testID,
}: ScreenContainerProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();

  const topPadding = (() => {
    switch (headerMode) {
      case "transparent":
        return headerHeight + Spacing.md;
      case "opaque":
        return Spacing.md;
      case "none":
        return insets.top + Spacing.md;
    }
  })();

  const bottomPadding = hasTabBar
    ? tabBarHeight + Spacing.lg
    : insets.bottom + Spacing.lg;

  const horizontalPadding = padded ? Spacing.xl : 0;

  if (scrollable) {
    return (
      <ScrollView
        style={[styles.root, { backgroundColor: theme.backgroundRoot }, style]}
        contentContainerStyle={[
          {
            paddingTop: topPadding,
            paddingBottom: bottomPadding,
            paddingHorizontal: horizontalPadding,
          },
          contentContainerStyle,
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.link}
              progressViewOffset={topPadding}
            />
          ) : undefined
        }
        testID={testID}
      >
        {children}
      </ScrollView>
    );
  }

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: theme.backgroundRoot,
          paddingTop: topPadding,
          paddingBottom: bottomPadding,
          paddingHorizontal: horizontalPadding,
        },
        style,
      ]}
      testID={testID}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
