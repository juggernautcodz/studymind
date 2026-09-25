import React, { useState, useCallback } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  TextInput,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import {
  useFocusEffect,
  useNavigation,
  useRoute,
} from "@react-navigation/native";
import { Icon } from "@/components/Icon";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as FileSystem from "expo-file-system/legacy";
import * as DocumentPicker from "expo-document-picker";

import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { LoadingState } from "@/components/LoadingState";
import { TabBar } from "@/components/TabBar";
import { BottomSheet } from "@/components/BottomSheet";
import {
  ContentDestinationSheet,
  type ContentDestination,
} from "@/components/ContentDestinationSheet";
import { useTheme } from "@/hooks/useTheme";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/contexts/AuthContext";
import { storage } from "@/lib/storage";
import { createTopicWithServerSync } from "@/lib/serverSync";
import { getApiUrl, getAuthHeaders, isNetworkError } from "@/lib/query-client";
import { Spacing, BorderRadius } from "@/constants/theme";
import type {
  Topic,
  Notes,
  Flashcard,
  Quiz,
  QuizQuestion,
} from "@/types";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import NotesTab from "@/components/lecture/NotesTab";
import FlashcardsTab from "@/components/lecture/FlashcardsTab";
import QuizTab from "@/components/lecture/QuizTab";

const CONTENT_TABS = [
  { key: "notes", label: "Notes" },
  { key: "flashcards", label: "Cards" },
  { key: "quiz", label: "Quiz" },
];

export default function TopicScreen() {
  const { theme } = useTheme();
  const { showToast } = useToast();
  const { getAuthToken } = useAuth();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const route = useRoute<any>();
  const { topicId, courseId, initialTab } = route.params;

  const [topic, setTopic] = useState<Topic | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(initialTab ?? "notes");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadingLabel, setUploadingLabel] = useState("Processing...");

  const [topicNotes, setTopicNotes] = useState<Notes | null>(null);
  const [topicFlashcards, setTopicFlashcards] = useState<Flashcard[]>([]);
  const [topicQuizData, setTopicQuizData] = useState<{
    quiz: Quiz;
    questions: QuizQuestion[];
  } | null>(null);
  const [showPasteSheet, setShowPasteSheet] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [showDestinationSheet, setShowDestinationSheet] = useState(false);
  const [pendingContent, setPendingContent] = useState<{
    text: string;
    source: string;
    imageUri?: string;
  } | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [loadedTopic, notes, flashcards, quizData] =
        await Promise.all([
          storage.getTopic(topicId),
          storage.getNotes(topicId),
          storage.getFlashcards(topicId),
          storage.getQuiz(topicId),
        ]);
      setTopic(loadedTopic);
      setTopicNotes(notes);
      setTopicFlashcards(flashcards);
      setTopicQuizData(quizData);
      storage.recordTopicVisit(topicId).catch(() => {});
    } finally {
      setIsLoading(false);
    }
  }, [topicId, courseId]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  React.useEffect(() => {
    setActiveTab(initialTab ?? "notes");
  }, [initialTab, topicId]);

  React.useLayoutEffect(() => {
    if (topic) {
      navigation.setOptions({ headerTitle: topic.name });
    }
  }, [navigation, topic]);

  const handleRecord = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast({ type: "success", title: "Starting recording", message: "Recording for this topic..." });
    navigation.navigate("Record", { topicId });
  };

  const handleTakePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        showToast({
          type: "warning",
          title: Platform.OS !== "web" ? "Permission needed" : "Not available",
          message: Platform.OS !== "web" ? "Please allow camera access to capture notes." : "Camera not available on web. Use file upload instead.",
        });
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.8 });
      if (!result.canceled && result.assets[0]) {
        setIsUploading(true);
        setUploadingLabel("Extracting text from image...");
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        try {
          const ocrText = await extractImageText(result.assets[0].uri);
          if (ocrText.trim().length >= 20) {
            showDestinationPicker("Camera", ocrText, result.assets[0].uri);
          } else {
            showToast({ type: "warning", title: "Not Enough Text", message: "Could not extract enough text from the image. Try a clearer photo." });
          }
        } catch {
          showToast({ type: "error", title: "Could Not Read Image", message: "Make sure the text is clearly visible and try again." });
        } finally {
          setIsUploading(false);
        }
      }
    } catch {
      showToast({ type: "error", title: "Camera Error", message: "Failed to access camera. Please try again." });
    }
  };

  const handlePickGallery = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        showToast({ type: "warning", title: "Permission needed", message: "Allow access to your photo library." });
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, quality: 0.8 });
      if (!result.canceled && result.assets[0]) {
        setIsUploading(true);
        setUploadingLabel("Extracting text from image...");
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        try {
          const ocrText = await extractImageText(result.assets[0].uri);
          if (ocrText.trim().length >= 20) {
            showDestinationPicker("Gallery", ocrText, result.assets[0].uri);
          } else {
            showToast({ type: "warning", title: "Not Enough Text", message: "Could not extract enough text from the image. Try a clearer photo." });
          }
        } catch {
          showToast({ type: "error", title: "Could Not Read Image", message: "Make sure the text is clearly visible and try again." });
        } finally {
          setIsUploading(false);
        }
      }
    } catch {
      showToast({ type: "error", title: "Gallery Error", message: "Failed to pick image. Please try again." });
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
      const manipResult = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1024 } }], { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG });
      return manipResult.uri;
    } catch {
      return uri;
    }
  };

  const generateStudyMaterials = async (
    text: string,
    targetTopicId: string,
    sectionLabel?: string,
  ): Promise<number> => {
    if (!text || text.trim().length < 20) return 0;
    const authHeaders = await getAuthHeaders();
    setUploadingLabel("Generating study materials...");
    let generated = 0;
    let likelyOffline = false;
    try {
      const [notesRes, flashcardsRes, quizRes] = await Promise.allSettled([
        fetch(new URL("/api/ai/summarize", getApiUrl()).toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          credentials: "include",
          body: JSON.stringify({ text }),
        }),
        fetch(new URL("/api/ai/notes-to-flashcards", getApiUrl()).toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          credentials: "include",
          body: JSON.stringify({ text, topicId: targetTopicId }),
        }),
        fetch(new URL("/api/ai/notes-to-quiz", getApiUrl()).toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          credentials: "include",
          body: JSON.stringify({ text, topicId: targetTopicId }),
        }),
      ]);
      if (notesRes.status === "fulfilled" && notesRes.value.ok) {
        const data = await notesRes.value.json();
        if (data.summary) {
          const summaryBullets = data.summary.split(/\n+/).filter((line: string) => line.trim());
          const timestamp = new Date().toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          });
          const heading = sectionLabel
            ? `${sectionLabel} (${timestamp})`
            : `Notes (${timestamp})`;
          await storage.saveNotes({ topicId: targetTopicId, title: "Study Notes", sections: [{ heading, bullets: summaryBullets }] });
          generated++;
        }
      }
      if (flashcardsRes.status === "fulfilled" && flashcardsRes.value.ok) {
        const data = await flashcardsRes.value.json();
        if (data.flashcards && data.flashcards.length > 0) {
          await storage.saveFlashcards(targetTopicId, data.flashcards.map((c: any, i: number) => ({ question: c.front, answer: c.back, orderIndex: i, sourceQuote: c.quote })));
          generated++;
        }
      }
      if (quizRes.status === "fulfilled" && quizRes.value.ok) {
        const data = await quizRes.value.json();
        if (data.questions && data.questions.length > 0) {
          await storage.saveQuiz(targetTopicId, data.questions.map((q: any) => ({ question: q.question, options: q.options, correctIndex: typeof q.correctAnswer === "number" ? q.correctAnswer : 0 })));
          generated++;
        }
      }
      if (generated === 0) {
        likelyOffline = [notesRes, flashcardsRes, quizRes].some(
          (r) => r.status === "rejected" && isNetworkError((r as PromiseRejectedResult).reason),
        );
      }
      if (generated > 0) {
        await storage.updateTopic(targetTopicId, { status: "completed" });
        if (__DEV__) console.log(`[TopicScreen] Topic status -> completed (${generated}/3 generated)`);
      }
    } catch (err) {
      if (isNetworkError(err)) likelyOffline = true;
      if (__DEV__) console.log("[TopicScreen] generateStudyMaterials error:", err);
    }
    if (likelyOffline && generated === 0) return -1;
    return generated;
  };

  const createNewTopicForContent = async (
    source: string,
  ): Promise<string | null> => {
    try {
      const user = await storage.getUser();
      if (!user) return null;
      const timestamp = new Date().toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      const name = `${source} - ${timestamp}`;
      const token = await getAuthToken();
      try {
        const newTopic = await createTopicWithServerSync(
          { userId: user.id, courseId, name, orderIndex: 0, status: "pending" },
          token,
        );
        return newTopic.id;
      } catch {
        const localTopic = await storage.createTopic({
          userId: user.id,
          courseId,
          name,
          orderIndex: 0,
          status: "pending",
        });
        return localTopic.id;
      }
    } catch {
      return null;
    }
  };

  const showDestinationPicker = (
    source: string,
    text: string,
    imageUri?: string,
  ) => {
    setPendingContent({ text, source, imageUri });
    setShowDestinationSheet(true);
  };

  const handleDestinationSelect = async (destination: ContentDestination) => {
    setShowDestinationSheet(false);
    if (!pendingContent) return;

    const { text, source, imageUri } = pendingContent;
    setPendingContent(null);

    setIsUploading(true);
    setUploadingLabel("Generating study materials...");

    try {
      let targetTopicId = topicId;

      if (destination === "new-topic") {
        const newId = await createNewTopicForContent(source);
        if (!newId) {
          showToast({ type: "error", title: "Error", message: "Could not create a new topic." });
          return;
        }
        targetTopicId = newId;
      }

      await storage.saveWhiteboardImage({
        topicId: targetTopicId,
        imagePath: imageUri || "",
        ocrText: text,
      });

      const sectionLabel =
        destination === "new-section" ? source : undefined;
      const generated = await generateStudyMaterials(text, targetTopicId, sectionLabel);
      if (generated > 0) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast({
          type: "success",
          title: "Study materials created!",
          message:
            destination === "new-topic"
              ? "New topic created with notes, flashcards, and quiz."
              : destination === "new-section"
                ? `Added as "${source}" section with notes, flashcards, and quiz.`
                : "Notes, flashcards, and quiz merged into topic.",
        });
      } else if (generated === -1) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        showToast({
          type: "warning",
          title: "You appear to be offline",
          message: "Connect to the internet and tap an action button to try again.",
        });
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        showToast({
          type: "error",
          title: "AI unavailable",
          message: "Could not generate study materials. Please try again.",
        });
      }
      loadData();
    } catch (error: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ type: "error", title: "Error", message: error?.message || "Failed to generate study materials." });
    } finally {
      setIsUploading(false);
    }
  };

  const extractImageText = async (uri: string): Promise<string> => {
    const compressedUri = await compressImage(uri);
    const imageBase64 = await readFileAsBase64(compressedUri);
    const authHeaders = await getAuthHeaders();
    const response = await fetch(new URL("/api/ai/ocr/extract", getApiUrl()).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      credentials: "include",
      body: JSON.stringify({ imageBase64 }),
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(typeof errData.error === "string" ? errData.error : "OCR extraction failed");
    }
    const data = await response.json();
    return data.text || "";
  };

  const handlePickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ["text/*", "application/pdf", "image/*"] });
      if (result.canceled || !result.assets || result.assets.length === 0) return;
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
      const fileName = asset.name || "Upload";
      if (mime.startsWith("text/")) {
        extractedText = await readFileAsText(asset.uri);
      } else if (mime.startsWith("image/")) {
        try {
          const ocrText = await extractImageText(asset.uri);
          if (ocrText.trim().length >= 20) {
            showDestinationPicker("Upload", ocrText, asset.uri);
          } else {
            showToast({ type: "warning", title: "Not Enough Text", message: "Could not extract enough text from the image. Try a clearer photo." });
          }
        } catch {
          showToast({ type: "error", title: "Could Not Read Image", message: "Make sure the text is clearly visible and try again." });
        } finally {
          setIsUploading(false);
        }
        return;
      } else {
        const fileBase64 = await readFileAsBase64(asset.uri);
        const authHeaders = await getAuthHeaders();
        const response = await fetch(new URL("/api/ai/ocr/extract", getApiUrl()).toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          credentials: "include",
          body: JSON.stringify({ imageBase64: fileBase64, fileType: "pdf" }),
        });
        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(typeof errData.error === "string" ? errData.error : "Document extraction failed");
        }
        const data = await response.json();
        extractedText = data.text || "";
      }
      setIsUploading(false);
      if (extractedText.trim()) {
        showDestinationPicker(fileName, extractedText);
      } else {
        showToast({ type: "warning", title: "No Text Found", message: "Could not extract text from the document." });
      }
    } catch (error: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ type: "error", title: "Error", message: error?.message || "Failed to process document." });
      setIsUploading(false);
    }
  };

  const handlePasteClipboard = () => {
    if (isUploading) return;
    setPasteText("");
    setShowPasteSheet(true);
  };

  const handleSubmitPastedText = () => {
    if (!pasteText.trim()) return;
    setShowPasteSheet(false);
    showDestinationPicker("Clipboard", pasteText.trim());
    setPasteText("");
  };

  const contentActions = [
    { key: "record", icon: "mic" as const, label: "Record", color: theme.error, onPress: handleRecord },
    { key: "camera", icon: "camera" as const, label: "Camera", color: theme.link, onPress: handleTakePhoto },
    { key: "gallery", icon: "image" as const, label: "Gallery", color: "#8B5CF6", onPress: handlePickGallery },
    { key: "file", icon: "upload" as const, label: "Upload", color: theme.success, onPress: handlePickDocument },
    { key: "clipboard", icon: "clipboard" as const, label: "Clipboard", color: theme.warning, onPress: handlePasteClipboard },
  ];


  const renderTabContent = () => {
    switch (activeTab) {
      case "notes":
        return (
          <ScrollView contentContainerStyle={{ paddingHorizontal: Spacing.lg, paddingBottom: insets.bottom + Spacing["4xl"] }}>
            <NotesTab
              notes={topicNotes}
              isGenerating={false}
              onGenerate={() => {
                showToast({ type: "info", title: "Upload content", message: "Use the actions above to add study material and generate notes." });
              }}
              onSaveNotes={async (updatedNotes) => {
                try {
                  const saved = await storage.updateNotes(topicId, {
                    title: updatedNotes.title,
                    sections: updatedNotes.sections,
                    favorite: updatedNotes.favorite,
                  });
                  if (!saved) {
                    showToast({ type: "error", title: "Error", message: "Notes not found. Try regenerating." });
                    return;
                  }
                  setTopicNotes(saved);
                  showToast({ type: "success", title: "Saved", message: "Notes updated successfully." });
                } catch (e) {
                  if (__DEV__) console.log("[TopicScreen] Failed to save notes:", e);
                  showToast({ type: "error", title: "Error", message: "Failed to save notes." });
                }
              }}
              onSendToWritingLab={(text, noteId) => {
                navigation.navigate("WritingLab", {
                  initialMode: "essay",
                  initialText: text,
                  sourceNoteId: noteId,
                  sourceTopicId: topicId,
                  sourceNoteTitle: topicNotes?.title,
                  sourceTopicName: topic?.name,
                });
              }}
              topicId={topicId}
              courseId={courseId}
            />
          </ScrollView>
        );
      case "flashcards":
        return (
          <View style={{ flex: 1, paddingHorizontal: Spacing.lg }}>
            <FlashcardsTab
              flashcards={topicFlashcards}
              isGenerating={false}
              onGenerate={() => {
                showToast({ type: "info", title: "Upload content", message: "Use the actions above to add study material and generate flashcards." });
              }}
            />
          </View>
        );
      case "quiz":
        return (
          <View style={{ flex: 1, paddingHorizontal: Spacing.lg }}>
            <QuizTab
              quizData={topicQuizData}
              isGenerating={false}
              onGenerate={() => {
                showToast({ type: "info", title: "Upload content", message: "Use the actions above to add study material and generate a quiz." });
              }}
            />
          </View>
        );
      default:
        return null;
    }
  };

  if (isLoading) {
    return <LoadingState fullScreen message="Loading topic..." />;
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <ScrollView
        stickyHeaderIndices={[1]}
        contentContainerStyle={{ paddingTop: headerHeight + Spacing.md, paddingBottom: 0, flexGrow: 1 }}
        scrollIndicatorInsets={{ bottom: insets.bottom }}
      >
        <View style={[styles.quickActionsSection, { paddingHorizontal: Spacing.lg }]}>
          <ThemedText type="caption" style={[styles.sectionLabel, { color: theme.textSecondary }]}>
            Add Content
          </ThemedText>
          <View style={styles.quickActionsRow}>
            {contentActions.map((action) => (
              <TouchableOpacity
                key={action.key}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); action.onPress(); }}
                disabled={isUploading}
                style={[styles.quickActionItem, isUploading && { opacity: 0.45 }]}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                testID={`button-topic-${action.key}`}
              >
                <View style={[styles.quickActionIconCircle, { backgroundColor: action.color }]}>
                  <Icon name={action.icon} size={20} color="#fff" />
                </View>
                <ThemedText type="caption" style={[styles.quickActionLabel, { color: theme.textSecondary }]} numberOfLines={1}>
                  {action.label}
                </ThemedText>
              </TouchableOpacity>
            ))}
          </View>


          {isUploading ? (
            <View style={[styles.uploadingBanner, { backgroundColor: theme.link + "15" }]}>
              <ActivityIndicator size="small" color={theme.link} />
              <ThemedText type="small" style={{ color: theme.link, marginLeft: Spacing.sm }}>
                {uploadingLabel}
              </ThemedText>
            </View>
          ) : null}
        </View>

        <View style={[styles.tabBarSticky, { backgroundColor: theme.backgroundRoot, paddingHorizontal: Spacing.lg }]}>
          <TabBar
            tabs={CONTENT_TABS}
            activeTab={activeTab}
            onTabChange={(key) => { setActiveTab(key); Haptics.selectionAsync(); }}
          />
        </View>

        <View style={styles.contentContainer}>
          {renderTabContent()}
        </View>
      </ScrollView>

      <BottomSheet
        visible={showPasteSheet}
        onClose={() => { setShowPasteSheet(false); setPasteText(""); }}
        title="Paste Text"
      >
        <ThemedText
          type="small"
          style={{ color: theme.textSecondary, marginBottom: Spacing.sm }}
        >
          Paste or type your study notes, then tap Generate
        </ThemedText>
        <TextInput
          testID="input-topic-paste-text"
          multiline
          numberOfLines={8}
          placeholder="Paste your text here..."
          placeholderTextColor={theme.textSecondary}
          value={pasteText}
          onChangeText={setPasteText}
          style={{
            color: theme.text,
            backgroundColor: theme.backgroundDefault,
            borderColor: theme.border,
            borderWidth: 1,
            borderRadius: BorderRadius.md,
            padding: Spacing.md,
            minHeight: 160,
            fontSize: 15,
          }}
          textAlignVertical="top"
          autoFocus
        />
        <Button
          onPress={handleSubmitPastedText}
          disabled={!pasteText.trim()}
          testID="button-topic-submit-paste"
          style={{ marginTop: Spacing.md }}
        >
          Generate Study Materials
        </Button>
      </BottomSheet>

      <ContentDestinationSheet
        visible={showDestinationSheet}
        onClose={() => {
          setShowDestinationSheet(false);
          setPendingContent(null);
        }}
        onSelect={handleDestinationSelect}
        sourceLabel={pendingContent?.source}
        topicName={topic?.name}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  quickActionsSection: {
    marginBottom: Spacing.md,
    paddingVertical: Spacing.md,
  },
  sectionLabel: {
    fontWeight: "700",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: Spacing.sm,
    marginLeft: Spacing.xs,
  },
  quickActionsRow: {
    flexDirection: "row",
    justifyContent: "flex-start",
    gap: Spacing.lg,
  },
  quickActionItem: {
    alignItems: "center",
    gap: 6,
  },
  quickActionIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  quickActionLabel: {
    fontSize: 11,
    fontWeight: "500",
  },
  uploadingBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
    marginTop: Spacing.sm,
  },
  tabBarSticky: {
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
  },
  contentContainer: {
    flex: 1,
    minHeight: 400,
  },
});
