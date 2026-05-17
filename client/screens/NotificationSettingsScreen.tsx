import React, { useState, useEffect } from "react";
import {
  View,
  StyleSheet,
  Switch,
  ScrollView,
  Pressable,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { Icon } from "@/components/Icon";
import DateTimePicker from "@react-native-community/datetimepicker";

import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import {
  getNotificationSettings,
  saveNotificationSettings,
  registerForPushNotifications,
  sendLocalNotification,
  NotificationSettings,
} from "@/lib/notifications";

export default function NotificationSettingsScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();

  const [settings, setSettings] = useState<NotificationSettings>({
    enabled: false,
    dailyReminder: true,
    dailyReminderTime: "09:00",
    studyStreakReminder: true,
    dueCardsReminder: true,
  });
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const loaded = await getNotificationSettings();
      setSettings(loaded);
    } finally {
      setIsLoading(false);
    }
  };

  const updateSetting = async <K extends keyof NotificationSettings>(
    key: K,
    value: NotificationSettings[K],
  ) => {
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    await saveNotificationSettings(updated);
  };

  const handleEnableNotifications = async () => {
    const token = await registerForPushNotifications();
    if (token) {
      await updateSetting("enabled", true);
    } else {
      if (Platform.OS !== "web") {
        await sendLocalNotification(
          "Notifications Disabled",
          "Please enable notifications in your device settings to receive study reminders.",
        );
      }
    }
  };

  const handleTimeChange = async (event: unknown, selectedDate?: Date) => {
    setShowTimePicker(Platform.OS === "ios");
    if (selectedDate) {
      const hours = selectedDate.getHours().toString().padStart(2, "0");
      const minutes = selectedDate.getMinutes().toString().padStart(2, "0");
      await updateSetting("dailyReminderTime", `${hours}:${minutes}`);
    }
  };

  const getTimeDate = () => {
    const [hours, minutes] = settings.dailyReminderTime.split(":").map(Number);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date;
  };

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(":").map(Number);
    const period = hours >= 12 ? "PM" : "AM";
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes.toString().padStart(2, "0")} ${period}`;
  };

  const testNotification = async () => {
    await sendLocalNotification(
      "Test Notification",
      "Your notifications are working correctly!",
    );
  };

  if (isLoading) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.centered}>
          <ThemedText>Loading...</ThemedText>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: headerHeight + Spacing.lg,
            paddingBottom: insets.bottom + Spacing.xl,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Card style={styles.mainCard}>
          <View style={styles.headerRow}>
            <View style={styles.headerContent}>
              <Icon name="bell" size={24} color={theme.link} />
              <View style={styles.headerText}>
                <ThemedText style={styles.title}>Study Notifications</ThemedText>
                <ThemedText style={[styles.subtitle, { color: theme.textSecondary }]}>
                  Get reminders to keep your study streak going
                </ThemedText>
              </View>
            </View>
            <Switch
              value={settings.enabled}
              onValueChange={(value) =>
                value
                  ? handleEnableNotifications()
                  : updateSetting("enabled", false)
              }
              trackColor={{ false: theme.border, true: theme.link + "80" }}
              thumbColor={settings.enabled ? theme.link : "#f4f4f4"}
            />
          </View>
        </Card>

        {settings.enabled ? (
          <>
            <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary }]}>Reminder Types</ThemedText>

            <Card style={styles.settingsCard}>
              <View style={styles.settingRow}>
                <View style={styles.settingInfo}>
                  <View
                    style={[
                      styles.iconCircle,
                      { backgroundColor: theme.info + "20" },
                    ]}
                  >
                    <Icon name="sun" size={18} color={theme.info} />
                  </View>
                  <View style={styles.settingText}>
                    <ThemedText style={styles.settingTitle}>
                      Daily Study Reminder
                    </ThemedText>
                    <ThemedText style={[styles.settingSubtitle, { color: theme.textSecondary }]}>
                      Get a daily reminder to study
                    </ThemedText>
                  </View>
                </View>
                <Switch
                  value={settings.dailyReminder}
                  onValueChange={(value) =>
                    updateSetting("dailyReminder", value)
                  }
                  trackColor={{ false: theme.border, true: theme.link + "80" }}
                  thumbColor={settings.dailyReminder ? theme.link : "#f4f4f4"}
                />
              </View>

              {settings.dailyReminder ? (
                <Pressable
                  style={[styles.timePickerRow, { backgroundColor: theme.backgroundSecondary }]}
                  onPress={() => setShowTimePicker(true)}
                >
                  <ThemedText style={[styles.timeLabel, { color: theme.textSecondary }]}>
                    Reminder Time
                  </ThemedText>
                  <View style={styles.timeValue}>
                    <ThemedText style={styles.timeText}>
                      {formatTime(settings.dailyReminderTime)}
                    </ThemedText>
                    <Icon
                      name="chevron-right"
                      size={18}
                      color={theme.textSecondary}
                    />
                  </View>
                </Pressable>
              ) : null}

              <View style={[styles.divider, { backgroundColor: theme.border }]} />

              <View style={styles.settingRow}>
                <View style={styles.settingInfo}>
                  <View
                    style={[
                      styles.iconCircle,
                      { backgroundColor: theme.warning + "20" },
                    ]}
                  >
                    <Icon name="zap" size={18} color={theme.warning} />
                  </View>
                  <View style={styles.settingText}>
                    <ThemedText style={styles.settingTitle}>
                      Streak Reminder
                    </ThemedText>
                    <ThemedText style={[styles.settingSubtitle, { color: theme.textSecondary }]}>
                      {"Evening reminder if you haven't studied"}
                    </ThemedText>
                  </View>
                </View>
                <Switch
                  value={settings.studyStreakReminder}
                  onValueChange={(value) =>
                    updateSetting("studyStreakReminder", value)
                  }
                  trackColor={{ false: theme.border, true: theme.link + "80" }}
                  thumbColor={
                    settings.studyStreakReminder ? theme.link : "#f4f4f4"
                  }
                />
              </View>

              <View style={[styles.divider, { backgroundColor: theme.border }]} />

              <View style={styles.settingRow}>
                <View style={styles.settingInfo}>
                  <View
                    style={[
                      styles.iconCircle,
                      { backgroundColor: theme.success + "20" },
                    ]}
                  >
                    <Icon
                      name="layers"
                      size={18}
                      color={theme.success}
                    />
                  </View>
                  <View style={styles.settingText}>
                    <ThemedText style={styles.settingTitle}>
                      Due Cards Reminder
                    </ThemedText>
                    <ThemedText style={[styles.settingSubtitle, { color: theme.textSecondary }]}>
                      Notify when flashcards are due for review
                    </ThemedText>
                  </View>
                </View>
                <Switch
                  value={settings.dueCardsReminder}
                  onValueChange={(value) =>
                    updateSetting("dueCardsReminder", value)
                  }
                  trackColor={{ false: theme.border, true: theme.link + "80" }}
                  thumbColor={
                    settings.dueCardsReminder ? theme.link : "#f4f4f4"
                  }
                />
              </View>
            </Card>

            <Button
              onPress={testNotification}
              variant="secondary"
              style={styles.testButton}
            >
              Send Test Notification
            </Button>
          </>
        ) : null}

        {showTimePicker ? (
          <DateTimePicker
            value={getTimeDate()}
            mode="time"
            is24Hour={false}
            onChange={handleTimeChange}
          />
        ) : null}
      </ScrollView>
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
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  mainCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: Spacing.md,
  },
  headerText: {
    marginLeft: Spacing.md,
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: Spacing.sm,
    marginLeft: Spacing.xs,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  settingsCard: {
    padding: 0,
    marginBottom: Spacing.lg,
    overflow: "hidden",
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.lg,
  },
  settingInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: Spacing.md,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.md,
  },
  settingText: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: "500",
    marginBottom: 2,
  },
  settingSubtitle: {
    fontSize: 13,
  },
  divider: {
    height: 1,
    marginHorizontal: Spacing.lg,
  },
  timePickerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  timeLabel: {
    fontSize: 14,
  },
  timeValue: {
    flexDirection: "row",
    alignItems: "center",
  },
  timeText: {
    fontSize: 14,
    fontWeight: "500",
    marginRight: Spacing.xs,
  },
  testButton: {
    marginTop: Spacing.sm,
  },
});
