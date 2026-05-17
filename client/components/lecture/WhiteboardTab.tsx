import React, { useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
  Modal,
  Dimensions,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
} from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as Haptics from "expo-haptics";
import * as FileSystem from "expo-file-system/legacy";
import * as Clipboard from "expo-clipboard";
import * as Sharing from "expo-sharing";
import * as Print from "expo-print";
import * as DocumentPicker from "expo-document-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/Icon";

import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { useToast } from "@/components/Toast";
import { storage } from "@/lib/storage";
import { Spacing, BorderRadius } from "@/constants/theme";
import { getApiUrl, getAuthHeaders } from "@/lib/query-client";
import type { WhiteboardImage } from "@/types";

interface WhiteboardTabProps {
  images: WhiteboardImage[];
  topicId: string;
  onImageAdded: () => void;
}

const { width: screenWidth, height: screenHeight } = Dimensions.get("window");

export default function WhiteboardTab({
  images,
  topicId,
  onImageAdded,
}: WhiteboardTabProps) {
  const { theme } = useTheme();
  const { showToast } = useToast();
  const insets = useSafeAreaInsets();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadingLabel, setUploadingLabel] = useState("Processing...");
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [expandedImageId, setExpandedImageId] = useState<string | null>(null);
  const [expandedPhotos, setExpandedPhotos] = useState<Record<string, boolean>>(
    {},
  );
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [showPasteSheet, setShowPasteSheet] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const handlePickImage = async () => {
    try {
      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        showToast({
          type: "warning",
          title: "Permission needed",
          message: "Please allow access to your photo library to upload notes images.",
        });
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        await processImage(result.assets[0].uri);
      }
    } catch (error) {
      showToast({ type: "error", title: "Error", message: "Failed to pick image. Please try again." });
    }
  };

  const handleTakePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        showToast({
          type: "warning",
          title: Platform.OS !== "web" ? "Permission needed" : "Not available",
          message: Platform.OS !== "web"
            ? "Please allow camera access to capture notes images."
            : "Camera capture is not available on web. Please use the gallery option.",
        });
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        await processImage(result.assets[0].uri);
      }
    } catch (error) {
      showToast({ type: "error", title: "Error", message: "Failed to capture image. Please try again." });
    }
  };

  const readFileAsBase64 = async (uri: string): Promise<string> => {
    if (Platform.OS !== "web") {
      return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    }
    const resp = await fetch(uri);
    const blob = await resp.blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1] || "";
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const readFileAsText = async (uri: string): Promise<string> => {
    if (Platform.OS !== "web") {
      return FileSystem.readAsStringAsync(uri);
    }
    const resp = await fetch(uri);
    return resp.text();
  };

  const compressImage = async (uri: string): Promise<string> => {
    try {
      const manipResult = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 1024 } }],
        { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG },
      );
      return manipResult.uri;
    } catch {
      return uri;
    }
  };

  const processImage = async (uri: string) => {
    if (isUploading) return;
    setIsUploading(true);
    setUploadingLabel("Compressing image...");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const compressedUri = await compressImage(uri);
      setUploadingLabel("Extracting text from image...");

      const imageBase64 = await readFileAsBase64(compressedUri);

      const authHeaders = await getAuthHeaders();

      const response = await fetch(
        new URL("/api/ai/ocr/extract", getApiUrl()).toString(),
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          credentials: "include",
          body: JSON.stringify({ imageBase64, topicId }),
        },
      );

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const errMsg =
          typeof errData.error === "string"
            ? errData.error
            : errData.error?.message || "OCR extraction failed";
        throw new Error(errMsg);
      }

      const data = await response.json();
      const ocrText = data.text || "";

      await storage.saveWhiteboardImage({
        topicId,
        imagePath: uri,
        ocrText,
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onImageAdded();
    } catch (error: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const msg =
        error?.message || "Failed to process image. Please try again.";
      showToast({ type: "error", title: "Error", message: msg });
    } finally {
      setIsUploading(false);
    }
  };

  const handlePickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/*", "application/pdf", "image/*"],
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];

      if (asset.size && asset.size > 40 * 1024 * 1024) {
        showToast({ type: "warning", title: "File Too Large", message: "Please choose a file under 40 MB." });
        return;
      }

      setIsUploading(true);
      setUploadingLabel("Extracting text from document...");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      let extractedText = "";
      const mime = asset.mimeType || "";

      if (mime.startsWith("text/")) {
        extractedText = await readFileAsText(asset.uri);
      } else if (mime.startsWith("image/")) {
        await processImage(asset.uri);
        return;
      } else {
        const fileBase64 = await readFileAsBase64(asset.uri);

        const authHeaders = await getAuthHeaders();

        const response = await fetch(
          new URL("/api/ai/ocr/extract", getApiUrl()).toString(),
          {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders },
            credentials: "include",
            body: JSON.stringify({
              imageBase64: fileBase64,
              topicId,
              fileType: "pdf",
            }),
          },
        );

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          const errMsg =
            typeof errData.error === "string"
              ? errData.error
              : errData.error?.message || "Document extraction failed";
          throw new Error(errMsg);
        }

        const data = await response.json();
        extractedText = data.text || "";
      }

      if (extractedText.trim()) {
        await storage.saveWhiteboardImage({
          topicId,
          imagePath: "",
          ocrText: extractedText,
        });

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onImageAdded();
      } else {
        showToast({ type: "warning", title: "No Text Found", message: "Could not extract any text from the document." });
      }
    } catch (error: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const msg =
        error?.message || "Failed to process document. Please try again.";
      showToast({ type: "error", title: "Error", message: msg });
    } finally {
      setIsUploading(false);
    }
  };

  const handlePasteClipboard = () => {
    setPasteText("");
    setShowPasteSheet(true);
  };

  const handleSubmitPastedText = async () => {
    if (!pasteText.trim()) return;
    setShowPasteSheet(false);
    try {
      setIsUploading(true);
      setUploadingLabel("Saving pasted text...");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      await storage.saveWhiteboardImage({
        topicId,
        imagePath: "",
        ocrText: pasteText.trim(),
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPasteText("");
      onImageAdded();
    } catch (error) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ type: "error", title: "Error", message: "Failed to save pasted text. Please try again." });
    } finally {
      setIsUploading(false);
    }
  };

  const handleSummarize = async (imageId: string, text: string) => {
    if (summaries[imageId]) {
      setExpandedImageId(expandedImageId === imageId ? null : imageId);
      return;
    }

    setProcessingId(imageId);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch(
        new URL("/api/ai/summarize", getApiUrl()).toString(),
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          credentials: "include",
          body: JSON.stringify({ text }),
        },
      );

      if (response.ok) {
        const data = await response.json();
        setSummaries((prev) => ({ ...prev, [imageId]: data.summary }));
        setExpandedImageId(imageId);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        throw new Error("Failed to summarize");
      }
    } catch (error) {
      showToast({ type: "error", title: "Error", message: "Failed to summarize notes. Please try again." });
    } finally {
      setProcessingId(null);
    }
  };

  const handleGenerateFlashcards = async (text: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch(
        new URL("/api/ai/notes-to-flashcards", getApiUrl()).toString(),
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          credentials: "include",
          body: JSON.stringify({ text, topicId }),
        },
      );

      if (response.ok) {
        const data = await response.json();
        showToast({
          type: "success",
          title: "Flashcards Created",
          message: `${data.count} flashcards generated from your notes. Check the Cards tab!`,
        });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onImageAdded();
      } else {
        throw new Error("Failed to generate flashcards");
      }
    } catch (error) {
      showToast({ type: "error", title: "Error", message: "Failed to generate flashcards. Please try again." });
    }
  };

  const handleGenerateQuiz = async (text: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch(
        new URL("/api/ai/notes-to-quiz", getApiUrl()).toString(),
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          credentials: "include",
          body: JSON.stringify({ text, topicId }),
        },
      );

      if (response.ok) {
        const data = await response.json();
        showToast({
          type: "success",
          title: "Quiz Created",
          message: `${data.count} quiz questions generated. Check the Quiz tab!`,
        });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onImageAdded();
      } else {
        throw new Error("Failed to generate quiz");
      }
    } catch (error) {
      showToast({ type: "error", title: "Error", message: "Failed to generate quiz. Please try again." });
    }
  };

  const hasImage = (imagePath: string) => imagePath && imagePath.length > 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.headerSection}>
        <View style={[styles.tipCard, { backgroundColor: theme.info + "15" }]}>
          <Icon name="camera" size={18} color={theme.info} />
          <ThemedText style={[styles.tipText, { color: theme.info }]}>
            Capture notes, upload documents, or paste text to extract and create
            study materials!
          </ThemedText>
        </View>
      </View>

      <View style={styles.uploadGrid}>
        <View style={styles.uploadRow}>
          <Pressable
            onPress={handleTakePhoto}
            disabled={isUploading}
            style={[
              styles.uploadButton,
              {
                backgroundColor: theme.backgroundDefault,
                borderColor: theme.link,
              },
            ]}
          >
            <Icon name="camera" size={24} color={theme.link} />
            <ThemedText
              type="small"
              style={[styles.uploadLabel, { color: theme.text }]}
            >
              Camera
            </ThemedText>
          </Pressable>

          <Pressable
            onPress={handlePickImage}
            disabled={isUploading}
            style={[
              styles.uploadButton,
              {
                backgroundColor: theme.backgroundDefault,
                borderColor: theme.link,
              },
            ]}
          >
            <Icon name="image" size={24} color={theme.link} />
            <ThemedText
              type="small"
              style={[styles.uploadLabel, { color: theme.text }]}
            >
              Gallery
            </ThemedText>
          </Pressable>

          <Pressable
            onPress={handlePickDocument}
            disabled={isUploading}
            style={[
              styles.uploadButton,
              {
                backgroundColor: theme.backgroundDefault,
                borderColor: theme.link,
              },
            ]}
          >
            <Icon name="file-text" size={24} color={theme.link} />
            <ThemedText
              type="small"
              style={[styles.uploadLabel, { color: theme.text }]}
            >
              File
            </ThemedText>
          </Pressable>
        </View>

        <View style={styles.uploadRow}>
          <Pressable
            onPress={handlePasteClipboard}
            disabled={isUploading}
            style={[
              styles.uploadButton,
              {
                backgroundColor: theme.backgroundDefault,
                borderColor: theme.accent,
              },
            ]}
          >
            <Icon name="inbox" size={24} color={theme.accent} />
            <ThemedText
              type="small"
              style={[styles.uploadLabel, { color: theme.text }]}
            >
              Clipboard
            </ThemedText>
          </Pressable>

        </View>
      </View>

      {isUploading ? (
        <Card style={styles.processingCard}>
          <ActivityIndicator size="small" color={theme.link} />
          <ThemedText type="body" style={styles.processingText}>
            {uploadingLabel}
          </ThemedText>
        </Card>
      ) : null}

      {images.length === 0 && !isUploading ? (
        <View style={styles.emptyContainer}>
          <View
            style={[
              styles.emptyIcon,
              { backgroundColor: theme.warning + "15" },
            ]}
          >
            <Icon name="book-open" size={32} color={theme.warning} />
          </View>
          <ThemedText type="h3" style={styles.emptyTitle}>
            No Notes Captured
          </ThemedText>
          <ThemedText
            type="body"
            style={[styles.emptyDescription, { color: theme.textSecondary }]}
          >
            Take a photo, upload a file, paste text, or pick a video to extract
            text and create study materials
          </ThemedText>
        </View>
      ) : null}

      {images.map((image) => (
        <Card key={image.id} style={styles.imageCard}>
          {hasImage(image.imagePath) ? (
            <View>
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  setExpandedPhotos((prev) => ({
                    ...prev,
                    [image.id]: !prev[image.id],
                  }));
                }}
                onLongPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  setSelectedImage(image.imagePath);
                }}
              >
                <Image
                  source={{ uri: image.imagePath }}
                  style={
                    expandedPhotos[image.id]
                      ? styles.imageExpanded
                      : styles.image
                  }
                  contentFit={expandedPhotos[image.id] ? "contain" : "cover"}
                />
              </Pressable>
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  setExpandedPhotos((prev) => ({
                    ...prev,
                    [image.id]: !prev[image.id],
                  }));
                }}
                style={styles.expandToggle}
              >
                <Icon
                  name={expandedPhotos[image.id] ? "minimize-2" : "maximize-2"}
                  size={14}
                  color={theme.textSecondary}
                />
                <ThemedText
                  type="small"
                  style={{ color: theme.textSecondary, marginLeft: Spacing.xs }}
                >
                  {expandedPhotos[image.id] ? "Contract" : "Expand"}
                </ThemedText>
              </Pressable>
            </View>
          ) : (
            <View
              style={[
                styles.textOnlyBadge,
                { backgroundColor: theme.info + "15" },
              ]}
            >
              <Icon name="file-text" size={16} color={theme.info} />
              <ThemedText
                type="small"
                style={{ color: theme.info, marginLeft: Spacing.xs }}
              >
                Text Entry
              </ThemedText>
            </View>
          )}

          <View style={styles.ocrSection}>
            <View style={styles.ocrHeader}>
              <Icon name="file-text" size={16} color={theme.link} />
              <ThemedText
                type="small"
                style={[styles.ocrLabel, { color: theme.link }]}
              >
                Extracted Text
              </ThemedText>
              <View style={{ flexDirection: "row", marginLeft: "auto" }}>
                <Pressable
                  onPress={async () => {
                    await Clipboard.setStringAsync(image.ocrText);
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  }}
                  style={[styles.ocrActionButton, { backgroundColor: theme.link }]}
                  testID={`button-copy-ocr-${image.id}`}
                >
                  <Icon name="copy" size={12} color="#FFFFFF" />
                  <ThemedText type="caption" style={{ color: "#FFFFFF", marginLeft: 4 }}>Copy</ThemedText>
                </Pressable>
                <Pressable
                  onPress={async () => {
                    try {
                      const html = `<html><body><div style="font-family:sans-serif;line-height:1.6;padding:20px;"><h2>Extracted Text</h2><div style="white-space:pre-wrap;">${image.ocrText}</div></div></body></html>`;
                      const { uri } = await Print.printToFileAsync({ html });
                      const isAvailable = await Sharing.isAvailableAsync();
                      if (isAvailable) {
                        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Share Extracted Text' });
                      }
                    } catch (e) {
                      console.error('Share error:', e);
                    }
                  }}
                  style={[styles.ocrActionButton, { backgroundColor: theme.info, marginLeft: Spacing.xs }]}
                  testID={`button-share-ocr-${image.id}`}
                >
                  <Icon name="share" size={12} color="#FFFFFF" />
                  <ThemedText type="caption" style={{ color: "#FFFFFF", marginLeft: 4 }}>Share</ThemedText>
                </Pressable>
              </View>
            </View>

            <ThemedText
              type="body"
              style={[styles.ocrText, { color: theme.text }]}
              numberOfLines={expandedImageId === image.id ? undefined : 4}
            >
              {image.ocrText || "No text extracted"}
            </ThemedText>

            {image.ocrText && image.ocrText.length > 100 ? (
              <Pressable
                onPress={() =>
                  setExpandedImageId(
                    expandedImageId === image.id ? null : image.id,
                  )
                }
                style={styles.expandTextButton}
              >
                <ThemedText type="small" style={{ color: theme.link }}>
                  {expandedImageId === image.id ? "Show less" : "Show more"}
                </ThemedText>
              </Pressable>
            ) : null}
          </View>

          {image.ocrText && image.ocrText.trim().length > 10 ? (
            <View style={styles.actionRow}>
              <Pressable
                onPress={() => handleSummarize(image.id, image.ocrText)}
                disabled={processingId === image.id}
                style={[
                  styles.actionButton,
                  { backgroundColor: theme.success + "15" },
                ]}
              >
                {processingId === image.id ? (
                  <ActivityIndicator size="small" color={theme.success} />
                ) : (
                  <Icon name="align-left" size={16} color={theme.success} />
                )}
                <ThemedText
                  type="small"
                  style={{ color: theme.success, marginLeft: Spacing.xs }}
                >
                  {summaries[image.id] ? "Summary" : "Summarize"}
                </ThemedText>
              </Pressable>

              <Pressable
                onPress={() => handleGenerateFlashcards(image.ocrText)}
                style={[
                  styles.actionButton,
                  { backgroundColor: theme.link + "15" },
                ]}
              >
                <Icon name="layers" size={16} color={theme.link} />
                <ThemedText
                  type="small"
                  style={{ color: theme.link, marginLeft: Spacing.xs }}
                >
                  Flashcards
                </ThemedText>
              </Pressable>

              <Pressable
                onPress={() => handleGenerateQuiz(image.ocrText)}
                style={[
                  styles.actionButton,
                  { backgroundColor: theme.warning + "15" },
                ]}
              >
                <Icon name="help-circle" size={16} color={theme.warning} />
                <ThemedText
                  type="small"
                  style={{ color: theme.warning, marginLeft: Spacing.xs }}
                >
                  Quiz
                </ThemedText>
              </Pressable>
            </View>
          ) : null}

          {summaries[image.id] && expandedImageId === image.id ? (
            <View
              style={[
                styles.summarySection,
                { backgroundColor: theme.success + "08" },
              ]}
            >
              <View style={styles.summaryHeader}>
                <Icon name="align-left" size={14} color={theme.success} />
                <ThemedText
                  type="small"
                  style={[styles.summaryLabel, { color: theme.success }]}
                >
                  AI Summary
                </ThemedText>
              </View>
              <ThemedText
                type="body"
                style={[styles.summaryText, { color: theme.text }]}
              >
                {summaries[image.id]}
              </ThemedText>
            </View>
          ) : null}
        </Card>
      ))}

      <Modal
        visible={!!selectedImage}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedImage(null)}
      >
        <Pressable
          style={styles.fullscreenOverlay}
          onPress={() => setSelectedImage(null)}
        >
          {selectedImage ? (
            <Image
              source={{ uri: selectedImage }}
              style={styles.fullscreenImage}
              contentFit="contain"
            />
          ) : null}
          <TouchableOpacity
            style={[
              styles.closeButton,
              { top: insets.top + Spacing.md, backgroundColor: "rgba(0,0,0,0.6)" },
            ]}
            onPress={() => setSelectedImage(null)}
          >
            <Icon name="x" size={24} color="#fff" />
          </TouchableOpacity>
        </Pressable>
      </Modal>

      <Modal
        visible={showPasteSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPasteSheet(false)}
      >
        <Pressable
          style={styles.pasteOverlay}
          onPress={() => setShowPasteSheet(false)}
        >
          <Pressable
            style={[
              styles.pasteSheet,
              {
                backgroundColor: theme.backgroundDefault,
                paddingBottom: insets.bottom + Spacing.lg,
              },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.pasteSheetHandle}>
              <View
                style={[
                  styles.pasteHandleBar,
                  { backgroundColor: theme.textSecondary + "40" },
                ]}
              />
            </View>
            <ThemedText type="h3" style={styles.pasteTitle}>
              Paste Text
            </ThemedText>
            <ThemedText
              type="small"
              style={[styles.pasteHint, { color: theme.textSecondary }]}
            >
              Paste or type your notes below to extract and save them
            </ThemedText>
            <View
              style={[
                styles.pasteInputContainer,
                {
                  backgroundColor: theme.backgroundSecondary,
                  borderColor: theme.border,
                },
              ]}
            >
              <TextInput
                style={[styles.pasteInput, { color: theme.text }]}
                placeholder="Paste your notes here..."
                placeholderTextColor={theme.textSecondary}
                value={pasteText}
                onChangeText={setPasteText}
                multiline
                autoFocus
                textAlignVertical="top"
              />
            </View>
            <Button
              onPress={handleSubmitPastedText}
              disabled={!pasteText.trim()}
              size="lg"
              fullWidth
            >
              Save Text
            </Button>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: Spacing["3xl"],
  },
  headerSection: {
    marginBottom: Spacing.lg,
  },
  tipCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    gap: Spacing.sm,
  },
  tipText: {
    flex: 1,
    fontSize: 13,
  },
  uploadGrid: {
    marginBottom: Spacing.lg,
    gap: Spacing.sm,
  },
  uploadRow: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  uploadButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1.5,
    borderStyle: "dashed",
    gap: Spacing.xs,
  },
  uploadLabel: {
    fontWeight: "600",
    fontSize: 12,
  },
  processingCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  processingText: {
    fontWeight: "500",
  },
  emptyContainer: {
    alignItems: "center",
    paddingVertical: Spacing["3xl"],
    paddingHorizontal: Spacing.xl,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.lg,
  },
  emptyTitle: {
    marginBottom: Spacing.sm,
    textAlign: "center",
  },
  emptyDescription: {
    textAlign: "center",
    lineHeight: 22,
  },
  imageCard: {
    marginBottom: Spacing.lg,
    overflow: "hidden",
  },
  image: {
    width: "100%",
    height: 200,
    borderRadius: BorderRadius.md,
  },
  imageExpanded: {
    width: "100%",
    height: 400,
    borderRadius: BorderRadius.md,
  },
  expandToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.xs,
    marginTop: Spacing.xs,
  },
  textOnlyBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
    alignSelf: "flex-start",
  },
  ocrSection: {
    marginTop: Spacing.md,
  },
  ocrHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  ocrLabel: {
    fontWeight: "600",
    marginLeft: Spacing.xs,
  },
  ocrText: {
    lineHeight: 22,
  },
  expandTextButton: {
    paddingTop: Spacing.sm,
  },
  actionRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginTop: Spacing.md,
    flexWrap: "wrap",
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  summarySection: {
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  summaryHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  summaryLabel: {
    fontWeight: "600",
    marginLeft: Spacing.xs,
  },
  summaryText: {
    lineHeight: 22,
  },
  fullscreenOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
    justifyContent: "center",
    alignItems: "center",
  },
  fullscreenImage: {
    width: screenWidth,
    height: screenHeight * 0.8,
  },
  closeButton: {
    position: "absolute",
    right: Spacing.lg,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  ocrActionButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.sm,
  },
  pasteOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  pasteSheet: {
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    paddingHorizontal: Spacing.lg,
  },
  pasteSheetHandle: {
    alignItems: "center",
    paddingVertical: Spacing.md,
  },
  pasteHandleBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  pasteTitle: {
    marginBottom: Spacing.xs,
  },
  pasteHint: {
    marginBottom: Spacing.md,
  },
  pasteInputContainer: {
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginBottom: Spacing.lg,
    minHeight: 150,
  },
  pasteInput: {
    padding: Spacing.md,
    fontSize: 15,
    lineHeight: 22,
    minHeight: 150,
  },
});
