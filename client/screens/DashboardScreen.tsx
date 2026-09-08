import React, { useState, useCallback, useRef, useMemo, useEffect } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
  ActivityIndicator,
  TextInput,
  Modal,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Icon } from "@/components/Icon";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as FileSystem from "expo-file-system/legacy";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";

import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { BottomSheet } from "@/components/BottomSheet";
import { Input } from "@/components/Input";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { SectionHeader } from "@/components/SectionHeader";
import { LoadingState } from "@/components/LoadingState";
import { SkeletonCard, SkeletonList } from "@/components/Skeleton";
import { ListItem } from "@/components/ListItem";
import { StatusChip } from "@/components/StatusChip";
import { useTheme } from "@/hooks/useTheme";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/contexts/AuthContext";
import { storage } from "@/lib/storage";
import { createTopicWithServerSync } from "@/lib/serverSync";
import { getApiUrl, getAuthHeaders } from "@/lib/query-client";
import { Spacing, BorderRadius } from "@/constants/theme";
import type { Semester, Course, Topic } from "@/types";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

const ONBOARDING_KEY = "@studymind_onboarded";

interface NextAction {
  type: "record" | "study" | "continue" | "create";
  title: string;
  subtitle: string;
  icon: string;
  color: string;
  onPress: () => void;
}

export default function DashboardScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const { user, getAuthToken } = useAuth();
  const { showToast } = useToast();

  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [showQuickRecordSheet, setShowQuickRecordSheet] = useState(false);
  const [showCoursePickerSheet, setShowCoursePickerSheet] = useState(false);
  const [showTopicPickerSheet, setShowTopicPickerSheet] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [pendingCourseId, setPendingCourseId] = useState<string | null>(null);
  const [semesterName, setSemesterName] = useState("");
  const [showPasteSheet, setShowPasteSheet] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteTargetCourseId, setPasteTargetCourseId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [processingSteps, setProcessingSteps] = useState<string[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [totalFlashcardCount, setTotalFlashcardCount] = useState(0);
  const [dueFlashcardCount, setDueFlashcardCount] = useState<number | null>(null);
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState<boolean | null>(null);

  const isMounted = useRef(true);
  const ensureFullSetupInFlight = useRef<Promise<{ courseId: string; topicId: string } | null> | null>(null);
  const ensureTopicForCourseInFlight = useRef<Record<string, Promise<string | null> | undefined>>({});
  const flashcardLoadId = useRef(0);
  const cancelledRef = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_KEY)
      .then((val) => setHasSeenOnboarding(val === "true"))
      .catch(() => setHasSeenOnboarding(true));
  }, []);

  const dismissOnboarding = async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, "true").catch(() => {});
    setHasSeenOnboarding(true);
  };

  // ─── Processing helpers ────────────────────────────────────────────────────

  const startProcessing = (steps: string[]) => {
    cancelledRef.current = false;
    setProcessingSteps(steps);
    setCurrentStepIndex(0);
    setIsUploading(true);
  };

  const advanceStep = (idx: number) => setCurrentStepIndex(idx);

  const cancelProcessing = () => {
    cancelledRef.current = true;
    setIsUploading(false);
    setProcessingSteps([]);
    showToast({ type: "info", title: "Cancelled", message: "Processing stopped." });
  };

  // ─── Data loading ──────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    try {
      await storage.recoverStuckTopics();
      const [loadedSemesters, loadedCourses, loadedTopics] =
        await Promise.all([
          storage.getSemesters(),
          storage.getCourses(),
          storage.getTopics(),
        ]);
      if (!isMounted.current) return;
      setSemesters(
        loadedSemesters.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        ),
      );
      setCourses(loadedCourses);
      setTopics(loadedTopics);

      const currentLoadId = ++flashcardLoadId.current;
      let cardCount = 0;
      try {
        const allCards = await storage.getAllFlashcards();
        cardCount = allCards.length;
        if (isMounted.current && flashcardLoadId.current === currentLoadId) {
          setTotalFlashcardCount(cardCount);
        }
      } catch {
        if (isMounted.current && flashcardLoadId.current === currentLoadId) {
          setTotalFlashcardCount(0);
        }
      }

      // Real due-for-review count from the SM-2 engine (server/adaptive.ts) —
      // null (not 0) when it can't be determined (offline/guest), so
      // getNextAction() falls back to the legacy "has any flashcards" copy
      // instead of wrongly claiming "all caught up".
      if (cardCount > 0) {
        try {
          const authHeaders = await getAuthHeaders();
          const response = await fetch(
            new URL("/api/adaptive/study-today", getApiUrl()).toString(),
            { headers: authHeaders, credentials: "include" },
          );
          const due = response.ok
            ? (await response.json())?.studyStats?.totalFlashcardsDue ?? null
            : null;
          if (isMounted.current && flashcardLoadId.current === currentLoadId) {
            setDueFlashcardCount(typeof due === "number" ? due : null);
          }
        } catch {
          if (isMounted.current && flashcardLoadId.current === currentLoadId) {
            setDueFlashcardCount(null);
          }
        }
      } else if (isMounted.current && flashcardLoadId.current === currentLoadId) {
        setDueFlashcardCount(null);
      }
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      isMounted.current = true;
      loadData();
      return () => {
        isMounted.current = false;
      };
    }, [loadData]),
  );

  const getCourseCount = (semesterId: string) => {
    return courses.filter((c) => c.semesterId === semesterId).length;
  };

  const completedTopics = useMemo(() => topics.filter((t) => t.status === "completed"), [topics]);
  const hasContent = topics.length > 0 || courses.length > 0;
  const hasStats = topics.length > 0 || totalFlashcardCount > 0 || courses.length > 0;

  const getNextAction = (): NextAction | null => {
    if (dueFlashcardCount !== null) {
      if (dueFlashcardCount > 0) {
        return {
          type: "study",
          title: `${dueFlashcardCount} card${dueFlashcardCount > 1 ? "s" : ""} due for review`,
          subtitle: "Tap to review what's due today",
          icon: "book-open",
          color: theme.success,
          onPress: () => navigation.navigate("StudyToday"),
        };
      }
      if (totalFlashcardCount > 0) {
        return {
          type: "study",
          title: "You're all caught up!",
          subtitle: "Nothing due for review right now",
          icon: "check-circle",
          color: theme.success,
          onPress: () => navigation.navigate("StudyToday"),
        };
      }
    } else if (totalFlashcardCount > 0) {
      // Due-date data unavailable (offline/guest) — fall back to the
      // raw-count copy rather than guessing at what's actually due.
      return {
        type: "study",
        title: "Time to Study!",
        subtitle: `${totalFlashcardCount} flashcard${totalFlashcardCount > 1 ? "s" : ""} ready`,
        icon: "book-open",
        color: theme.success,
        onPress: () => navigation.navigate("StudyToday"),
      };
    }

    const processingTopic = topics.find(
      (t) => t.status === "transcribing" || t.status === "pending",
    );
    if (processingTopic) {
      return {
        type: "continue",
        title: "Finish Your Topic",
        subtitle: `"${processingTopic.name}" needs attention`,
        icon: "loader",
        color: theme.info,
        onPress: () =>
          navigation.navigate("Topic", { topicId: processingTopic.id, courseId: processingTopic.courseId }),
      };
    }

    if (topics.length > 0) {
      return {
        type: "record",
        title: "Record a Topic",
        subtitle: "Tap to start capturing",
        icon: "mic",
        color: theme.error,
        onPress: () => handleQuickRecord(),
      };
    }

    return null;
  };

  const ensureFullSetup = async (): Promise<{ courseId: string; topicId: string } | null> => {
    // Several "add content" buttons can each call this before `loadData()`
    // updates component state — without sharing one in-flight run, each
    // call sees an empty semesters/courses/topics list and creates its own
    // duplicate "My Studies" / "General" default setup.
    if (ensureFullSetupInFlight.current) return ensureFullSetupInFlight.current;

    const run = async (): Promise<{ courseId: string; topicId: string } | null> => {
      try {
        const currentUser = await storage.getUser();
        if (!currentUser) return null;

        // Re-fetch fresh from storage rather than trusting closure state,
        // which may already be stale by the time this runs.
        let currentSemesters = await storage.getSemesters();
        let currentCourses = await storage.getCourses();
        let currentTopics = await storage.getTopics();

        if (currentSemesters.length === 0) {
          const newSemester = await storage.createSemester({
            userId: currentUser.id,
            name: "My Studies",
            startDate: new Date().toISOString(),
            endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          });
          currentSemesters = [newSemester];
        }

        if (currentCourses.length === 0) {
          const newCourse = await storage.createCourse({
            userId: currentUser.id,
            semesterId: currentSemesters[0].id,
            name: "General",
            code: "GEN",
            color: "#4F46E5",
          });
          currentCourses = [newCourse];
        }

        const targetCourseId = currentCourses[0].id;
        let courseTopics = currentTopics.filter((t) => t.courseId === targetCourseId);
        if (courseTopics.length === 0) {
          const token = await getAuthToken();
          const newTopic = await createTopicWithServerSync({
            userId: currentUser.id,
            courseId: targetCourseId,
            name: "General",
            orderIndex: 0,
            status: "pending",
          }, token);
          courseTopics = [newTopic];
        }

        await loadData();
        return { courseId: targetCourseId, topicId: courseTopics[0].id };
      } catch {
        showToast({ type: "error", title: "Error", message: "Could not set up. Please try again." });
        return null;
      }
    };

    const promise = run().finally(() => {
      ensureFullSetupInFlight.current = null;
    });
    ensureFullSetupInFlight.current = promise;
    return promise;
  };

  const handleQuickRecord = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (topics.length === 0) {
      const setup = await ensureFullSetup();
      if (!setup) return;
      await handleStartRecording(setup.topicId);
      return;
    }

    if (getCoursesWithTopics().length === 1 && topics.length === 1) {
      await handleStartRecording(topics[0].id);
      return;
    }

    setShowQuickRecordSheet(true);
  };

  const handleMindMap = async () => {
    if (courses.length === 0) {
      const setup = await ensureFullSetup();
      if (!setup) return;
      navigation.navigate("Mindmap", { courseId: setup.courseId });
      return;
    }
    if (courses.length === 1) {
      navigation.navigate("Mindmap", { courseId: courses[0].id });
    } else {
      setPendingAction("mindmap");
      setShowCoursePickerSheet(true);
    }
  };

  const handleStartRecording = async (topicId: string) => {
    try {
      const topic = topics.find((t) => t.id === topicId);
      if (!topic) return;

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowQuickRecordSheet(false);
      navigation.navigate("Record", { topicId });
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handleAddSemester = async () => {
    if (!semesterName.trim()) return;

    try {
      const currentUser = await storage.getUser();
      if (!currentUser) return;

      await storage.createSemester({
        userId: currentUser.id,
        name: semesterName.trim(),
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString(),
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({
        type: "success",
        title: "Semester created",
        message: "Add courses to get started",
      });
      setSemesterName("");
      setShowAddSheet(false);
      loadData();
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const [showDeleteSheet, setShowDeleteSheet] = useState(false);
  const [deleteSemesterTarget, setDeleteSemesterTarget] = useState<Semester | null>(null);

  const handleDeleteSemester = (semester: Semester) => {
    setDeleteSemesterTarget(semester);
    setShowDeleteSheet(true);
  };

  const confirmDeleteSemester = async () => {
    if (!deleteSemesterTarget) return;
    await storage.deleteSemester(deleteSemesterTarget.id);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast({
      type: "success",
      title: "Deleted",
      message: "Semester removed",
    });
    setShowDeleteSheet(false);
    setDeleteSemesterTarget(null);
    loadData();
  };

  const requireCourseForAction = async (actionType: string) => {
    if (courses.length === 0) {
      const setup = await ensureFullSetup();
      if (!setup) return;
      executeContentAction(actionType, setup.courseId);
      return;
    }
    if (courses.length === 1) {
      executeContentAction(actionType, courses[0].id);
    } else {
      setPendingAction(actionType);
      setShowCoursePickerSheet(true);
    }
  };

  const ensureTopicForCourse = async (courseId: string): Promise<string | null> => {
    if (ensureTopicForCourseInFlight.current[courseId]) {
      return ensureTopicForCourseInFlight.current[courseId];
    }

    const run = async (): Promise<string | null> => {
      const freshTopics = await storage.getTopicsByCourse(courseId);
      if (freshTopics.length > 0) return freshTopics[0].id;
      try {
        const currentUser = await storage.getUser();
        if (!currentUser) return null;
        const token = await getAuthToken();
        const newTopic = await createTopicWithServerSync({
          userId: currentUser.id,
          courseId,
          name: "General",
          orderIndex: 0,
          status: "pending",
        }, token);
        await loadData();
        return newTopic.id;
      } catch {
        showToast({ type: "error", title: "Error", message: "Could not set up. Please try again." });
        return null;
      }
    };

    const promise = run().finally(() => {
      delete ensureTopicForCourseInFlight.current[courseId];
    });
    ensureTopicForCourseInFlight.current[courseId] = promise;
    return promise;
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

  // generateStepIdx = index of the "Generating materials" step in the current flow's step array
  const generateStudyMaterials = async (text: string, topicId: string, generateStepIdx = 0) => {
    if (!text || text.trim().length < 20) return;
    if (cancelledRef.current) return;

    advanceStep(generateStepIdx);
    const authHeaders = await getAuthHeaders();

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

      if (cancelledRef.current) return;

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
          await storage.saveNotes({
            topicId,
            title: "Study Notes",
            sections: [{ heading: `Notes (${timestamp})`, bullets: summaryBullets }],
          });
        }
      }
      if (flashcardsRes.status === "fulfilled" && flashcardsRes.value.ok) {
        const data = await flashcardsRes.value.json();
        if (data.flashcards && data.flashcards.length > 0) {
          await storage.saveFlashcards(
            topicId,
            data.flashcards.map((c: any, i: number) => ({ question: c.front, answer: c.back, orderIndex: i })),
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
              correctIndex: typeof q.correctAnswer === "number" ? q.correctAnswer : 0,
            })),
          );
        }
      }

      if (cancelledRef.current) return;
      advanceStep(generateStepIdx + 1);
      await storage.updateTopic(topicId, { status: "completed" });
    } catch (err) {
      console.log("Study material generation partial failure:", err);
    }
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

  const processImage = async (uri: string, targetTopicId: string, courseId?: string) => {
    if (isUploading) return;
    startProcessing(["Compressing image", "Extracting text", "Generating materials", "Saving"]);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      advanceStep(0);
      const compressedUri = await compressImage(uri);
      if (cancelledRef.current) return;

      advanceStep(1);
      const imageBase64 = await readFileAsBase64(compressedUri);
      const authHeaders = await getAuthHeaders();
      const response = await fetch(
        new URL("/api/ai/ocr/extract", getApiUrl()).toString(),
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          credentials: "include",
          body: JSON.stringify({ imageBase64, topicId: targetTopicId }),
        },
      );
      if (cancelledRef.current) return;
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(typeof errData.error === "string" ? errData.error : "OCR extraction failed");
      }
      const data = await response.json();
      const ocrText = data.text || "";
      await storage.saveWhiteboardImage({ topicId: targetTopicId, imagePath: uri, ocrText });

      if (ocrText.trim().length >= 20) {
        await generateStudyMaterials(ocrText, targetTopicId, 2);
      }
      if (cancelledRef.current) return;

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({ type: "success", title: "Study materials created!", message: "Tap to view your new notes, flashcards, and quiz." });
      loadData();
      if (courseId) {
        navigation.navigate("Topic", { topicId: targetTopicId, courseId });
      }
    } catch (error: any) {
      if (!cancelledRef.current) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        showToast({ type: "error", title: "Error", message: error?.message || "Failed to process image." });
      }
    } finally {
      setIsUploading(false);
    }
  };

  const executeContentAction = async (actionType: string, courseId: string) => {
    if (actionType === "mindmap") {
      navigation.navigate("Mindmap", { courseId });
      return;
    }
    const courseTopics = topics.filter((t) => t.courseId === courseId);
    if (courseTopics.length > 1) {
      setPendingAction(actionType);
      setPendingCourseId(courseId);
      setShowTopicPickerSheet(true);
      return;
    }
    await executeContentWithTopic(actionType, courseId, null);
  };

  const executeContentWithTopic = async (actionType: string, courseId: string, topicId: string | null) => {
    switch (actionType) {
      case "camera":
        await handleTakePhoto(courseId, topicId);
        break;
      case "gallery":
        await handlePickGallery(courseId, topicId);
        break;
      case "upload":
        await handlePickDocument(courseId, topicId);
        break;
      case "clipboard":
        await handlePasteClipboard(courseId, topicId);
        break;
    }
  };

  const resolveTopicId = async (courseId: string, topicId: string | null): Promise<string | null> => {
    if (topicId) return topicId;
    return ensureTopicForCourse(courseId);
  };

  const handleTakePhoto = async (courseId: string, preselectedTopicId: string | null = null) => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        showToast({
          type: "warning",
          title: Platform.OS !== "web" ? "Permission needed" : "Not available",
          message: Platform.OS !== "web"
            ? "Please allow camera access to capture notes."
            : "Camera capture is not available on web. Use file upload instead.",
        });
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.8 });
      if (!result.canceled && result.assets[0]) {
        const tid = await resolveTopicId(courseId, preselectedTopicId);
        if (tid) await processImage(result.assets[0].uri, tid, courseId);
      }
    } catch {
      showToast({ type: "error", title: "Error", message: "Failed to capture image." });
    }
  };

  const handlePickGallery = async (courseId: string, preselectedTopicId: string | null = null) => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        showToast({ type: "warning", title: "Permission needed", message: "Allow access to your photo library." });
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        const tid = await resolveTopicId(courseId, preselectedTopicId);
        if (tid) await processImage(result.assets[0].uri, tid, courseId);
      }
    } catch {
      showToast({ type: "error", title: "Error", message: "Failed to pick image." });
    }
  };

  const handlePickDocument = async (courseId: string, preselectedTopicId: string | null = null) => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/*", "application/pdf", "image/*"],
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return;
      const asset = result.assets[0];
      if (asset.size && asset.size > 40 * 1024 * 1024) {
        showToast({ type: "warning", title: "File Too Large", message: "Please choose a file under 40 MB." });
        return;
      }
      const tid = await resolveTopicId(courseId, preselectedTopicId);
      if (!tid) return;

      startProcessing(["Reading document", "Extracting text", "Generating materials", "Saving"]);
      advanceStep(0);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      let extractedText = "";
      const mime = asset.mimeType || "";
      if (cancelledRef.current) return;

      advanceStep(1);
      if (mime.startsWith("text/")) {
        extractedText = await readFileAsText(asset.uri);
      } else if (mime.startsWith("image/")) {
        await processImage(asset.uri, tid, courseId);
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
            body: JSON.stringify({ imageBase64: fileBase64, topicId: tid, fileType: "pdf" }),
          },
        );
        if (cancelledRef.current) return;
        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(typeof errData.error === "string" ? errData.error : "Document extraction failed");
        }
        const data = await response.json();
        extractedText = data.text || "";
      }

      if (cancelledRef.current) return;

      if (extractedText.trim()) {
        await storage.saveWhiteboardImage({ topicId: tid, imagePath: "", ocrText: extractedText });
        await generateStudyMaterials(extractedText, tid, 2);
        if (cancelledRef.current) return;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast({ type: "success", title: "Study materials created!", message: "Opening your new notes, flashcards, and quiz." });
        loadData();
        navigation.navigate("Topic", { topicId: tid, courseId });
      } else {
        showToast({ type: "warning", title: "No Text Found", message: "Could not extract text from the document." });
      }
    } catch (error: any) {
      if (!cancelledRef.current) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        showToast({ type: "error", title: "Error", message: error?.message || "Failed to process document." });
      }
    } finally {
      setIsUploading(false);
    }
  };

  const [pasteTargetTopicId, setPasteTargetTopicId] = useState<string | null>(null);

  const handlePasteClipboard = (courseId: string, preselectedTopicId: string | null = null) => {
    setPasteText("");
    setPasteTargetCourseId(courseId);
    setPasteTargetTopicId(preselectedTopicId);
    setShowPasteSheet(true);
  };

  const handleSubmitPastedText = async () => {
    if (!pasteText.trim() || !pasteTargetCourseId) return;
    setShowPasteSheet(false);
    try {
      const tid = await resolveTopicId(pasteTargetCourseId, pasteTargetTopicId);
      if (!tid) return;

      startProcessing(["Processing text", "Generating materials", "Saving"]);
      advanceStep(0);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const trimmedText = pasteText.trim();
      await storage.saveWhiteboardImage({ topicId: tid, imagePath: "", ocrText: trimmedText });
      if (cancelledRef.current) return;

      await generateStudyMaterials(trimmedText, tid, 1);
      if (cancelledRef.current) return;

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({ type: "success", title: "Study materials created!", message: "Opening your new notes, flashcards, and quiz." });
      const navCourseId = pasteTargetCourseId;
      setPasteText("");
      setPasteTargetCourseId(null);
      loadData();
      if (navCourseId) {
        navigation.navigate("Topic", { topicId: tid, courseId: navCourseId });
      }
    } catch (err: any) {
      if (!cancelledRef.current) {
        console.error("[Paste] Failed:", err);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        showToast({ type: "error", title: "Error", message: err?.message || "Failed to process pasted text." });
      }
    } finally {
      setIsUploading(false);
    }
  };

  // ─── Render helpers ────────────────────────────────────────────────────────

  const nextAction = getNextAction();

  const renderOnboardingModal = () => {
    if (hasSeenOnboarding !== false) return null;

    return (
      <Modal visible transparent animationType="fade">
        <View style={styles.onboardingOverlay}>
          <Card style={styles.onboardingCard}>
            <View style={[styles.onboardingIconWrap, { backgroundColor: theme.link + "15" }]}>
              <Icon name="book-open" size={36} color={theme.link} />
            </View>
            <ThemedText type="h2" style={styles.onboardingTitle}>
              Welcome to StudyMind
            </ThemedText>
            <ThemedText
              type="body"
              style={[styles.onboardingSubtitle, { color: theme.textSecondary }]}
            >
              Turn your lectures, photos, and notes into study materials automatically.
            </ThemedText>
            <View style={styles.onboardingSteps}>
              {[
                { icon: "mic", label: "Record a lecture or paste your notes" },
                { icon: "cpu", label: "AI generates notes, flashcards, and a quiz" },
                { icon: "award", label: "Study smarter and ace your exams" },
              ].map(({ icon, label }) => (
                <View key={icon} style={styles.onboardingStep}>
                  <View style={[styles.onboardingStepIcon, { backgroundColor: theme.link + "12" }]}>
                    <Icon name={icon} size={16} color={theme.link} />
                  </View>
                  <ThemedText type="body" style={styles.onboardingStepText}>
                    {label}
                  </ThemedText>
                </View>
              ))}
            </View>
            <Button fullWidth size="lg" onPress={dismissOnboarding} style={{ marginTop: Spacing.xl }}>
              Get Started
            </Button>
          </Card>
        </View>
      </Modal>
    );
  };

  // Shown when user has no topics yet — replaces the confusing icon grid
  const renderQuickAddHero = () => (
    <View style={[styles.quickAddHero, { backgroundColor: "#7C3AED10", borderColor: "#7C3AED30" }]}>
      <View style={[styles.quickAddHeaderRow]}>
        <View style={[styles.quickAddHeroIcon, { backgroundColor: "#7C3AED20" }]}>
          <Icon name="zap" size={20} color="#9F67FF" />
        </View>
        <View style={{ flex: 1 }}>
          <ThemedText type="h4" style={[styles.quickAddTitle, { color: "#9F67FF" }]}>
            Add your first study material
          </ThemedText>
          <ThemedText type="small" style={[styles.quickAddSubtitle, { color: theme.textSecondary }]}>
            We'll organise everything automatically
          </ThemedText>
        </View>
      </View>
      <View style={styles.quickAddButtons}>
        {[
          { label: "Record", icon: "mic", color: "#EF4444", action: handleQuickRecord },
          { label: "Camera", icon: "camera", color: "#7C3AED", action: () => requireCourseForAction("camera") },
          { label: "Upload", icon: "upload", color: "#10B981", action: () => requireCourseForAction("upload") },
          { label: "Paste", icon: "clipboard", color: "#F59E0B", action: () => requireCourseForAction("clipboard") },
        ].map(({ label, icon, color, action }) => (
          <Pressable
            key={label}
            style={styles.quickAddButton}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              action();
            }}
            accessibilityRole="button"
            accessibilityLabel={label}
          >
            <View style={[styles.quickAddButtonIcon, { backgroundColor: color + "20", borderColor: color + "40", borderWidth: 1 }]}>
              <Icon name={icon} size={18} color={color} />
            </View>
            <ThemedText type="caption" style={[styles.quickAddButtonLabel, { color: theme.textSecondary }]}>
              {label}
            </ThemedText>
          </Pressable>
        ))}
      </View>
    </View>
  );

  const renderNextActionCard = () => {
    if (!nextAction) return null;

    return (
      <Pressable
        style={({ pressed }) => [
          styles.nextActionCard,
          {
            backgroundColor: nextAction.color + "15",
            borderColor: nextAction.color + "40",
            shadowColor: nextAction.color,
            shadowOpacity: pressed ? 0.25 : 0.15,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 4 },
            elevation: 4,
            opacity: pressed ? 0.9 : 1,
          },
        ]}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          nextAction.onPress();
        }}
        accessibilityRole="button"
        accessibilityLabel={nextAction.title}
        hitSlop={{ top: 5, bottom: 5, left: 5, right: 5 }}
      >
        <View
          style={[
            styles.nextActionIcon,
            { backgroundColor: nextAction.color + "25", pointerEvents: "none" },
          ]}
        >
          <Icon name={nextAction.icon} size={24} color={nextAction.color} />
        </View>
        <View style={[styles.nextActionContent, { pointerEvents: "none" }]}>
          <ThemedText type="h4" style={{ color: nextAction.color, fontWeight: "700" }}>
            {nextAction.title}
          </ThemedText>
          <ThemedText
            type="small"
            style={{ color: theme.textSecondary, marginTop: 2 }}
          >
            {nextAction.subtitle}
          </ThemedText>
        </View>
        <View style={{ pointerEvents: "none" }}>
          <Icon name="chevron-right" size={20} color={nextAction.color} />
        </View>
      </Pressable>
    );
  };

  const contentActions = [
    { label: "Camera", icon: "camera" as const, color: theme.link, onPress: () => requireCourseForAction("camera"), testID: "button-camera" },
    { label: "Gallery", icon: "image" as const, color: "#8B5CF6", onPress: () => requireCourseForAction("gallery"), testID: "button-gallery" },
    { label: "Upload", icon: "upload" as const, color: theme.success, onPress: () => requireCourseForAction("upload"), testID: "button-upload" },
    { label: "Clipboard", icon: "clipboard" as const, color: theme.warning, onPress: () => requireCourseForAction("clipboard"), testID: "button-clipboard" },
    { label: "Record", icon: "mic" as const, color: theme.error, onPress: handleQuickRecord, testID: "button-record" },
  ];

  const studyActions = [
    { label: "Study", icon: "book-open" as const, color: theme.success, onPress: () => navigation.navigate("StudyToday"), testID: "button-study" },
    { label: "Exam", icon: "award" as const, color: theme.warning, onPress: () => navigation.navigate("ExamMode"), testID: "button-exam" },
    { label: "Library", icon: "folder" as const, color: "#F59E0B", onPress: () => navigation.navigate("Library"), testID: "button-library" },
    { label: "Mind Map", icon: "share-2" as const, color: "#06B6D4", onPress: handleMindMap, testID: "button-mindmap" },
    { label: "Search", icon: "search" as const, color: theme.info, onPress: () => navigation.navigate("Search"), testID: "button-search" },
    { label: "Write", icon: "edit-3" as const, color: "#EC4899", onPress: () => navigation.navigate("WritingLab"), testID: "button-write" },
  ];

  const renderActionRow = (actions: Array<{ label: string; icon: string; color: string; onPress: () => void; testID: string }>) => (
    <View style={styles.quickActionsRow}>
      {actions.map((action) => (
        <Pressable
          key={action.label}
          style={({ pressed }) => [
            styles.quickAction,
            {
              backgroundColor: theme.backgroundDefault,
              borderColor: action.color + "40",
              shadowColor: action.color,
              shadowOpacity: pressed ? 0.3 : 0.12,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 3 },
              elevation: pressed ? 6 : 3,
              transform: [{ scale: pressed ? 0.93 : 1 }],
            },
          ]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            action.onPress();
          }}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          testID={action.testID}
        >
          <View style={[styles.quickActionIcon, { backgroundColor: action.color + "20" }]}>
            <Icon name={action.icon} size={20} color={action.color} />
          </View>
          <ThemedText type="caption" style={[styles.quickActionLabel, { color: theme.text }]} numberOfLines={1}>
            {action.label}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );

  // No topics: hero card covers Add Content — only show Study Tools once user has content
  const renderQuickActions = () => {
    if (!hasContent) return null;
    return (
      <View style={styles.quickActionsContainer}>
        <ThemedText
          type="caption"
          style={[styles.quickActionsSectionLabel, { color: theme.textSecondary }]}
        >
          Add Content
        </ThemedText>
        {renderActionRow(contentActions)}
        <ThemedText
          type="caption"
          style={[styles.quickActionsSectionLabel, { color: theme.textSecondary, marginTop: Spacing.md }]}
        >
          Study Tools
        </ThemedText>
        {renderActionRow(studyActions)}
      </View>
    );
  };

  const renderStatsRow = () => {
    const stats = [
      { icon: "file-text", value: topics.length, label: "Topics", color: "#7C3AED" },
      { icon: "check-circle", value: completedTopics.length, label: "Completed", color: "#10B981" },
      { icon: "layers", value: totalFlashcardCount, label: "Flashcards", color: "#F59E0B" },
      { icon: "book", value: courses.length, label: "Courses", color: "#3B82F6" },
    ];

    return (
      <View style={styles.statGrid}>
        {stats.map((stat) => (
          <View
            key={stat.label}
            style={[styles.statTile, {
              backgroundColor: theme.backgroundDefault,
              borderColor: stat.color + "30",
              shadowColor: stat.color,
            }]}
          >
            <View style={[styles.statTileIcon, { backgroundColor: stat.color + "18" }]}>
              <Icon name={stat.icon} size={18} color={stat.color} />
            </View>
            <ThemedText type="h2" style={[styles.statTileValue, { color: theme.text }]}>
              {stat.value}
            </ThemedText>
            <ThemedText type="caption" style={[styles.statTileLabel, { color: theme.textSecondary }]}>
              {stat.label}
            </ThemedText>
            <View style={[styles.statTileAccent, { backgroundColor: stat.color }]} />
          </View>
        ))}
      </View>
    );
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed": return "check-circle";
      case "transcribing": return "loader";
      case "pending": return "clock";
      default: return "file-text";
    }
  };

  const getStatusVariant = (status: string): "success" | "warning" | "info" | "default" => {
    switch (status) {
      case "completed": return "success";
      case "transcribing": return "info";
      case "pending": return "warning";
      default: return "default";
    }
  };

  const getCourseName = (courseId: string) => {
    const course = courses.find((c) => c.id === courseId);
    return course ? course.name : "";
  };

  const recentTopics = useMemo(() =>
    [...topics]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5),
    [topics],
  );

  const renderRecentTopics = () => {
    if (recentTopics.length === 0) return null;

    return (
      <View style={styles.recentTopicsSection}>
        <SectionHeader title="Recent Topics" icon="clock" />
        {recentTopics.map((topic) => (
          <ListItem
            key={topic.id}
            title={topic.name}
            subtitle={getCourseName(topic.courseId)}
            leftIcon={getStatusIcon(topic.status)}
            leftIconColor={
              topic.status === "completed"
                ? theme.success
                : topic.status === "transcribing"
                  ? theme.info
                  : theme.warning
            }
            rightContent={
              <StatusChip
                label={topic.status}
                variant={getStatusVariant(topic.status)}
              />
            }
            onPress={() => navigation.navigate("Topic", { topicId: topic.id, courseId: topic.courseId })}
            testID={`topic-item-${topic.id}`}
          />
        ))}
      </View>
    );
  };

  const renderSemestersGrid = () => {
    if (semesters.length === 0) {
      return (
        <EmptyState
          image={require("../../assets/images/empty-semesters.png")}
          title="Let's Get Started"
          description="Create a semester and we'll help you organize your studies and ace your exams."
          buttonLabel="Create Semester"
          onButtonPress={() => setShowAddSheet(true)}
          compact
        />
      );
    }

    const rows: Semester[][] = [];
    for (let i = 0; i < semesters.length; i += 2) {
      rows.push(semesters.slice(i, i + 2));
    }

    return (
      <View>
        <SectionHeader
          title="Your Semesters"
          icon="folder"
          action={{ label: "Add", icon: "plus", onPress: () => setShowAddSheet(true) }}
        />
        {rows.map((row, rowIndex) => (
          <View key={rowIndex} style={row.length > 1 ? styles.row : undefined}>
            {row.map((semester) => {
              const courseCount = getCourseCount(semester.id);
              return (
                <Card
                  key={semester.id}
                  style={styles.semesterCard}
                  onPress={() => navigation.navigate("Semester", { semesterId: semester.id })}
                  onLongPress={() => handleDeleteSemester(semester)}
                >
                  <View style={styles.cardHeader}>
                    <View style={[styles.iconContainer, { backgroundColor: theme.link + "15" }]}>
                      <Icon name="calendar" size={20} color={theme.link} />
                    </View>
                  </View>
                  <ThemedText type="h4" style={styles.semesterName} numberOfLines={2}>
                    {semester.name}
                  </ThemedText>
                  <Badge
                    label={`${courseCount} ${courseCount === 1 ? "course" : "courses"}`}
                    variant="default"
                  />
                </Card>
              );
            })}
            {row.length === 1 ? <View style={styles.semesterCard} /> : null}
          </View>
        ))}
      </View>
    );
  };

  const getCoursesWithTopics = () => {
    return courses
      .filter((c) => topics.some((t) => t.courseId === c.id))
      .map((course) => ({
        ...course,
        courseTopics: topics.filter((t) => t.courseId === course.id),
      }));
  };

  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
        <View style={{ paddingTop: headerHeight + Spacing.lg, paddingHorizontal: Spacing.lg }}>
          <SkeletonCard />
          <View style={{ marginTop: Spacing.lg }} />
          <SkeletonList count={3} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: headerHeight + Spacing.lg,
            paddingBottom: tabBarHeight + Spacing.xl,
          },
        ]}
        scrollIndicatorInsets={{ bottom: insets.bottom }}
        showsVerticalScrollIndicator
      >
        {/* ── Hero greeting ── */}
        <View style={[styles.heroCard, { backgroundColor: theme.backgroundDefault, borderColor: "#7C3AED30" }]}>
          <View style={styles.heroTop}>
            <View style={{ flex: 1 }}>
              <ThemedText type="caption" style={[styles.heroEyebrow, { color: "#9F67FF" }]}>
                {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              </ThemedText>
              <ThemedText type="h2" style={styles.heroTitle}>
                {user?.name ? `Hey, ${user.name.split(" ")[0]} 👋` : "Welcome back"}
              </ThemedText>
              <ThemedText type="body" style={{ color: theme.textSecondary, marginTop: 2 }}>
                {topics.length > 0
                  ? `${completedTopics.length} of ${topics.length} topics completed`
                  : "Your AI study assistant is ready"}
              </ThemedText>
            </View>
            {topics.length > 0 ? (
              <View style={styles.heroProgressRing}>
                <View style={[styles.heroProgressFill, {
                  borderColor: "#7C3AED",
                  borderLeftColor: topics.length > 0 && completedTopics.length / topics.length > 0.5 ? "#7C3AED" : "transparent",
                }]} />
                <View style={styles.heroProgressCenter}>
                  <ThemedText style={[styles.heroProgressPct, { color: "#9F67FF" }]}>
                    {topics.length > 0 ? Math.round((completedTopics.length / topics.length) * 100) : 0}
                  </ThemedText>
                  <ThemedText style={[styles.heroProgressLabel, { color: theme.textSecondary }]}>%</ThemedText>
                </View>
              </View>
            ) : (
              <View style={[styles.heroAvatarWrap, { backgroundColor: "#7C3AED20" }]}>
                <Icon name="zap" size={28} color="#9F67FF" />
              </View>
            )}
          </View>
        </View>

        {/* Next action card — only shown when user has content */}
        {renderNextActionCard()}

        {/* Quick Add hero — only shown when user has no topics yet */}
        {topics.length === 0 ? renderQuickAddHero() : null}

        {/* Quick action rows — hidden when hero card is showing (no content yet) */}
        {renderQuickActions()}

        {/* Stats row — hidden when all zeros */}
        {hasStats ? renderStatsRow() : null}

        {renderSemestersGrid()}
        {renderRecentTopics()}
      </ScrollView>

      {semesters.length > 0 ? (
        <Pressable
          style={[styles.fab, { backgroundColor: theme.link, bottom: tabBarHeight + 16 }]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            setShowAddSheet(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="Add new semester"
        >
          <Icon name="plus" size={20} color="#fff" />
        </Pressable>
      ) : null}

      {/* ── Bottom sheets ──────────────────────────────────────────────── */}

      <BottomSheet
        visible={showAddSheet}
        onClose={() => { setShowAddSheet(false); setSemesterName(""); }}
        title="New Semester"
      >
        <ThemedText type="small" style={[styles.sheetHint, { color: theme.textSecondary }]}>
          {'Name your semester (e.g., "Fall 2025" or "Senior Year")'}
        </ThemedText>
        <Input
          placeholder="Semester name"
          value={semesterName}
          onChangeText={setSemesterName}
          autoFocus
        />
        <Button onPress={handleAddSemester} disabled={!semesterName.trim()} size="lg" fullWidth>
          Create Semester
        </Button>
      </BottomSheet>

      <BottomSheet
        visible={showQuickRecordSheet}
        onClose={() => setShowQuickRecordSheet(false)}
        title="Quick Record"
      >
        <ThemedText type="small" style={[styles.sheetHint, { color: theme.textSecondary }]}>
          Select a topic to start recording
        </ThemedText>
        {getCoursesWithTopics().map((course) => (
          <View key={course.id} style={styles.courseSection}>
            <ThemedText type="caption" style={[styles.courseSectionTitle, { color: course.color }]}>
              {course.name}
            </ThemedText>
            {course.courseTopics.map((topic) => (
              <ListItem
                key={topic.id}
                title={topic.name}
                leftIcon="folder"
                leftIconColor={course.color}
                onPress={() => handleStartRecording(topic.id)}
              />
            ))}
          </View>
        ))}
        {getCoursesWithTopics().length === 0 ? (
          <View style={styles.noTopicsContainer}>
            <ThemedText type="body" style={{ color: theme.textSecondary, textAlign: "center" }}>
              No topics available. Add a topic to your course first.
            </ThemedText>
            <Button
              variant="secondary"
              onPress={() => {
                setShowQuickRecordSheet(false);
                if (courses.length > 0) navigation.navigate("Course", { courseId: courses[0].id });
              }}
              style={styles.addTopicButton}
            >
              Add Topic
            </Button>
          </View>
        ) : null}
      </BottomSheet>

      <BottomSheet
        visible={showCoursePickerSheet}
        onClose={() => { setShowCoursePickerSheet(false); setPendingAction(null); }}
        title="Select a Course"
      >
        <ThemedText type="small" style={[styles.sheetHint, { color: theme.textSecondary }]}>
          Choose which course to add materials to
        </ThemedText>
        {courses.map((course) => (
          <ListItem
            key={course.id}
            title={course.name}
            leftIcon="book"
            leftIconColor={course.color || theme.link}
            onPress={() => {
              setShowCoursePickerSheet(false);
              if (pendingAction) {
                executeContentAction(pendingAction, course.id);
                setPendingAction(null);
              }
            }}
          />
        ))}
      </BottomSheet>

      <BottomSheet
        visible={showTopicPickerSheet}
        onClose={() => { setShowTopicPickerSheet(false); setPendingAction(null); setPendingCourseId(null); }}
        title="Select a Topic"
      >
        <ThemedText type="small" style={[styles.sheetHint, { color: theme.textSecondary }]}>
          Choose which topic to save your study materials to
        </ThemedText>
        {pendingCourseId ? topics.filter((t) => t.courseId === pendingCourseId).map((topic) => (
          <ListItem
            key={topic.id}
            title={topic.name}
            leftIcon="bookmark"
            leftIconColor={theme.link}
            onPress={() => {
              setShowTopicPickerSheet(false);
              if (pendingAction && pendingCourseId) {
                executeContentWithTopic(pendingAction, pendingCourseId, topic.id);
              }
              setPendingAction(null);
              setPendingCourseId(null);
            }}
          />
        )) : null}
      </BottomSheet>

      <BottomSheet
        visible={showPasteSheet}
        onClose={() => { setShowPasteSheet(false); setPasteText(""); setPasteTargetCourseId(null); setPasteTargetTopicId(null); }}
        title="Paste Text"
      >
        <ThemedText type="small" style={[styles.sheetHint, { color: theme.textSecondary }]}>
          Paste or type your study notes, then tap Generate to create study materials
        </ThemedText>
        <TextInput
          testID="input-paste-text"
          multiline
          numberOfLines={8}
          placeholder="Paste your text here..."
          placeholderTextColor={theme.textSecondary}
          value={pasteText}
          onChangeText={setPasteText}
          style={[
            styles.pasteInput,
            { color: theme.text, backgroundColor: theme.backgroundDefault, borderColor: theme.border },
          ]}
          textAlignVertical="top"
          autoFocus
        />
        <Button
          onPress={handleSubmitPastedText}
          disabled={!pasteText.trim()}
          testID="button-submit-paste"
          style={{ marginTop: Spacing.md }}
        >
          Generate Study Materials
        </Button>
      </BottomSheet>

      <BottomSheet
        visible={showDeleteSheet}
        onClose={() => { setShowDeleteSheet(false); setDeleteSemesterTarget(null); }}
        title="Delete Semester?"
      >
        <ThemedText type="body" style={{ color: theme.textSecondary, marginBottom: Spacing.lg }}>
          {deleteSemesterTarget
            ? `This will permanently delete "${deleteSemesterTarget.name}" and all its courses and topics.`
            : ""}
        </ThemedText>
        <Button variant="destructive" fullWidth onPress={confirmDeleteSemester}>
          Delete
        </Button>
        <Button
          variant="ghost"
          fullWidth
          onPress={() => { setShowDeleteSheet(false); setDeleteSemesterTarget(null); }}
          style={{ marginTop: Spacing.sm }}
        >
          Cancel
        </Button>
      </BottomSheet>

      {/* ── Processing overlay ─────────────────────────────────────────── */}

      {isUploading ? (
        <View style={[styles.uploadingOverlay, { backgroundColor: "rgba(0,0,0,0.6)" }]}>
          <Card style={[styles.uploadingCard, { backgroundColor: theme.backgroundDefault }]}>
            <ThemedText type="h4" style={styles.uploadingTitle}>
              Creating Study Materials
            </ThemedText>
            <View style={styles.processingSteps}>
              {processingSteps.map((step, index) => (
                <View key={step} style={styles.processingStep}>
                  <View style={styles.processingStepIcon}>
                    {index < currentStepIndex ? (
                      <Icon name="check-circle" size={18} color={theme.success} />
                    ) : index === currentStepIndex ? (
                      <ActivityIndicator size="small" color={theme.link} />
                    ) : (
                      <View style={[styles.stepDot, { backgroundColor: theme.border }]} />
                    )}
                  </View>
                  <ThemedText
                    type="body"
                    style={{
                      color: index < currentStepIndex
                        ? theme.textSecondary
                        : index === currentStepIndex
                          ? theme.text
                          : theme.textSecondary,
                      fontWeight: index === currentStepIndex ? "600" : "400",
                      opacity: index > currentStepIndex ? 0.5 : 1,
                    }}
                  >
                    {step}
                  </ThemedText>
                </View>
              ))}
            </View>
            <Pressable
              onPress={cancelProcessing}
              style={[styles.cancelButton, { borderColor: theme.border }]}
              accessibilityRole="button"
              accessibilityLabel="Cancel processing"
            >
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                Cancel
              </ThemedText>
            </Pressable>
          </Card>
        </View>
      ) : null}

      {/* ── Onboarding modal ───────────────────────────────────────────── */}
      {renderOnboardingModal()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    flexGrow: 1,
  },
  greeting: {
    marginBottom: Spacing.lg,
  },

  // Hero card
  heroCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: Spacing.xl,
    marginBottom: Spacing.xl,
    shadowColor: "#7C3AED",
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  heroEyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  heroTitle: {
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  heroProgressRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 4,
    borderColor: "#7C3AED40",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  heroProgressFill: {
    position: "absolute",
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 4,
  },
  heroProgressCenter: {
    flexDirection: "row",
    alignItems: "flex-end",
  },
  heroProgressPct: {
    fontSize: 20,
    fontWeight: "800",
    lineHeight: 24,
  },
  heroProgressLabel: {
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 2,
  },
  heroAvatarWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  nextActionCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    marginBottom: Spacing.xl,
  },
  nextActionIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  nextActionContent: {
    flex: 1,
    marginLeft: Spacing.md,
  },

  // Quick Add Hero
  quickAddHero: {
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    padding: Spacing.xl,
    marginBottom: Spacing.xl,
  },
  quickAddHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
  quickAddHeroIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  quickAddTitle: {
    marginBottom: 2,
    fontWeight: "700",
  },
  quickAddSubtitle: {
    lineHeight: 18,
  },
  quickAddButtons: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  quickAddButton: {
    alignItems: "center",
    gap: Spacing.xs,
    flex: 1,
  },
  quickAddButtonIcon: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  quickAddButtonLabel: {
    fontSize: 11,
    fontWeight: "500",
  },

  // Quick actions
  quickActionsContainer: {
    marginBottom: Spacing.md,
  },
  quickActionsSectionLabel: {
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: Spacing.sm,
    marginLeft: Spacing.xs,
    fontSize: 11,
  },
  quickActionsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  quickAction: {
    alignItems: "center",
    gap: 6,
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 14,
    borderWidth: 1,
  },
  quickActionIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  quickActionLabel: {
    fontSize: 10,
    fontWeight: "600",
    textAlign: "center",
    letterSpacing: 0.2,
  },

  // Stats 2×2 grid
  statGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
  statTile: {
    width: "47%",
    borderRadius: 16,
    borderWidth: 1,
    padding: Spacing.lg,
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
    overflow: "hidden",
  },
  statTileIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.sm,
  },
  statTileValue: {
    fontWeight: "800",
    letterSpacing: -0.5,
    marginBottom: 2,
  },
  statTileLabel: {
    fontSize: 12,
    fontWeight: "500",
  },
  statTileAccent: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  // Legacy (kept for any remaining references)
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: Spacing.lg,
    paddingVertical: Spacing.lg,
  },
  statItem: { alignItems: "center", flex: 1, paddingVertical: Spacing.sm },
  statIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", marginBottom: Spacing.xs },
  statValue: { fontWeight: "700" },
  statLabel: { marginTop: 2 },

  // Semesters grid
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  semesterCard: {
    width: "48%",
    marginBottom: Spacing.lg,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: Spacing.sm,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  semesterName: {
    marginBottom: Spacing.sm,
  },

  // Recent topics
  recentTopicsSection: {
    marginTop: Spacing.sm,
  },

  // FAB
  fab: {
    position: "absolute",
    right: Spacing.xl,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
  },

  // Bottom sheet hints
  sheetHint: {
    marginBottom: Spacing.md,
  },
  courseSection: {
    marginBottom: Spacing.md,
  },
  courseSectionTitle: {
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: Spacing.sm,
    marginLeft: Spacing.xs,
    fontSize: 11,
  },
  noTopicsContainer: {
    paddingVertical: Spacing.xl,
    alignItems: "center",
  },
  addTopicButton: {
    marginTop: Spacing.lg,
  },
  pasteInput: {
    minHeight: 150,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    fontSize: 15,
    lineHeight: 22,
  },

  // Processing overlay
  uploadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  uploadingCard: {
    padding: Spacing["2xl"],
    width: 260,
    borderRadius: BorderRadius.xl,
  },
  uploadingTitle: {
    textAlign: "center",
    marginBottom: Spacing.xl,
  },
  processingSteps: {
    gap: Spacing.md,
  },
  processingStep: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  processingStepIcon: {
    width: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  cancelButton: {
    marginTop: Spacing.xl,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    alignItems: "center",
    alignSelf: "center",
  },

  // Onboarding modal
  onboardingOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing["2xl"],
  },
  onboardingCard: {
    width: "100%",
    maxWidth: 360,
    padding: Spacing["2xl"],
    borderRadius: BorderRadius.xl,
    alignItems: "center",
  },
  onboardingIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xl,
  },
  onboardingTitle: {
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  onboardingSubtitle: {
    textAlign: "center",
    lineHeight: 22,
    marginBottom: Spacing.xl,
  },
  onboardingSteps: {
    width: "100%",
    gap: Spacing.md,
  },
  onboardingStep: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  onboardingStepIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  onboardingStepText: {
    flex: 1,
    lineHeight: 20,
  },
});
