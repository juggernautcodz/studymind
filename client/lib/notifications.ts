import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { getApiUrl } from "@/lib/query-client";

const NOTIFICATION_SETTINGS_KEY = "@studymind_notification_settings";
const PUSH_TOKEN_KEY = "@studymind_push_token";

const isExpoGo = Constants.appOwnership === "expo";
const isAndroidExpoGo = Platform.OS === "android" && isExpoGo;

export interface NotificationSettings {
  enabled: boolean;
  dailyReminder: boolean;
  dailyReminderTime: string;
  studyStreakReminder: boolean;
  dueCardsReminder: boolean;
}

const defaultSettings: NotificationSettings = {
  enabled: false,
  dailyReminder: true,
  dailyReminderTime: "09:00",
  studyStreakReminder: true,
  dueCardsReminder: true,
};

let Notifications: typeof import("expo-notifications") | null = null;
let Device: typeof import("expo-device") | null = null;

async function loadNotificationsModule() {
  if (isAndroidExpoGo) {
    return null;
  }
  if (!Notifications) {
    Notifications = await import("expo-notifications");
    Device = await import("expo-device");

    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  }
  return Notifications;
}

export async function registerForPushNotifications(): Promise<string | null> {
  if (isAndroidExpoGo) {
    console.log("Push notifications are not available in Expo Go on Android.");
    return null;
  }

  const notifs = await loadNotificationsModule();
  const device = Device;

  if (!notifs || !device) return null;

  if (!device.isDevice) {
    console.log("Push notifications require a physical device");
    return null;
  }

  if (Platform.OS === "android") {
    try {
      await notifs.setNotificationChannelAsync("default", {
        name: "StudyMind",
        importance: notifs.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#6366F1",
      });
    } catch (error) {
      console.log("Could not set notification channel:", error);
    }
  }

  const existingPerms = await notifs.getPermissionsAsync() as unknown as { granted: boolean };
  let finalGranted = existingPerms.granted;

  if (!existingPerms.granted) {
    const result = await notifs.requestPermissionsAsync() as unknown as { granted: boolean };
    finalGranted = result.granted;
  }

  if (!finalGranted) {
    console.log("Permission for push notifications was denied");
    return null;
  }

  if (isExpoGo) {
    console.log("Running in Expo Go - push tokens not available");
    return null;
  }

  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const tokenData = await notifs.getExpoPushTokenAsync({ projectId });
    const token = tokenData.data;
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
    return token;
  } catch (error) {
    console.error("Error getting push token:", error);
    return null;
  }
}

export async function registerPushTokenWithServer(authToken: string): Promise<void> {
  try {
    const token = await registerForPushNotifications();
    if (!token) return;

    await fetch(`${getApiUrl()}/api/notifications/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ token }),
    });
  } catch (err) {
    console.log("[Notifications] Failed to register push token with server:", err);
  }
}

export async function getNotificationSettings(): Promise<NotificationSettings> {
  try {
    const stored = await AsyncStorage.getItem(NOTIFICATION_SETTINGS_KEY);
    if (stored) {
      return { ...defaultSettings, ...JSON.parse(stored) };
    }
    return defaultSettings;
  } catch {
    return defaultSettings;
  }
}

export async function saveNotificationSettings(
  settings: Partial<NotificationSettings>,
): Promise<NotificationSettings> {
  const current = await getNotificationSettings();
  const updated = { ...current, ...settings };
  await AsyncStorage.setItem(
    NOTIFICATION_SETTINGS_KEY,
    JSON.stringify(updated),
  );

  await scheduleNotifications(updated);

  return updated;
}

export async function scheduleNotifications(
  settings: NotificationSettings,
): Promise<void> {
  if (isAndroidExpoGo) return;

  const notifs = await loadNotificationsModule();
  if (!notifs) return;

  await notifs.cancelAllScheduledNotificationsAsync();

  if (!settings.enabled) {
    return;
  }

  if (settings.dailyReminder) {
    const [hours, minutes] = settings.dailyReminderTime.split(":").map(Number);

    await notifs.scheduleNotificationAsync({
      content: {
        title: "Time to Study!",
        body: "Keep your learning streak going. Open StudyMind to review your flashcards.",
        sound: true,
        priority: notifs.AndroidNotificationPriority.HIGH,
      },
      trigger: {
        type: notifs.SchedulableTriggerInputTypes.DAILY,
        hour: hours,
        minute: minutes,
      },
    });
  }

  if (settings.studyStreakReminder) {
    await notifs.scheduleNotificationAsync({
      content: {
        title: "Don't Break Your Streak!",
        body: "You haven't studied today yet. A quick 5-minute session will keep you on track.",
        sound: true,
      },
      trigger: {
        type: notifs.SchedulableTriggerInputTypes.DAILY,
        hour: 20,
        minute: 0,
      },
    });
  }
}

export async function scheduleDueCardsNotification(
  dueCount: number,
): Promise<void> {
  if (isAndroidExpoGo) return;

  const settings = await getNotificationSettings();
  const notifs = await loadNotificationsModule();

  if (
    !notifs ||
    !settings.enabled ||
    !settings.dueCardsReminder ||
    dueCount === 0
  ) {
    return;
  }

  await notifs.scheduleNotificationAsync({
    content: {
      title: "Flashcards Due for Review",
      body: `You have ${dueCount} flashcard${dueCount > 1 ? "s" : ""} due for review. Don't let your memory fade!`,
      sound: true,
      data: { type: "due_cards", count: dueCount },
    },
    trigger: {
      type: notifs.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 3600,
      repeats: false,
    },
  });
}

export async function sendLocalNotification(
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  if (isAndroidExpoGo) return;

  const notifs = await loadNotificationsModule();
  if (!notifs) return;

  await notifs.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: true,
      data,
    },
    trigger: null,
  });
}

export function addNotificationListener(
  callback: (notification: any) => void,
): { remove: () => void } {
  if (isAndroidExpoGo) {
    return { remove: () => {} };
  }

  let subscription: { remove: () => void } | null = null;

  loadNotificationsModule().then((notifs) => {
    if (notifs) {
      subscription = notifs.addNotificationReceivedListener(callback);
    }
  });

  return {
    remove: () => {
      if (subscription) subscription.remove();
    },
  };
}

export function addNotificationResponseListener(
  callback: (response: any) => void,
): { remove: () => void } {
  if (isAndroidExpoGo) {
    return { remove: () => {} };
  }

  let subscription: { remove: () => void } | null = null;

  loadNotificationsModule().then((notifs) => {
    if (notifs) {
      subscription = notifs.addNotificationResponseReceivedListener(callback);
    }
  });

  return {
    remove: () => {
      if (subscription) subscription.remove();
    },
  };
}

export async function getBadgeCount(): Promise<number> {
  if (isAndroidExpoGo) return 0;

  const notifs = await loadNotificationsModule();
  if (!notifs) return 0;

  return await notifs.getBadgeCountAsync();
}

export async function setBadgeCount(count: number): Promise<void> {
  if (isAndroidExpoGo) return;

  const notifs = await loadNotificationsModule();
  if (!notifs) return;

  await notifs.setBadgeCountAsync(count);
}

export async function clearBadge(): Promise<void> {
  if (isAndroidExpoGo) return;

  const notifs = await loadNotificationsModule();
  if (!notifs) return;

  await notifs.setBadgeCountAsync(0);
}
