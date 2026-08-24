import React, { useState, useCallback } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
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
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";

import { ThemedText } from "@/components/ThemedText";
import { ListItem } from "@/components/ListItem";
import { EmptyState } from "@/components/EmptyState";
import { BottomSheet } from "@/components/BottomSheet";
import {
  ContentDestinationSheet,
  type ContentDestination,
} from "@/components/ContentDestinationSheet";
import { Input } from "@/components/Input";
import { Button } from "@/components/Button";
import { StatusChip } from "@/components/StatusChip";
import { LoadingState } from "@/components/LoadingState";
import { TabBar } from "@/components/TabBar";
import { useTheme } from "@/hooks/useTheme";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/contexts/AuthContext";
import { storage } from "@/lib/storage";
import { createTopicWithServerSync, syncTopicToServer, ensureCourseOnServer } from "@/lib/serverSync";
import { getApiUrl, getAuthHeaders } from "@/lib/query-client";
import { Spacing, BorderRadius } from "@/constants/theme";
import type {
  Course,
  Topic,
  Notes,
  NotesSection,
  Flashcard,
  Quiz,
  QuizQuestion,
} from "@/types";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import NotesTab from "@/components/lecture/NotesTab";
import FlashcardsTab from "@/components/lecture/FlashcardsTab";
import QuizTab from "@/components/lecture/QuizTab";

const CONTENT_TABS = [
  { key: "topics", label: "Topics" },
  { key: "notes", label: "Notes" },
  { key: "flashcards", label: "Cards" },
  { key: "quiz", label: "Quiz" },
];

export default function CourseScreen() {
  const { theme } = useTheme();
  const { showToast } = useToast();
  const { getAuthToken } = useAuth();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const route = useRoute<any>();
  const { courseId } = route.params;

  const [course, setCourse] = useState<Course | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddTopicSheet, setShowAddTopicSheet] = useState(false);
  const [showRecordSheet, setShowRecordSheet] = useState(false);
  const [topicName, setTopicName] = useState("");
  const [activeTab, setActiveTab] = useState("topics");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadingLabel, setUploadingLabel] = useState("Processing...");
  const [showDeleteTopicSheet, setShowDeleteTopicSheet] = useState(false);
  const [deleteTopicTarget, setDeleteTopicTarget] = useState<Topic | null>(null);
  const [showRenameCourseSheet, setShowRenameCourseSheet] = useState(false);
  const [renameCourseNameInput, setRenameCourseNameInput] = useState("");
  const [showRenameTopicSheet, setShowRenameTopicSheet] = useState(false);
  const [renameTopicTarget, setRenameTopicTarget] = useState<Topic | null>(null);
  const [renameTopicNameInput, setRenameTopicNameInput] = useState("");
  const [showDestinationSheet, setShowDestinationSheet] = useState(false);
  const [pendingContent, setPendingContent] = useState<{
    text: string;
    source: string;
    imageUri?: string;
  } | null>(null);

  const [allNotes, setAllNotes] = useState<Notes[]>([]);
  const [allFlashcards, setAllFlashcards] = useState<Flashcard[]>([]);
  const [allQuizData, setAllQuizData] = useState<{
    quiz: Quiz;
    questions: QuizQuestion[];
  } | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [loadedCourse, loadedTopics] = await Promise.all([
        storage.getCourse(courseId),
        storage.getTopicsByCourse(courseId),
      ]);
      setCourse(loadedCourse);
      setTopics(loadedTopics);

      const topicIds = loadedTopics.map((t) => t.id);
      if (topicIds.length > 0) {
        const [notes, flashcards, quizData] = await Promise.all([
          storage.getNotesByTopics(topicIds),
          storage.getFlashcardsByTopics(topicIds),
          storage.getQuizByTopics(topicIds),
        ]);
        setAllNotes(notes);
        setAllFlashcards(flashcards);
        setAllQuizData(quizData);
      } else {
        setAllNotes([]);
        setAllFlashcards([]);
        setAllQuizData(null);
      }
    } finally {
      setIsLoading(false);
    }
  }, [courseId]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  React.useLayoutEffect(() => {
    if (course) {
      navigation.setOptions({
        headerTitle: course.name,
        headerRight: () => (
          <Pressable
            onPress={() => {
              setRenameCourseNameInput(course.name);
              setShowRenameCourseSheet(true);
            }}
            hitSlop={8}
            style={{ padding: Spacing.xs }}
            accessibilityLabel="Rename course"
            accessibilityRole="button"
          >
            <Icon name="edit-2" size={18} color={theme.link} />
          </Pressable>
        ),
      });
    }
  }, [navigation, course, theme.link]);

  const ensureTopicForCourse = async (): Promise<string | null> => {
    if (topics.length > 0) return topics[0].id;
    try {
      const user = await storage.getUser();
      if (!user) return null;
      const token = await getAuthToken();
      try {
        const newTopic = await createTopicWithServerSync(
          {
            userId: user.id,
            courseId,
            name: "General",
            orderIndex: 0,
            status: "pending",
          },
          token,
        );
        await loadData();
        return newTopic.id;
      } catch {
        const localTopic = await storage.createTopic({
          userId: user.id,
          courseId,
          name: "General",
          orderIndex: 0,
          status: "pending",
        });
        await loadData();
        return localTopic.id;
      }
    } catch {
      showToast({
        type: "error",
        title: "Error",
        message: "Could not set up. Please try again.",
      });
      return null;
    }
  };

  const handleRecord = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const topicId = await ensureTopicForCourse();
      if (!topicId) return;

      const currentTopics =
        topics.length > 0 ? topics : await storage.getTopicsByCourse(courseId);

      if (currentTopics.length === 1) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        navigation.navigate("Record", { topicId });
      } else {
        setShowRecordSheet(true);
      }
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({
        type: "error",
        title: "Failed",
        message: "Could not start recording",
      });
    }
  };

  const handleTakePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        showToast({
          type: "warning",
          title: Platform.OS !== "web" ? "Permission needed" : "Not available",
          message:
            Platform.OS !== "web"
              ? "Please allow camera access to capture notes."
              : "Camera capture is not available on web. Use file upload instead.",
        });
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        setIsUploading(true);
        setUploadingLabel("Extracting text from image...");
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        try {
          const ocrText = await extractImageText(result.assets[0].uri);
          setIsUploading(false);
          if (ocrText.trim().length >= 20) {
            showDestinationPicker("Camera", ocrText, result.assets[0].uri);
          } else {
            showToast({
              type: "warning",
              title: "Not Enough Text",
              message: "Could not extract enough text from the image.",
            });
          }
        } catch (error: any) {
          setIsUploading(false);
          throw error;
        }
      }
    } catch {
      showToast({
        type: "error",
        title: "Error",
        message: "Failed to capture image.",
      });
    }
  };

  const handlePickGallery = async () => {
    try {
      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        showToast({
          type: "warning",
          title: "Permission needed",
          message: "Allow access to your photo library.",
        });
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        setIsUploading(true);
        setUploadingLabel("Extracting text from image...");
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        try {
          const ocrText = await extractImageText(result.assets[0].uri);
          setIsUploading(false);
          if (ocrText.trim().length >= 20) {
            showDestinationPicker("Gallery", ocrText, result.assets[0].uri);
          } else {
            showToast({
              type: "warning",
              title: "Not Enough Text",
              message: "Could not extract enough text from the image.",
            });
          }
        } catch (error: any) {
          setIsUploading(false);
          throw error;
        }
      }
    } catch {
      showToast({
        type: "error",
        title: "Error",
        message: "Failed to pick image.",
      });
    }
  };

  const readFileAsBase64 = async (uri: string): Promise<string> => {
    if (Platform.OS !== "web") {
      return FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
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

  const generateStudyMaterials = async (
    text: string,
    topicId: string,
    sectionLabel?: string,
  ) => {
    if (!text || text.trim().length < 20) return;
    const authHeaders = await getAuthHeaders();
    setUploadingLabel("Generating study materials...");

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
          body: JSON.stringify({ text, topicId }),
        }),
        fetch(new URL("/api/ai/notes-to-quiz", getApiUrl()).toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          credentials: "include",
          body: JSON.stringify({ text, topicId }),
        }),
      ]);

      if (notesRes.status === "fulfilled" && notesRes.value.ok) {
        const data = await notesRes.value.json();
        if (data.summary) {
          const summaryBullets = data.summary
            .split(/\n+/)
            .filter((line: string) => line.trim());
          const timestamp = new Date().toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          });
          const heading = sectionLabel
            ? `${sectionLabel} (${timestamp})`
            : `Notes (${timestamp})`;
          await storage.saveNotes({
            topicId,
            title: "Study Notes",
            sections: [{ heading, bullets: summaryBullets }],
          });
        }
      }

      if (flashcardsRes.status === "fulfilled" && flashcardsRes.value.ok) {
        const data = await flashcardsRes.value.json();
        if (data.flashcards && data.flashcards.length > 0) {
          await storage.saveFlashcards(
            topicId,
            data.flashcards.map((c: any, i: number) => ({
              question: c.front,
              answer: c.back,
              orderIndex: i,
            })),
          );
        }
      }

      if (quizRes.status === "fulfilled" && quizRes.value.ok) {
        const data = await quizRes.value.json();
        if (data.questions && data.questions.length > 0) {
          await storage.saveQuiz(
            topicId,
            data.questions.map((q: any) => ({
              question: q.question,
              options: q.options,
              correctIndex:
                typeof q.correctAnswer === "number" ? q.correctAnswer : 0,
            })),
          );
        }
      }
      await storage.updateTopic(topicId, { status: "completed" });
      if (__DEV__) console.log("[CourseScreen] Topic status -> completed after generateStudyMaterials");
    } catch (err) {
      console.log("Study material generation partial failure:", err);
    }
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
          {
            userId: user.id,
            courseId,
            name,
            orderIndex: topics.length,
            status: "pending",
          },
          token,
        );
        await loadData();
        return newTopic.id;
      } catch {
        const localTopic = await storage.createTopic({
          userId: user.id,
          courseId,
          name,
          orderIndex: topics.length,
          status: "pending",
        });
        await loadData();
        return localTopic.id;
      }
    } catch {
      return null;
    }
  };

  const handleDestinationSelect = async (destination: ContentDestination) => {
    setShowDestinationSheet(false);
    if (!pendingContent) return;

    const { text, source, imageUri } = pendingContent;
    setPendingContent(null);

    setIsUploading(true);
    setUploadingLabel("Generating study materials...");

    try {
      let targetTopicId: string | null = null;

      if (destination === "new-topic") {
        targetTopicId = await createNewTopicForContent(source);
        if (!targetTopicId) {
          showToast({
            type: "error",
            title: "Error",
            message: "Could not create a new topic.",
          });
          return;
        }
      } else {
        targetTopicId = await ensureTopicForCourse();
        if (!targetTopicId) return;
      }

      await storage.saveWhiteboardImage({
        topicId: targetTopicId,
        imagePath: imageUri || "",
        ocrText: text,
      });

      const sectionLabel =
        destination === "new-section" ? source : undefined;
      await generateStudyMaterials(text, targetTopicId, sectionLabel);
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
      loadData();
    } catch (error: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({
        type: "error",
        title: "Error",
        message: error?.message || "Failed to generate study materials.",
      });
    } finally {
      setIsUploading(false);
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

  const extractImageText = async (uri: string): Promise<string> => {
    const compressedUri = await compressImage(uri);
    const imageBase64 = await readFileAsBase64(compressedUri);
    const authHeaders = await getAuthHeaders();
    const response = await fetch(
      new URL("/api/ai/ocr/extract", getApiUrl()).toString(),
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        credentials: "include",
        body: JSON.stringify({ imageBase64 }),
      },
    );
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(
        typeof errData.error === "string"
          ? errData.error
          : "OCR extraction failed",
      );
    }
    const data = await response.json();
    return data.text || "";
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
        showToast({
          type: "warning",
          title: "File Too Large",
          message: "Please choose a file under 40 MB.",
        });
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
          setIsUploading(false);
          if (ocrText.trim().length >= 20) {
            showDestinationPicker("Upload", ocrText, asset.uri);
          } else {
            showToast({
              type: "warning",
              title: "Not Enough Text",
              message: "Could not extract enough text from the image.",
            });
          }
        } catch (error: any) {
          setIsUploading(false);
          throw error;
        }
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
              fileType: "pdf",
            }),
          },
        );
        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(
            typeof errData.error === "string"
              ? errData.error
              : "Document extraction failed",
          );
        }
        const data = await response.json();
        extractedText = data.text || "";
      }

      setIsUploading(false);
      if (extractedText.trim()) {
        showDestinationPicker(fileName, extractedText);
      } else {
        showToast({
          type: "warning",
          title: "No Text Found",
          message: "Could not extract text from the document.",
        });
      }
    } catch (error: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({
        type: "error",
        title: "Error",
        message: error?.message || "Failed to process document.",
      });
      setIsUploading(false);
    }
  };

  const handlePasteClipboard = async () => {
    try {
      const clipboardText = await Clipboard.getStringAsync();
      if (!clipboardText || !clipboardText.trim()) {
        showToast({
          type: "info",
          title: "Empty Clipboard",
          message: "No text found in your clipboard. Copy some text first.",
        });
        return;
      }

      showDestinationPicker("Clipboard", clipboardText.trim());
    } catch {
      showToast({
        type: "error",
        title: "Error",
        message: "Failed to read clipboard.",
      });
    }
  };

  const handleAddTopic = async () => {
    if (!topicName.trim()) return;
    try {
      const user = await storage.getUser();
      if (!user) return;
      const token = await getAuthToken();
      await createTopicWithServerSync(
        {
          userId: user.id,
          courseId,
          name: topicName.trim(),
          orderIndex: topics.length,
          status: "pending",
        },
        token,
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({
        type: "success",
        title: "Topic created!",
        message: "Ready to add study materials",
      });
      setTopicName("");
      setShowAddTopicSheet(false);
      loadData();
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({
        type: "error",
        title: "Failed",
        message: "Could not create topic",
      });
    }
  };

  const handleDeleteTopic = (topic: Topic) => {
    setDeleteTopicTarget(topic);
    setShowDeleteTopicSheet(true);
  };

  const handleRenameCourse = async () => {
    const trimmed = renameCourseNameInput.trim();
    if (!trimmed || !course) return;
    const updated = await storage.updateCourse(course.id, { name: trimmed });
    if (updated) {
      setCourse(updated);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({ type: "success", title: "Renamed", message: "Course updated" });
      const token = await getAuthToken();
      ensureCourseOnServer(updated.id, token).catch((err) =>
        console.warn("[Rename] Failed to sync course name to server:", err),
      );
    }
    setShowRenameCourseSheet(false);
  };

  const openRenameTopic = (topic: Topic) => {
    setRenameTopicTarget(topic);
    setRenameTopicNameInput(topic.name);
    setShowRenameTopicSheet(true);
  };

  const handleRenameTopic = async () => {
    const trimmed = renameTopicNameInput.trim();
    if (!trimmed || !renameTopicTarget) return;
    const updated = await storage.updateTopic(renameTopicTarget.id, { name: trimmed });
    if (updated) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({ type: "success", title: "Renamed", message: "Topic updated" });
      const token = await getAuthToken();
      syncTopicToServer(
        { id: updated.id, name: updated.name, courseId: updated.courseId },
        token,
      ).catch((err) =>
        console.warn("[Rename] Failed to sync topic name to server:", err),
      );
    }
    setShowRenameTopicSheet(false);
    setRenameTopicTarget(null);
    loadData();
  };

  const confirmDeleteTopic = async () => {
    if (!deleteTopicTarget) return;
    setShowDeleteTopicSheet(false);
    await storage.deleteTopic(deleteTopicTarget.id);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast({
      type: "success",
      title: "Deleted",
      message: "Topic removed",
    });
    setDeleteTopicTarget(null);
    loadData();
  };

  const handleQuickRecord = async (topicId: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast({
      type: "success",
      title: "Starting recording",
      message: "Recording for this topic...",
    });
    setShowRecordSheet(false);
    navigation.navigate("Record", { topicId });
  };

  const getStatusChip = (status: Topic["status"]) => {
    switch (status) {
      case "completed":
        return <StatusChip label="Ready" variant="success" icon="check" />;
      case "transcribing":
        return <StatusChip label="Processing" variant="info" icon="loader" />;
      default:
        return <StatusChip label="New" variant="default" icon="circle" />;
    }
  };

  const sectionTopicMap: string[] = allNotes.flatMap((n) =>
    n.sections.map(() => n.topicId),
  );

  const combinedNotes: Notes | null =
    allNotes.length > 0
      ? {
          id: "combined",
          topicId: "combined",
          title: course?.name || "Course Notes",
          sections: allNotes.flatMap((n) => n.sections),
          createdAt: allNotes[0].createdAt,
        }
      : null;

  const contentActions = [
    {
      label: "Record",
      icon: "mic" as const,
      color: theme.error,
      onPress: handleRecord,
      testID: "button-course-record",
    },
    {
      label: "Camera",
      icon: "camera" as const,
      color: theme.link,
      onPress: handleTakePhoto,
      testID: "button-course-camera",
    },
    {
      label: "Gallery",
      icon: "image" as const,
      color: "#8B5CF6",
      onPress: handlePickGallery,
      testID: "button-course-gallery",
    },
    {
      label: "Upload",
      icon: "upload" as const,
      color: theme.success,
      onPress: handlePickDocument,
      testID: "button-course-upload",
    },
    {
      label: "Clipboard",
      icon: "clipboard" as const,
      color: theme.warning,
      onPress: handlePasteClipboard,
      testID: "button-course-clipboard",
    },
  ];


  const renderTopic = ({ item }: { item: Topic }) => (
    <View style={styles.topicRow}>
      <View style={styles.topicRowMain}>
        <ListItem
          title={item.name}
          subtitle={new Date(item.createdAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
          leftIcon="folder"
          leftIconColor={course?.color}
          rightContent={getStatusChip(item.status)}
          onPress={() =>
            navigation.navigate("Topic", { topicId: item.id, courseId })
          }
          onLongPress={() => openRenameTopic(item)}
          style={styles.topicRowItem}
        />
      </View>
      <Pressable
        onPress={() => openRenameTopic(item)}
        hitSlop={8}
        style={({ pressed }) => [
          styles.topicDeleteBtn,
          { opacity: pressed ? 0.5 : 1 },
        ]}
        accessibilityLabel={`Rename ${item.name}`}
        accessibilityRole="button"
      >
        <Icon name="edit-2" size={18} color={theme.link} />
      </Pressable>
      <Pressable
        onPress={() => handleDeleteTopic(item)}
        hitSlop={8}
        style={({ pressed }) => [
          styles.topicDeleteBtn,
          { opacity: pressed ? 0.5 : 1 },
        ]}
        accessibilityLabel={`Delete ${item.name}`}
        accessibilityRole="button"
      >
        <Icon name="trash-2" size={18} color="#EF4444" />
      </Pressable>
    </View>
  );

  const renderTopicsTab = () => {
    if (topics.length === 0) {
      return (
        <ScrollView
          contentContainerStyle={[
            styles.emptyTabContainer,
            // Extra clearance below the floating "Mind Map" button
            // (which sits at insets.bottom + Spacing.xl, ~46px tall) so the
            // "Add Topic" button never renders underneath it.
            { paddingBottom: insets.bottom + Spacing["4xl"] + 60 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <EmptyState
            image={require("../../assets/images/empty-lectures.png")}
            title="Organize Your Topics"
            description="Create topics like 'Week 1' or 'Intro to Chemistry' to record lectures, generate notes, flashcards, and quizzes automatically."
            buttonLabel="Add Topic"
            onButtonPress={() => setShowAddTopicSheet(true)}
          />
        </ScrollView>
      );
    }

    return (
      <FlatList
        data={topics}
        renderItem={renderTopic}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.topicsList,
          { paddingBottom: insets.bottom + Spacing["4xl"] },
        ]}
        scrollIndicatorInsets={{ bottom: insets.bottom }}
        ListFooterComponent={
          <Pressable
            style={[styles.addTopicButton, { borderColor: theme.border }]}
            onPress={() => {
              Haptics.selectionAsync();
              setShowAddTopicSheet(true);
            }}
          >
            <Icon name="plus" size={18} color={theme.link} />
            <ThemedText
              type="body"
              style={[styles.addTopicText, { color: theme.link }]}
            >
              Add Topic
            </ThemedText>
          </Pressable>
        }
      />
    );
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case "topics":
        return renderTopicsTab();

      case "notes":
        return (
          <ScrollView
            contentContainerStyle={{
              paddingHorizontal: Spacing.lg,
              paddingBottom: insets.bottom + Spacing["4xl"],
              flexGrow: 1,
            }}
          >
            <NotesTab
              notes={combinedNotes}
              isGenerating={false}
              onGenerate={() => {
                showToast({
                  type: "info",
                  title: "Generate from topics",
                  message:
                    "Open a topic to generate notes from its content.",
                });
              }}
              onSaveNotes={async (updatedNotes) => {
                try {
                  const grouped: Record<string, NotesSection[]> = {};
                  updatedNotes.sections.forEach((section, i) => {
                    const tid = sectionTopicMap[i] || allNotes[allNotes.length - 1]?.topicId;
                    if (!tid) return;
                    if (!grouped[tid]) grouped[tid] = [];
                    grouped[tid].push(section);
                  });
                  let anyFailed = false;
                  for (const [tid, sections] of Object.entries(grouped)) {
                    const saved = await storage.updateNotes(tid, { sections });
                    if (!saved) anyFailed = true;
                  }
                  loadData();
                  if (anyFailed) {
                    showToast({ type: "warning", title: "Partial save", message: "Some notes could not be found." });
                  } else {
                    showToast({ type: "success", title: "Saved", message: "Notes updated successfully." });
                  }
                } catch (e) {
                  if (__DEV__) console.log("[CourseScreen] Failed to save notes:", e);
                  showToast({ type: "error", title: "Error", message: "Failed to save notes." });
                }
              }}
            />
          </ScrollView>
        );

      case "flashcards":
        return (
          <View style={styles.tabFillContainer}>
            <View style={styles.tabInnerContainer}>
              <FlashcardsTab
                flashcards={allFlashcards}
                isGenerating={false}
                onGenerate={() => {
                  showToast({
                    type: "info",
                    title: "Generate from topics",
                    message:
                      "Open a topic to generate flashcards from its content.",
                  });
                }}
              />
            </View>
          </View>
        );

      case "quiz":
        return (
          <View style={styles.tabFillContainer}>
            <View style={styles.tabInnerContainer}>
              <QuizTab
                quizData={allQuizData}
                isGenerating={false}
                onGenerate={() => {
                  showToast({
                    type: "info",
                    title: "Generate from topics",
                    message:
                      "Open a topic to generate a quiz from its content.",
                  });
                }}
              />
            </View>
          </View>
        );

      default:
        return null;
    }
  };

  if (isLoading) {
    return <LoadingState fullScreen message="Loading course..." />;
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <View
        style={[
          styles.headerContent,
          {
            paddingTop: headerHeight + Spacing.md,
            backgroundColor: theme.backgroundRoot,
          },
        ]}
      >
        <View style={[styles.quickActionsContainer, { paddingHorizontal: Spacing.lg }]}>
          <ThemedText
            type="caption"
            style={[styles.quickActionsSectionLabel, { color: theme.textSecondary }]}
          >
            Add Content
          </ThemedText>
          <View style={styles.quickActionsRow}>
            {contentActions.map((action) => (
              <Pressable
                key={action.label}
                style={styles.quickAction}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  action.onPress();
                }}
                disabled={isUploading}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                testID={action.testID}
              >
                <View
                  style={[
                    styles.quickActionIcon,
                    { backgroundColor: action.color },
                  ]}
                >
                  <Icon name={action.icon} size={20} color="#fff" />
                </View>
                <ThemedText
                  type="caption"
                  style={[styles.quickActionLabel, { color: theme.textSecondary }]}
                >
                  {action.label}
                </ThemedText>
              </Pressable>
            ))}
          </View>

          {isUploading ? (
            <View
              style={[
                styles.uploadingBanner,
                { backgroundColor: theme.link + "15" },
              ]}
            >
              <ActivityIndicator size="small" color={theme.link} />
              <ThemedText
                type="small"
                style={{ color: theme.link, marginLeft: Spacing.sm }}
              >
                {uploadingLabel}
              </ThemedText>
            </View>
          ) : null}
        </View>

        <View
          style={[
            styles.tabBarSticky,
            {
              backgroundColor: theme.backgroundRoot,
              paddingHorizontal: Spacing.lg,
            },
          ]}
        >
          <TabBar
            tabs={CONTENT_TABS}
            activeTab={activeTab}
            onTabChange={(key) => {
              setActiveTab(key);
              Haptics.selectionAsync();
            }}
          />
        </View>
      </View>

      <View style={styles.contentContainer}>{renderTabContent()}</View>

      <BottomSheet
        visible={showAddTopicSheet}
        onClose={() => {
          setShowAddTopicSheet(false);
          setTopicName("");
        }}
        title="New Topic"
      >
        <Input
          label="Topic Name"
          placeholder="e.g., Introduction, Data Structures"
          value={topicName}
          onChangeText={setTopicName}
          autoFocus
        />
        <Button
          onPress={handleAddTopic}
          disabled={!topicName.trim()}
          size="lg"
          fullWidth
        >
          Create Topic
        </Button>
      </BottomSheet>

      <BottomSheet
        visible={showRenameCourseSheet}
        onClose={() => setShowRenameCourseSheet(false)}
        title="Rename Course"
      >
        <Input
          label="Course Name"
          placeholder="e.g., Introduction to Computer Science"
          value={renameCourseNameInput}
          onChangeText={setRenameCourseNameInput}
          autoFocus
        />
        <Button
          onPress={handleRenameCourse}
          disabled={!renameCourseNameInput.trim()}
          size="lg"
          fullWidth
        >
          Save
        </Button>
      </BottomSheet>

      <BottomSheet
        visible={showRenameTopicSheet}
        onClose={() => {
          setShowRenameTopicSheet(false);
          setRenameTopicTarget(null);
        }}
        title="Rename Topic"
      >
        <Input
          label="Topic Name"
          placeholder="e.g., Introduction, Data Structures"
          value={renameTopicNameInput}
          onChangeText={setRenameTopicNameInput}
          autoFocus
        />
        <Button
          onPress={handleRenameTopic}
          disabled={!renameTopicNameInput.trim()}
          size="lg"
          fullWidth
        >
          Save
        </Button>
      </BottomSheet>

      <BottomSheet
        visible={showRecordSheet}
        onClose={() => setShowRecordSheet(false)}
        title="Record for Topic"
      >
        <ThemedText
          type="small"
          style={{ color: theme.textSecondary, marginBottom: Spacing.md }}
        >
          Select a topic to start recording
        </ThemedText>
        {topics.map((topic) => (
          <ListItem
            key={topic.id}
            title={topic.name}
            leftIcon="folder"
            leftIconColor={course?.color}
            onPress={() => handleQuickRecord(topic.id)}
          />
        ))}
        {topics.length === 0 ? (
          <View style={{ paddingVertical: Spacing.xl, alignItems: "center" }}>
            <ThemedText
              type="body"
              style={{ color: theme.textSecondary, textAlign: "center" }}
            >
              Add a topic first to start recording.
            </ThemedText>
            <Button
              variant="secondary"
              onPress={() => {
                setShowRecordSheet(false);
                setShowAddTopicSheet(true);
              }}
              style={{ marginTop: Spacing.lg }}
            >
              Add Topic
            </Button>
          </View>
        ) : null}
      </BottomSheet>

      <TouchableOpacity
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          navigation.navigate("Mindmap", { courseId });
        }}
        style={[
          styles.floatingMapButton,
          {
            backgroundColor: theme.link,
            bottom: insets.bottom + Spacing.xl,
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Open mind map"
      >
        <Icon name="share-2" size={18} color="#fff" />
        <ThemedText style={styles.floatingButtonText}>Mind Map</ThemedText>
      </TouchableOpacity>

      <BottomSheet
        visible={showDeleteTopicSheet}
        onClose={() => {
          setShowDeleteTopicSheet(false);
          setDeleteTopicTarget(null);
        }}
        title="Delete Topic?"
      >
        <ThemedText
          type="body"
          style={{ color: theme.textSecondary, marginBottom: Spacing.lg }}
        >
          {deleteTopicTarget
            ? `This will permanently delete "${deleteTopicTarget.name}" and all its content.`
            : ""}
        </ThemedText>
        <Button variant="destructive" fullWidth onPress={confirmDeleteTopic}>
          Delete
        </Button>
        <Button
          variant="ghost"
          fullWidth
          onPress={() => {
            setShowDeleteTopicSheet(false);
            setDeleteTopicTarget(null);
          }}
          style={{ marginTop: Spacing.sm }}
        >
          Cancel
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
        topicName={topics.length > 0 ? topics[0].name : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerContent: {
    zIndex: 1,
  },
  quickActionsContainer: {
    marginBottom: Spacing.md,
  },
  quickActionsSectionLabel: {
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: Spacing.sm,
    fontSize: 11,
    marginLeft: Spacing.xs,
  },
  quickActionsRow: {
    flexDirection: "row",
    justifyContent: "flex-start",
    gap: Spacing.lg,
  },
  quickAction: {
    alignItems: "center",
    gap: 6,
  },
  quickActionIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
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
  tabFillContainer: {
    flex: 1,
  },
  tabInnerContainer: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
  },
  emptyTabContainer: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing["3xl"],
  },
  topicsList: {
    paddingHorizontal: Spacing.lg,
    flexGrow: 1,
  },
  topicRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  topicRowMain: {
    flex: 1,
  },
  topicRowItem: {
    marginBottom: 0,
  },
  topicDeleteBtn: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.md,
    marginLeft: 4,
  },
  addTopicButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.lg,
    marginTop: Spacing["2xl"],
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: BorderRadius.md,
    gap: Spacing.sm,
  },
  addTopicText: {
    fontWeight: "600",
  },
  floatingMapButton: {
    position: "absolute",
    right: Spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.full,
    elevation: 4,
  },
  floatingButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 14,
  },
});