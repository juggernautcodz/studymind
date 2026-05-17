import React, { useState, useEffect } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
  Switch,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useNavigation } from "@react-navigation/native";
import { Icon } from "@/components/Icon";
import * as Haptics from "expo-haptics";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { ListItem } from "@/components/ListItem";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { BottomSheet } from "@/components/BottomSheet";
import { ProgressBar } from "@/components/ProgressBar";
import { SectionHeader } from "@/components/SectionHeader";
import { useTheme } from "@/hooks/useTheme";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/contexts/AuthContext";
import { useBilling } from "@/contexts/BillingContext";
import { useLanguage, SUPPORTED_LANGUAGES } from "@/contexts/LanguageContext";
import { storage } from "@/lib/storage";
import { Spacing, BorderRadius } from "@/constants/theme";
import type { UsageStats } from "@/types";
import { PLAN_LIMITS } from "@/types";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

export default function SettingsScreen() {
  const { theme } = useTheme();
  const { showToast } = useToast();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const { user, logout, deleteAccount } = useAuth();
  const { devModePro, setDevModePro } = useBilling();
  const { language } = useLanguage();

  const currentLanguage = SUPPORTED_LANGUAGES.find((l) => l.code === language);

  const [usageStats, setUsageStats] = useState<UsageStats>({
    transcriptionMinutesUsed: 0,
    storageBytesUsed: 0,
    recordingsCountThisMonth: 0,
  });
  const [showLogoutSheet, setShowLogoutSheet] = useState(false);
  const [showClearDataSheet, setShowClearDataSheet] = useState(false);
  const [showDeleteAccountSheet, setShowDeleteAccountSheet] = useState(false);
  const [showDeleteAccountConfirmSheet, setShowDeleteAccountConfirmSheet] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [showImportSheet, setShowImportSheet] = useState(false);
  const [pendingImport, setPendingImport] = useState<{ data: unknown; noteCount: number } | null>(null);

  useEffect(() => {
    loadUsageStats();
  }, []);

  const loadUsageStats = async () => {
    const stats = await storage.getUsageStats();
    setUsageStats(stats);
  };

  const handleLogout = () => {
    setShowLogoutSheet(true);
  };

  const confirmLogout = async () => {
    setShowLogoutSheet(false);
    await logout();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleClearData = () => {
    setShowClearDataSheet(true);
  };

  const confirmClearData = async () => {
    setShowClearDataSheet(false);
    await storage.clearAll();
    await logout();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleExportNotes = async () => {
    try {
      setIsExporting(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const json = await storage.exportAllNotes();
      const filename = `studymind_backup_${new Date().toISOString().slice(0, 10)}.json`;
      const path = `${FileSystem.documentDirectory}${filename}`;
      await FileSystem.writeAsStringAsync(path, json, { encoding: FileSystem.EncodingType.UTF8 });
      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        await Sharing.shareAsync(path, { mimeType: "application/json", dialogTitle: "Export StudyMind Backup" });
      } else {
        showToast({ type: "info", title: "Saved", message: `Backup saved as ${filename}` });
      }
    } catch {
      showToast({ type: "error", title: "Export failed", message: "Could not create backup file" });
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportNotes = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: "application/json", copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.[0]) return;
      const content = await FileSystem.readAsStringAsync(result.assets[0].uri);
      const data = JSON.parse(content);
      if (!data || typeof data !== "object" || !Array.isArray((data as any).notes)) {
        showToast({ type: "error", title: "Invalid file", message: "This doesn't look like a StudyMind backup" });
        return;
      }
      setPendingImport({ data, noteCount: (data as any).notes.length });
      setShowImportSheet(true);
    } catch {
      showToast({ type: "error", title: "Import failed", message: "Could not read the backup file" });
    }
  };

  const confirmImport = async () => {
    if (!pendingImport) return;
    setShowImportSheet(false);
    try {
      setIsImporting(true);
      const result = await storage.importNotes(pendingImport.data);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({
        type: "success",
        title: "Import complete",
        message: `${result.imported} note${result.imported !== 1 ? "s" : ""} imported, ${result.skipped} skipped`,
      });
    } catch {
      showToast({ type: "error", title: "Import failed", message: "Could not import backup" });
    } finally {
      setIsImporting(false);
      setPendingImport(null);
    }
  };

  const handleDeleteAccount = () => {
    setShowDeleteAccountSheet(true);
  };

  const confirmDeleteAccountStep1 = () => {
    setShowDeleteAccountSheet(false);
    setShowDeleteAccountConfirmSheet(true);
  };

  const confirmDeleteAccountStep2 = async () => {
    setShowDeleteAccountConfirmSheet(false);
    await deleteAccount();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const planLimits = user ? PLAN_LIMITS[user.plan] : PLAN_LIMITS.FREE;
  const recordingsPercent =
    (usageStats.recordingsCountThisMonth / planLimits.recordings) * 100;
  const minutesPercent =
    (usageStats.transcriptionMinutesUsed / planLimits.transcriptionMinutes) *
    100;

  const getPlanColor = () => {
    switch (user?.plan) {
      case "PRO":
        return theme.success;
      case "BASE":
        return theme.info;
      default:
        return theme.textSecondary;
    }
  };

  const getPlanBadgeVariant = () => {
    switch (user?.plan) {
      case "PRO":
        return "success";
      case "BASE":
        return "info";
      default:
        return "default";
    }
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: headerHeight + Spacing.lg,
            paddingBottom: tabBarHeight + Spacing.xl,
          },
        ]}
        scrollIndicatorInsets={{ bottom: insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        {/* Premium profile card */}
        <View
          style={[
            styles.profileCard,
            {
              backgroundColor: "#7C3AED15",
              borderColor: "#7C3AED30",
              borderWidth: 1,
              borderRadius: 16,
              shadowColor: "#7C3AED",
              shadowOpacity: 0.15,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 4 },
              elevation: 4,
              marginBottom: Spacing.lg,
              padding: Spacing.lg,
            },
          ]}
        >
          <View style={styles.profileSection}>
            <View
              style={[
                styles.avatarContainer,
                { backgroundColor: "#7C3AED25" },
              ]}
            >
              <Icon name="user" size={32} color="#9F67FF" />
            </View>
            <View style={styles.profileInfo}>
              <ThemedText type="h3" style={{ color: theme.text }}>{user?.name || "Student"}</ThemedText>
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                {user?.email || "Guest User"}
              </ThemedText>
            </View>
            <Badge
              label={user?.plan || "FREE"}
              variant={getPlanBadgeVariant()}
            />
          </View>
        </View>

        <Card style={styles.usageCard}>
          <SectionHeader title="Monthly Usage" icon="bar-chart-2" />

          <View style={styles.usageItem}>
            <View style={styles.usageHeader}>
              <View style={styles.usageLabel}>
                <Icon name="mic" size={16} color={theme.link} />
                <ThemedText type="body" style={styles.usageLabelText}>
                  Recordings
                </ThemedText>
              </View>
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                {usageStats.recordingsCountThisMonth} /{" "}
                {planLimits.recordings === 999
                  ? "Unlimited"
                  : planLimits.recordings}
              </ThemedText>
            </View>
            <ProgressBar
              progress={Math.min(recordingsPercent, 100)}
              color={recordingsPercent > 80 ? theme.warning : theme.link}
            />
          </View>

          <View style={styles.usageItem}>
            <View style={styles.usageHeader}>
              <View style={styles.usageLabel}>
                <Icon name="clock" size={16} color={theme.info} />
                <ThemedText type="body" style={styles.usageLabelText}>
                  Transcription Minutes
                </ThemedText>
              </View>
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                {usageStats.transcriptionMinutesUsed} /{" "}
                {planLimits.transcriptionMinutes === 999
                  ? "Unlimited"
                  : planLimits.transcriptionMinutes}
              </ThemedText>
            </View>
            <ProgressBar
              progress={Math.min(minutesPercent, 100)}
              color={minutesPercent > 80 ? theme.warning : theme.info}
            />
          </View>
        </Card>

        {user?.plan === "FREE" ? (
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              navigation.navigate("Billing");
            }}
            style={[
              styles.upgradeCard,
              {
                backgroundColor: "#7C3AED15",
                borderColor: "#7C3AED50",
                shadowColor: "#7C3AED",
                shadowOpacity: 0.2,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 4 },
                elevation: 4,
              },
            ]}
          >
            <View
              style={[
                styles.upgradeIcon,
                { backgroundColor: "#7C3AED25" },
              ]}
            >
              <Icon name="zap" size={20} color="#9F67FF" />
            </View>
            <View style={styles.upgradeText}>
              <ThemedText type="h4" style={{ color: "#9F67FF" }}>
                Upgrade to Pro
              </ThemedText>
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                Unlock unlimited recordings and all features
              </ThemedText>
            </View>
            <Icon name="chevron-right" size={20} color="#9F67FF" />
          </Pressable>
        ) : null}

        <View style={styles.menuSection}>
          <ThemedText
            type="caption"
            style={[styles.menuHeader, { color: theme.textSecondary }]}
          >
            ACCOUNT
          </ThemedText>
          <Card style={styles.menuCard}>
            <ListItem
              title="Subscription"
              subtitle="Manage your plan"
              leftIcon="credit-card"
              onPress={() => {
                Haptics.selectionAsync();
                navigation.navigate("Billing");
              }}
            />
            <View
              style={[styles.listDivider, { backgroundColor: theme.border }]}
            />
            <ListItem
              title="Notifications"
              subtitle="Study reminders and alerts"
              leftIcon="bell"
              onPress={() => {
                Haptics.selectionAsync();
                navigation.navigate("NotificationSettings");
              }}
            />
            <View
              style={[styles.listDivider, { backgroundColor: theme.border }]}
            />
            <ListItem
              title="Language"
              subtitle={currentLanguage?.nativeName || "English"}
              leftIcon="globe"
              onPress={() => {
                Haptics.selectionAsync();
                navigation.navigate("Language");
              }}
            />
          </Card>
        </View>

        <View style={styles.menuSection}>
          <ThemedText
            type="caption"
            style={[styles.menuHeader, { color: theme.textSecondary }]}
          >
            DATA
          </ThemedText>
          <Card style={styles.menuCard}>
            <ListItem
              title={isExporting ? "Exporting..." : "Export Notes"}
              subtitle="Save a backup of all your notes and study data"
              leftIcon="download"
              leftIconColor={theme.link}
              onPress={handleExportNotes}
              disabled={isExporting || isImporting}
            />
            <View
              style={[styles.listDivider, { backgroundColor: theme.border }]}
            />
            <ListItem
              title={isImporting ? "Importing..." : "Import Backup"}
              subtitle="Restore notes from a previously exported backup"
              leftIcon="upload"
              leftIconColor={theme.link}
              onPress={handleImportNotes}
              disabled={isExporting || isImporting}
            />
            <View
              style={[styles.listDivider, { backgroundColor: theme.border }]}
            />
            <ListItem
              title="Clear All Data"
              subtitle="Remove all study data from this device"
              leftIcon="trash-2"
              leftIconColor={theme.error}
              onPress={handleClearData}
            />
            <View
              style={[styles.listDivider, { backgroundColor: theme.border }]}
            />
            <ListItem
              title="Delete Account"
              subtitle="Permanently delete your account and all data"
              leftIcon="user-x"
              leftIconColor={theme.error}
              onPress={handleDeleteAccount}
              testID="button-delete-account"
            />
          </Card>
        </View>

        <View style={styles.menuSection}>
          <ThemedText
            type="caption"
            style={[styles.menuHeader, { color: theme.textSecondary }]}
          >
            SUPPORT
          </ThemedText>
          <Card style={styles.menuCard}>
            <ListItem
              title="Help & FAQ"
              subtitle="Learn how to use the app"
              leftIcon="help-circle"
              onPress={() => {
                Haptics.selectionAsync();
                navigation.navigate("Help");
              }}
            />
            <View
              style={[styles.listDivider, { backgroundColor: theme.border }]}
            />
            <ListItem
              title="Privacy & Data"
              subtitle="Privacy policy, data controls, support"
              leftIcon="shield"
              onPress={() => {
                Haptics.selectionAsync();
                navigation.navigate("Privacy");
              }}
            />
          </Card>
        </View>

        {__DEV__ ? (
          <View style={styles.menuSection}>
            <ThemedText
              type="caption"
              style={[styles.menuHeader, { color: theme.textSecondary }]}
            >
              DEVELOPER
            </ThemedText>
            <Card style={styles.menuCard}>
              <View style={styles.devModeRow}>
                <View style={styles.devModeInfo}>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: Spacing.sm,
                    }}
                  >
                    <Icon name="unlock" size={18} color={theme.warning} />
                    <ThemedText type="body" style={{ fontWeight: "600" }}>
                      Dev Mode (PRO)
                    </ThemedText>
                  </View>
                  <ThemedText
                    type="small"
                    style={{ color: theme.textSecondary, marginTop: 2 }}
                  >
                    Unlock all PRO features for testing
                  </ThemedText>
                </View>
                <Switch
                  value={devModePro}
                  onValueChange={(val) => {
                    Haptics.selectionAsync();
                    setDevModePro(val);
                  }}
                  trackColor={{
                    false: theme.textSecondary + "30",
                    true: theme.warning + "60",
                  }}
                  thumbColor={devModePro ? theme.warning : theme.textSecondary}
                  accessibilityLabel="Toggle developer mode"
                  accessibilityRole="switch"
                />
              </View>
            </Card>
          </View>
        ) : null}

        <Button
          onPress={handleLogout}
          variant="destructive"
          size="lg"
          fullWidth
          style={styles.logoutButton}
        >
          Log Out
        </Button>

        <ThemedText
          type="caption"
          style={[styles.version, { color: theme.textSecondary }]}
        >
          StudyMind v1.0.0
        </ThemedText>
      </ScrollView>

      <BottomSheet
        visible={showLogoutSheet}
        onClose={() => setShowLogoutSheet(false)}
        title="Log Out"
      >
        <ThemedText type="body" style={{ color: theme.textSecondary, marginBottom: Spacing.lg }}>
          Are you sure you want to log out?
        </ThemedText>
        <Button
          variant="destructive"
          fullWidth
          onPress={confirmLogout}
        >
          Log Out
        </Button>
        <Button
          variant="ghost"
          fullWidth
          onPress={() => setShowLogoutSheet(false)}
          style={{ marginTop: Spacing.sm }}
        >
          Cancel
        </Button>
      </BottomSheet>

      <BottomSheet
        visible={showClearDataSheet}
        onClose={() => setShowClearDataSheet(false)}
        title="Clear All Data"
      >
        <ThemedText type="body" style={{ color: theme.textSecondary, marginBottom: Spacing.lg }}>
          This will delete all study data stored on this device, including semesters, courses, topics, notes, flashcards, and quizzes. Data stored on the server will not be affected. This action cannot be undone.
        </ThemedText>
        <Button
          variant="destructive"
          fullWidth
          onPress={confirmClearData}
        >
          Clear Data
        </Button>
        <Button
          variant="ghost"
          fullWidth
          onPress={() => setShowClearDataSheet(false)}
          style={{ marginTop: Spacing.sm }}
        >
          Cancel
        </Button>
      </BottomSheet>

      <BottomSheet
        visible={showDeleteAccountSheet}
        onClose={() => setShowDeleteAccountSheet(false)}
        title="Delete Account"
      >
        <ThemedText type="body" style={{ color: theme.textSecondary, marginBottom: Spacing.lg }}>
          This will permanently delete your account and ALL your data from both the server and this device, including semesters, courses, topics, notes, flashcards, quizzes, and purchase history. This cannot be undone.
        </ThemedText>
        <Button
          variant="destructive"
          fullWidth
          onPress={confirmDeleteAccountStep1}
        >
          Delete Account
        </Button>
        <Button
          variant="ghost"
          fullWidth
          onPress={() => setShowDeleteAccountSheet(false)}
          style={{ marginTop: Spacing.sm }}
        >
          Cancel
        </Button>
      </BottomSheet>

      <BottomSheet
        visible={showImportSheet}
        onClose={() => { setShowImportSheet(false); setPendingImport(null); }}
        title="Import Backup?"
      >
        <ThemedText type="body" style={{ color: theme.textSecondary, marginBottom: Spacing.lg }}>
          {pendingImport
            ? `Found ${pendingImport.noteCount} note${pendingImport.noteCount !== 1 ? "s" : ""} in this backup. Notes for topics that already have notes will be skipped — existing data will not be overwritten.`
            : ""}
        </ThemedText>
        <Button
          variant="primary"
          fullWidth
          onPress={confirmImport}
        >
          Import Notes
        </Button>
        <Button
          variant="ghost"
          fullWidth
          onPress={() => { setShowImportSheet(false); setPendingImport(null); }}
          style={{ marginTop: Spacing.sm }}
        >
          Cancel
        </Button>
      </BottomSheet>

      <BottomSheet
        visible={showDeleteAccountConfirmSheet}
        onClose={() => setShowDeleteAccountConfirmSheet(false)}
        title="Are you absolutely sure?"
      >
        <ThemedText type="body" style={{ color: theme.textSecondary, marginBottom: Spacing.lg }}>
          This is permanent and irreversible. Your account and all study materials will be deleted from both the server and this device.
        </ThemedText>
        <Button
          variant="destructive"
          fullWidth
          onPress={confirmDeleteAccountStep2}
        >
          Yes, Delete Everything
        </Button>
        <Button
          variant="ghost"
          fullWidth
          onPress={() => setShowDeleteAccountConfirmSheet(false)}
          style={{ marginTop: Spacing.sm }}
        >
          Keep Account
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
  profileCard: {
    // styles applied inline
  },
  profileSection: {
    flexDirection: "row",
    alignItems: "center",
  },
  avatarContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  profileInfo: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  usageCard: {
    marginBottom: Spacing.lg,
  },
  usageItem: {
    marginBottom: Spacing.lg,
  },
  usageHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  usageLabel: {
    flexDirection: "row",
    alignItems: "center",
  },
  usageLabelText: {
    marginLeft: Spacing.sm,
  },
  upgradeCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    marginBottom: Spacing.xl,
  },
  upgradeIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  upgradeText: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  menuSection: {
    marginBottom: Spacing.lg,
  },
  menuHeader: {
    marginBottom: Spacing.sm,
    marginLeft: Spacing.sm,
    fontWeight: "600",
    letterSpacing: 1,
  },
  menuCard: {
    padding: 0,
    overflow: "hidden",
  },
  listDivider: {
    height: 1,
    marginHorizontal: Spacing.lg,
  },
  devModeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.lg,
  },
  devModeInfo: {
    flex: 1,
    marginRight: Spacing.md,
  },
  logoutButton: {
    marginTop: Spacing.md,
    marginBottom: Spacing.xl,
  },
  version: {
    textAlign: "center",
    marginBottom: Spacing.lg,
  },
});
