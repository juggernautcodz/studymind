import React, { useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Linking,
  Alert,
  Modal,
  Platform,
  Share,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Icon } from "@/components/Icon";
import * as Haptics from "expo-haptics";
import type { ProfileStackParamList } from "@/navigation/ProfileStackNavigator";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { ListItem } from "@/components/ListItem";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/components/Toast";
import { storage } from "@/lib/storage";
import { getApiUrl } from "@/lib/query-client";
import { Spacing, BorderRadius } from "@/constants/theme";

const SUPPORT_EMAIL = "studymindv1@hotmail.com";

function getPrivacyPolicyUrl(): string {
  if (process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL) {
    return process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL;
  }
  const base = getApiUrl();
  return new URL("/privacy", base).toString();
}

export default function PrivacyScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();
  const { user, getAuthToken, logout } = useAuth();
  const { showToast } = useToast();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleOpenPrivacyPolicy = async () => {
    Haptics.selectionAsync();
    try {
      const url = getPrivacyPolicyUrl();
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      } else {
        showToast({
          type: "error",
          title: "Cannot open link",
          message: "Unable to open the privacy policy URL",
        });
      }
    } catch {
      showToast({
        type: "error",
        title: "Error",
        message: "Failed to open privacy policy",
      });
    }
  };

  const handleContactSupport = async () => {
    Haptics.selectionAsync();
    try {
      const url = `mailto:${SUPPORT_EMAIL}?subject=StudyMind%20Support%20Request`;
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      } else {
        showToast({
          type: "info",
          title: "Email us",
          message: `Send an email to ${SUPPORT_EMAIL}`,
        });
      }
    } catch {
      showToast({
        type: "info",
        title: "Email us",
        message: `Send an email to ${SUPPORT_EMAIL}`,
      });
    }
  };

  const [exporting, setExporting] = useState(false);

  const handleExportData = async () => {
    setExporting(true);
    try {
      const token = await getAuthToken();
      const baseUrl = getApiUrl();
      const url = new URL("/api/auth/export", baseUrl);

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) throw new Error("Export failed");

      const json = await response.text();
      await Share.share({ message: json, title: "StudyMind Data Export" });
    } catch {
      showToast({
        type: "error",
        title: "Export failed",
        message: "Could not export your data. Please try again.",
      });
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteData = async () => {
    setDeleting(true);
    try {
      const token = await getAuthToken();
      const baseUrl = getApiUrl();
      const url = new URL("/api/auth/data", baseUrl);

      const response = await fetch(url.toString(), {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error("Server returned an error");
      }

      await storage.clearAll();

      setShowDeleteModal(false);
      showToast({
        type: "success",
        title: "Data deleted",
        message: "All your study data has been permanently removed",
      });

      await logout();
    } catch {
      showToast({
        type: "error",
        title: "Deletion failed",
        message:
          "Could not delete your data. Please try again or contact support.",
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: headerHeight + Spacing.md,
            paddingBottom: insets.bottom + Spacing["3xl"],
          },
        ]}
        scrollIndicatorInsets={{ bottom: insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroSection}>
          <View
            style={[styles.heroIcon, { backgroundColor: theme.link + "12" }]}
          >
            <Icon name="shield" size={28} color={theme.link} />
          </View>
          <ThemedText type="h2" style={styles.heroTitle}>
            Privacy & Data
          </ThemedText>
          <ThemedText
            type="body"
            style={[styles.heroSubtitle, { color: theme.textSecondary }]}
          >
            Control how your data is used and manage your privacy preferences
          </ThemedText>
        </View>

        <View style={styles.section}>
          <ThemedText
            type="caption"
            style={[styles.sectionHeader, { color: theme.textSecondary }]}
          >
            PRIVACY
          </ThemedText>
          <Card style={styles.menuCard}>
            <ListItem
              title="Terms of Service"
              subtitle="Read our terms of use"
              leftIcon="file"
              onPress={() => {
                Haptics.selectionAsync();
                navigation.navigate("TermsOfService");
              }}
              testID="button-terms-of-service"
            />
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            <ListItem
              title="Privacy Policy"
              subtitle="Read our full privacy policy"
              leftIcon="file-text"
              onPress={handleOpenPrivacyPolicy}
              testID="button-privacy-policy"
            />
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            <ListItem
              title="Contact Support"
              subtitle={SUPPORT_EMAIL}
              leftIcon="mail"
              onPress={handleContactSupport}
              testID="button-contact-support"
            />
          </Card>
        </View>

        <View style={styles.section}>
          <ThemedText
            type="caption"
            style={[styles.sectionHeader, { color: theme.textSecondary }]}
          >
            YOUR DATA
          </ThemedText>
          <Card style={styles.menuCard}>
            <ListItem
              title="Download My Data"
              subtitle="Export a copy of all your study data as JSON"
              leftIcon="download"
              onPress={() => {
                Haptics.selectionAsync();
                handleExportData();
              }}
              disabled={exporting}
              testID="button-export-data"
            />
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            <ListItem
              title="Delete My Data"
              subtitle="Permanently delete all study data from the server and this device"
              leftIcon="trash-2"
              leftIconColor={theme.error}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setShowDeleteModal(true);
              }}
              testID="button-delete-data"
            />
          </Card>
          <ThemedText
            type="small"
            style={[styles.dataNote, { color: theme.textSecondary }]}
          >
            This removes all your study content from both the server and this
            device. Your account will remain active but empty.
          </ThemedText>
        </View>

        <View style={styles.section}>
          <ThemedText
            type="caption"
            style={[styles.sectionHeader, { color: theme.textSecondary }]}
          >
            DATA WE COLLECT
          </ThemedText>
          <Card style={styles.infoCard}>
            <View style={styles.dataRow}>
              <View
                style={[
                  styles.dataIcon,
                  { backgroundColor: theme.info + "12" },
                ]}
              >
                <Icon name="mic" size={16} color={theme.info} />
              </View>
              <View style={styles.dataInfo}>
                <ThemedText type="body" style={{ fontWeight: "600" }}>
                  Audio Recordings
                </ThemedText>
                <ThemedText type="small" style={{ color: theme.textSecondary }}>
                  Sent to server for AI transcription, not stored after processing
                </ThemedText>
              </View>
            </View>
            <View
              style={[styles.dividerFull, { backgroundColor: theme.border }]}
            />
            <View style={styles.dataRow}>
              <View
                style={[
                  styles.dataIcon,
                  { backgroundColor: theme.warning + "12" },
                ]}
              >
                <Icon name="camera" size={16} color={theme.warning} />
              </View>
              <View style={styles.dataInfo}>
                <ThemedText type="body" style={{ fontWeight: "600" }}>
                  Images & Scans
                </ThemedText>
                <ThemedText type="small" style={{ color: theme.textSecondary }}>
                  Used for OCR text extraction, accessible only to you
                </ThemedText>
              </View>
            </View>
            <View
              style={[styles.dividerFull, { backgroundColor: theme.border }]}
            />
            <View style={styles.dataRow}>
              <View
                style={[
                  styles.dataIcon,
                  { backgroundColor: theme.success + "12" },
                ]}
              >
                <Icon name="book-open" size={16} color={theme.success} />
              </View>
              <View style={styles.dataInfo}>
                <ThemedText type="body" style={{ fontWeight: "600" }}>
                  Study Materials
                </ThemedText>
                <ThemedText type="small" style={{ color: theme.textSecondary }}>
                  Notes, flashcards, and quizzes generated from your content
                </ThemedText>
              </View>
            </View>
            <View
              style={[styles.dividerFull, { backgroundColor: theme.border }]}
            />
            <View style={styles.dataRow}>
              <View
                style={[
                  styles.dataIcon,
                  { backgroundColor: theme.link + "12" },
                ]}
              >
                <Icon name="clipboard" size={16} color={theme.link} />
              </View>
              <View style={styles.dataInfo}>
                <ThemedText type="body" style={{ fontWeight: "600" }}>
                  Text Input
                </ThemedText>
                <ThemedText type="small" style={{ color: theme.textSecondary }}>
                  Clipboard or typed text sent for AI processing
                </ThemedText>
              </View>
            </View>
          </Card>
        </View>

        <View style={styles.section}>
          <ThemedText
            type="caption"
            style={[styles.sectionHeader, { color: theme.textSecondary }]}
          >
            THIRD-PARTY SERVICES
          </ThemedText>
          <Card style={styles.infoCard}>
            <View style={styles.serviceRow}>
              <Icon name="cpu" size={16} color={theme.textSecondary} />
              <ThemedText type="body" style={styles.serviceText}>
                OpenAI for AI transcription and content generation
              </ThemedText>
            </View>
            <View style={styles.serviceRow}>
              <Icon name="credit-card" size={16} color={theme.textSecondary} />
              <ThemedText type="body" style={styles.serviceText}>
                Google Play for payment processing
              </ThemedText>
            </View>
          </Card>
        </View>
      </ScrollView>

      <Modal
        visible={showDeleteModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeleteModal(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => !deleting && setShowDeleteModal(false)}
        >
          <Pressable
            style={[
              styles.modalContent,
              { backgroundColor: theme.backgroundDefault },
            ]}
            onPress={() => {}}
          >
            <View
              style={[
                styles.modalIcon,
                { backgroundColor: theme.error + "12" },
              ]}
            >
              <Icon name="alert-triangle" size={32} color={theme.error} />
            </View>
            <ThemedText type="h3" style={styles.modalTitle}>
              Delete All Your Data?
            </ThemedText>
            <ThemedText
              type="body"
              style={[styles.modalBody, { color: theme.textSecondary }]}
            >
              This will permanently delete all your topics, notes,
              flashcards, quizzes, and recordings from both the server
              and your device. This action cannot be undone.
            </ThemedText>

            <View style={styles.modalButtons}>
              <Button
                variant="secondary"
                size="lg"
                fullWidth
                onPress={() => setShowDeleteModal(false)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="lg"
                fullWidth
                onPress={handleDeleteData}
                loading={deleting}
                testID="button-confirm-delete-data"
              >
                Delete Everything
              </Button>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
  heroSection: {
    alignItems: "center",
    marginBottom: Spacing.xl,
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.md,
  },
  heroTitle: {
    marginBottom: Spacing.xs,
    textAlign: "center",
  },
  heroSubtitle: {
    textAlign: "center",
    maxWidth: 280,
    lineHeight: 20,
  },
  section: {
    marginBottom: Spacing.xl,
  },
  sectionHeader: {
    marginBottom: Spacing.sm,
    marginLeft: Spacing.sm,
    fontWeight: "600",
    letterSpacing: 1,
  },
  menuCard: {
    padding: 0,
    overflow: "hidden",
  },
  infoCard: {
    paddingVertical: Spacing.sm,
  },
  divider: {
    height: 1,
    marginHorizontal: Spacing.lg,
  },
  dividerFull: {
    height: 1,
    marginHorizontal: Spacing.md,
    marginVertical: Spacing.xs,
  },
  dataNote: {
    marginTop: Spacing.sm,
    marginHorizontal: Spacing.sm,
    lineHeight: 18,
  },
  dataRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    gap: Spacing.md,
  },
  dataIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  dataInfo: {
    flex: 1,
    gap: 2,
  },
  serviceRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    gap: Spacing.md,
  },
  serviceText: {
    flex: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.xl,
  },
  modalContent: {
    width: "100%",
    maxWidth: 360,
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    alignItems: "center",
  },
  modalIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.lg,
  },
  modalTitle: {
    marginBottom: Spacing.md,
    textAlign: "center",
  },
  modalBody: {
    textAlign: "center",
    lineHeight: 22,
    marginBottom: Spacing.xl,
  },
  modalButtons: {
    width: "100%",
    gap: Spacing.md,
  },
});
