import React, { useState, useRef, useEffect } from "react";
import { View, StyleSheet, Pressable, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation, useRoute } from "@react-navigation/native";
import { Icon } from "@/components/Icon";
import * as Haptics from "expo-haptics";
import { useAudioRecorder, RecordingPresets, AudioModule } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  cancelAnimation,
} from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import {
  ProcessingTimeline,
  ProcessingStep,
} from "@/components/ProcessingTimeline";
import { useTheme } from "@/hooks/useTheme";
import { useToast } from "@/components/Toast";
import { storage } from "@/lib/storage";
import { getApiUrl, getAuthHeaders } from "@/lib/query-client";
import { Spacing, BorderRadius } from "@/constants/theme";

type RecordingState =
  | "idle"
  | "recording"
  | "processing"
  | "choosing"
  | "generating"
  | "completed";

interface MaterialSelection {
  notes: boolean;
  flashcards: boolean;
  quiz: boolean;
}

export default function RecordScreen() {
  const { theme } = useTheme();
  const { showToast } = useToast();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const navigation = useNavigation();
  const route = useRoute<any>();
  const { topicId } = route.params;

  const [state, setState] = useState<RecordingState>("idle");
  const [duration, setDuration] = useState(0);
  const [processingStep, setProcessingStep] = useState<string>("upload");
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [materialSelection, setMaterialSelection] = useState<MaterialSelection>(
    {
      notes: true,
      flashcards: true,
      quiz: true,
    },
  );
  const [savedTranscript, setSavedTranscript] = useState<string>("");
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const isProcessingRef = useRef(false);
  const isMountedRef = useRef(true);
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const pulseScale = useSharedValue(1);
  const ringScale = useSharedValue(1);
  const ringOpacity = useSharedValue(0);

  useEffect(() => {
    (async () => {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      setPermissionGranted(status.granted);
    })();
  }, []);

 useEffect(() => {
  isMountedRef.current = true;
  return () => {
    isMountedRef.current = false;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    cancelAnimation(pulseScale);
    cancelAnimation(ringScale);
    cancelAnimation(ringOpacity);
  };
}, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const startRecording = async () => {
    if (state !== "idle" || isProcessingRef.current) return;
    if (!permissionGranted) {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) {
        showToast({
          type: "error",
          title: "Permission denied",
          message: "Microphone access is required to record",
        });
        return;
      }
      setPermissionGranted(true);
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    try {
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      setState("recording");
      setDuration(0);

      pulseScale.value = withRepeat(
        withSequence(
          withTiming(1.05, { duration: 600 }),
          withTiming(1, { duration: 600 }),
        ),
        -1,
        true,
      );

      ringScale.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 0 }),
          withTiming(1.8, { duration: 1200 }),
        ),
        -1,
        false,
      );

      ringOpacity.value = withRepeat(
        withSequence(
          withTiming(0.6, { duration: 0 }),
          withTiming(0, { duration: 1200 }),
        ),
        -1,
        false,
      );

      timerRef.current = setInterval(() => {
        setDuration((d) => d + 1);
      }, 1000);
    } catch (error) {
      console.error("Failed to start recording:", error);
      showToast({
        type: "error",
        title: "Recording failed",
        message: "Could not start recording",
      });
    }
  };

  // Poll job status until complete or timeout
  const pollJobStatus = async (
    jobId: string,
    maxWaitMs = 90000,
  ): Promise<{ transcript?: string; error?: string }> => {
    const apiUrl = getApiUrl();
    const pollAuthHeaders = await getAuthHeaders();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...pollAuthHeaders,
    };

    const startTime = Date.now();
    const pollInterval = 1000;

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const res = await fetch(
          new URL(`/api/ai/jobs/${jobId}`, apiUrl).toString(),
          { headers, credentials: "include" },
        );
        if (!res.ok) {
          return { error: "Failed to check job status" };
        }

        const data = await res.json();
        const job = data.job;

        if (job.status === "completed") {
          return { transcript: job.output?.transcript || "" };
        } else if (job.status === "failed") {
          return { error: job.error || "Transcription failed" };
        }

        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      } catch (e) {
        console.error("Job polling error:", e);
        return { error: "Network error while checking status" };
      }
    }

    return { error: "Transcription timed out" };
  };

  const stopRecording = async () => {
  if (state !== "recording" || isProcessingRef.current) return;
  if (!audioRecorder) return;

  isProcessingRef.current = true;

  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    cancelAnimation(pulseScale);
    cancelAnimation(ringScale);
    cancelAnimation(ringOpacity);
    pulseScale.value = 1;
    ringScale.value = 1;
    ringOpacity.value = 0;

    if (duration < 2) {
      showToast({
        type: "warning",
        title: "Too short",
        message: "Please record for at least a few seconds",
      });
      setState("idle");
      isProcessingRef.current = false;
      try {
        await audioRecorder.stop();
      } catch {}
      return;
    }

    setState("processing");

    try {
      await audioRecorder.stop();
      const recordingUri = audioRecorder.uri;
      if (__DEV__)
        console.log("[Record] Recording stopped, URI:", recordingUri);

      setProcessingStep("upload");
      await storage.updateTopic(topicId, { status: "transcribing" });

      const apiUrl = getApiUrl();
      const authHeaders = await getAuthHeaders();

      if (!recordingUri) {
        showToast({
          type: "error",
          title: "Recording failed",
          message: "No audio recorded. Please try again.",
        });
        await storage.updateTopic(topicId, { status: "pending" });
        if (__DEV__) console.log("[Record] Topic status -> pending (no recording URI)");
        setState("idle");
        return;
      }

      let audioBase64 = "";
      if (Platform.OS === "web") {
        try {
          const response = await fetch(recordingUri);
          const blob = await response.blob();
          audioBase64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const result = reader.result as string;
              const base64 = result.split(",")[1] || result;
              resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        } catch (e) {
          if (__DEV__) console.error("[Record] Base64 conversion failed:", e);
          showToast({
            type: "error",
            title: "Recording failed",
            message: "Could not process the recorded audio.",
          });
          await storage.updateTopic(topicId, { status: "pending" });
          if (__DEV__) console.log("[Record] Topic status -> pending (base64 conversion failed)");
          setState("idle");
          return;
        }
      } else {
        const fileInfo = await FileSystem.getInfoAsync(recordingUri);
        if (!fileInfo.exists) {
          showToast({
            type: "error",
            title: "Recording failed",
            message: "Audio file not found",
          });
          await storage.updateTopic(topicId, { status: "pending" });
          if (__DEV__) console.log("[Record] Topic status -> pending (audio file not found)");
          setState("idle");
          return;
        }
        audioBase64 = await FileSystem.readAsStringAsync(recordingUri, {
          encoding: "base64",
        });
      }

      if (!audioBase64) {
        if (__DEV__) console.error("[Record] Empty base64 after conversion");
        throw new Error("Audio conversion produced empty data");
      }

      if (__DEV__)
        console.log(
          `[Record] Audio base64 length: ${audioBase64.length} chars (~${Math.round(audioBase64.length / 1370)}KB)`,
        );

      setProcessingStep("transcribe");

      const uploadUrl = new URL(
        "/api/ai/transcription/upload",
        apiUrl,
      ).toString();
      if (__DEV__) console.log("[Record] Uploading to:", uploadUrl);

      const uploadRes = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        credentials: "include",
        body: JSON.stringify({
          audioBase64,
          durationMinutes: Math.max(1, Math.ceil(duration / 60)),
        }),
      });

      if (__DEV__)
        console.log("[Record] Upload response status:", uploadRes.status);

      if (!uploadRes.ok) {
        const errorText = await uploadRes.text().catch(() => "");
        if (__DEV__)
          console.error(
            "[Record] Upload failed:",
            uploadRes.status,
            errorText,
          );
        let errorMessage = "Failed to upload audio";
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.error || errorMessage;
        } catch {}
        throw new Error(`${errorMessage} (${uploadRes.status})`);
      }

      const uploadData = await uploadRes.json();
      const jobId = uploadData.jobId;

      if (!jobId) {
        throw new Error("No job ID returned from upload");
      }

      const jobResult = await pollJobStatus(jobId);

      if (jobResult.error) {
        throw new Error(jobResult.error);
      }

      const transcriptText = jobResult.transcript || "";
      if (!transcriptText) {
        throw new Error("Empty transcript received");
      }

      await storage.saveTranscript({
        recordingId: `recording-${Date.now()}`,
        topicId,
        text: transcriptText,
        timestamps: [],
      });

      if (recordingUri) {
        try {
          await FileSystem.deleteAsync(recordingUri, { idempotent: true });
        } catch {}
      }

      setSavedTranscript(transcriptText);
      setProcessingStep("complete");

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({
        type: "success",
        title: "Transcription complete!",
        message: "Choose what study materials to create",
      });
      setState("choosing");
    } catch (error) {
      console.error("Processing error:", error);
      await storage.updateTopic(topicId, { status: "pending" }).catch(() => {});
      if (__DEV__) console.log("[Record] Topic status -> pending (processing error catch)");
      if (isMountedRef.current) {
        setState("idle");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        const errorMessage =
          error instanceof Error ? error.message : "Please try again";
        showToast({
          type: "error",
          title: "Processing failed",
          message: errorMessage,
        });
      }
    } finally {
      isProcessingRef.current = false;
    }
  };

  const toggleMaterial = (key: keyof MaterialSelection) => {
    Haptics.selectionAsync();
    setMaterialSelection((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const generateSelectedMaterials = async () => {
    if (isProcessingRef.current || state !== "choosing") return;
    isProcessingRef.current = true;

    if (!savedTranscript) {
      showToast({
        type: "error",
        title: "Error",
        message: "No transcript available",
      });
      isProcessingRef.current = false;
      return;
    }

    const selected = Object.values(materialSelection).some((v) => v);
    if (!selected) {
      showToast({
        type: "warning",
        title: "Nothing selected",
        message: "Please choose at least one material type",
      });
      isProcessingRef.current = false;
      return;
    }

    setState("generating");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const apiUrl = getApiUrl();
      const authHeaders = await getAuthHeaders();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...authHeaders,
      };

      const topic = await storage.getTopic(topicId);
      const succeeded: string[] = [];
      const failed: string[] = [];

      if (materialSelection.notes) {
        setProcessingStep("notes");
        try {
          const notesRes = await fetch(
            `${apiUrl}/api/ai/summarize`,
            {
              method: "POST",
              headers,
              credentials: "include",
              body: JSON.stringify({ text: savedTranscript }),
            },
          );
          if (notesRes.ok) {
            const notesData = await notesRes.json();
            if (notesData.summary) {
              const summaryBullets = notesData.summary
                .split(/\n+/)
                .filter((line: string) => line.trim());
              const timestamp = new Date().toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              });
              await storage.saveNotes({
                topicId,
                title: topic?.name || "Topic Notes",
                sections: [
                  {
                    heading: `Recording (${timestamp})`,
                    bullets: summaryBullets,
                  },
                ],
              });
              succeeded.push("Notes");
            } else {
              failed.push("Notes");
            }
          } else {
            failed.push("Notes");
          }
        } catch {
          failed.push("Notes");
        }
      }

      if (materialSelection.flashcards) {
        setProcessingStep("flashcards");
        try {
          const flashcardsRes = await fetch(
            `${apiUrl}/api/ai/notes-to-flashcards`,
            {
              method: "POST",
              headers,
              credentials: "include",
              body: JSON.stringify({ text: savedTranscript, topicId }),
            },
          );
          if (flashcardsRes.ok) {
            const flashcardsData = await flashcardsRes.json();
            const cards = (flashcardsData.flashcards || []).map(
              (fc: any, i: number) => ({
                id: `fc-${Date.now()}-${i}`,
                topicId,
                question: fc.front,
                answer: fc.back,
                orderIndex: i,
              }),
            );
            if (cards.length > 0) {
              await storage.saveFlashcards(topicId, cards);
              succeeded.push("Flashcards");
            } else {
              failed.push("Flashcards");
            }
          } else {
            failed.push("Flashcards");
          }
        } catch {
          failed.push("Flashcards");
        }
      }

      if (materialSelection.quiz) {
        setProcessingStep("quiz");
        try {
          const quizRes = await fetch(
            `${apiUrl}/api/ai/notes-to-quiz`,
            {
              method: "POST",
              headers,
              credentials: "include",
              body: JSON.stringify({ text: savedTranscript, topicId }),
            },
          );
          if (quizRes.ok) {
            const quizData = await quizRes.json();
            const questions = (quizData.questions || []).map((q: any) => {
              const options =
                typeof q.options === "string" ? JSON.parse(q.options) : q.options;
              let correctIndex = q.correctIndex ?? 0;
              if (q.correctAnswer !== undefined) {
                if (typeof q.correctAnswer === "number") {
                  correctIndex = q.correctAnswer;
                } else if (typeof q.correctAnswer === "string") {
                  const letterIndex = "ABCD".indexOf(
                    q.correctAnswer.toUpperCase(),
                  );
                  correctIndex = letterIndex >= 0 ? letterIndex : 0;
                }
              }
              return { question: q.question, options, correctIndex };
            });
            if (questions.length > 0) {
              await storage.saveQuiz(topicId, questions);
              succeeded.push("Quiz");
            } else {
              failed.push("Quiz");
            }
          } else {
            failed.push("Quiz");
          }
        } catch {
          failed.push("Quiz");
        }
      }

      setProcessingStep("complete");

      if (succeeded.length > 0) {
        await storage.updateTopic(topicId, { status: "completed" });
        setState("completed");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        if (failed.length > 0) {
          showToast({
            type: "warning",
            title: "Partially done",
            message: `Created ${succeeded.join(", ")}. Failed: ${failed.join(", ")}.`,
          });
        } else {
          showToast({
            type: "success",
            title: "All done!",
            message: "Your study materials are ready",
          });
        }
      } else {
        await storage.updateTopic(topicId, { status: "pending" }).catch(() => {});
        if (__DEV__) console.log("[Record] Topic status -> pending (all materials failed)");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        showToast({
          type: "error",
          title: "Generation failed",
          message: "Could not create any study materials. Try again.",
        });
        setState("choosing");
      }
    } catch (error) {
      console.error("Generation error:", error);
      await storage.updateTopic(topicId, { status: "pending" }).catch(() => {});
      if (__DEV__) console.log("[Record] Topic status -> pending (generation error catch)");
      if (isMountedRef.current) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        const errorMessage =
          error instanceof Error ? error.message : "Please try again";
        showToast({
          type: "error",
          title: "Generation failed",
          message: errorMessage,
        });
        setState("choosing");
      }
    } finally {
      isProcessingRef.current = false;
    }
  };

  const handleDone = () => {
    navigation.goBack();
  };

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
  }));

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ringScale.value }],
    opacity: ringOpacity.value,
  }));

  const getProcessingSteps = (): ProcessingStep[] => {
    if (state === "processing") {
      return [
        {
          id: "upload",
          label: "Uploading audio",
          status:
            processingStep === "upload"
              ? "active"
              : ["transcribe", "complete"].includes(processingStep)
                ? "completed"
                : "pending",
        },
        {
          id: "transcribe",
          label: "Transcribing audio",
          status:
            processingStep === "transcribe"
              ? "active"
              : processingStep === "complete"
                ? "completed"
                : "pending",
        },
      ];
    }

    const steps: ProcessingStep[] = [];
    const order = ["notes", "flashcards", "quiz", "complete"];
    const stepIndex = (s: string) => order.indexOf(s);

    if (materialSelection.notes) {
      steps.push({
        id: "notes",
        label: "Generating notes",
        status:
          processingStep === "notes"
            ? "active"
            : stepIndex(processingStep) > stepIndex("notes")
              ? "completed"
              : "pending",
      });
    }
    if (materialSelection.flashcards) {
      steps.push({
        id: "flashcards",
        label: "Creating flashcards",
        status:
          processingStep === "flashcards"
            ? "active"
            : stepIndex(processingStep) > stepIndex("flashcards")
              ? "completed"
              : "pending",
      });
    }
    if (materialSelection.quiz) {
      steps.push({
        id: "quiz",
        label: "Building quiz",
        status:
          processingStep === "quiz"
            ? "active"
            : processingStep === "complete"
              ? "completed"
              : "pending",
      });
    }
    return steps;
  };

  const renderContent = () => {
    switch (state) {
      case "idle":
        if (!permissionGranted) {
          return (
            <View style={styles.centerContent}>
              <View style={styles.instructionContainer}>
                <View
                  style={[
                    styles.instructionIcon,
                    { backgroundColor: "#F59E0B15" },
                  ]}
                >
                  <Icon name="mic" size={32} color="#F59E0B" />
                </View>
                <ThemedText type="h1" style={styles.heading}>
                  Microphone Access
                </ThemedText>
                <ThemedText
                  type="body"
                  style={[styles.instruction, { color: theme.textSecondary }]}
                >
                  StudyMind needs microphone access to record your topics.
                  Audio is sent securely to our servers for AI transcription and
                  is only accessible to you.
                </ThemedText>
              </View>

              <Card style={[styles.permissionCard, { backgroundColor: theme.backgroundDefault, borderColor: theme.border, borderWidth: 1 }]}>
                <View style={styles.permissionRow}>
                  <Icon name="lock" size={16} color="#10B981" />
                  <ThemedText
                    type="small"
                    style={{ color: theme.textSecondary, flex: 1 }}
                  >
                    Recordings are encrypted and stored securely
                  </ThemedText>
                </View>
                <View style={styles.permissionRow}>
                  <Icon name="eye-off" size={16} color="#10B981" />
                  <ThemedText
                    type="small"
                    style={{ color: theme.textSecondary, flex: 1 }}
                  >
                    Only you can access your audio and transcripts
                  </ThemedText>
                </View>
                <View style={styles.permissionRow}>
                  <Icon name="trash-2" size={16} color="#10B981" />
                  <ThemedText
                    type="small"
                    style={{ color: theme.textSecondary, flex: 1 }}
                  >
                    You can delete your data anytime from Settings
                  </ThemedText>
                </View>
              </Card>

              <Button
                size="lg"
                fullWidth
                onPress={async () => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  const status =
                    await AudioModule.requestRecordingPermissionsAsync();
                  setPermissionGranted(status.granted);
                  if (!status.granted) {
                    showToast({
                      type: "error",
                      title: "Permission denied",
                      message:
                        "Microphone access is required to record",
                    });
                  }
                }}
                testID="button-grant-mic"
              >
                Allow Microphone Access
              </Button>
            </View>
          );
        }
        return (
          <View style={styles.centerContent}>
            <View style={styles.instructionContainer}>
              <View
                style={[
                  styles.instructionIcon,
                  { backgroundColor: "#7C3AED20" },
                ]}
              >
                <Icon name="mic" size={32} color="#9F67FF" />
              </View>
              <ThemedText type="h1" style={styles.heading}>
                Ready to Record
              </ThemedText>
              <ThemedText
                type="body"
                style={[styles.instruction, { color: theme.textSecondary }]}
              >
                {"We'll create notes, flashcards, and quizzes for you"}
              </ThemedText>
            </View>

            {/* Waveform placeholder bars */}
            <View style={styles.waveformPlaceholder}>
              {[0.3, 0.5, 0.7, 1.0, 0.7, 0.5, 0.3, 0.5, 0.7, 0.5, 0.3].map((h, i) => (
                <View
                  key={i}
                  style={[
                    styles.waveBar,
                    {
                      height: 40 * h,
                      backgroundColor: "#7C3AED",
                      opacity: 0.25,
                    },
                  ]}
                />
              ))}
            </View>

            <Pressable
              onPress={startRecording}
              style={styles.recordButtonOuter}
            >
              <View
                style={[styles.recordButton, { backgroundColor: "#7C3AED", shadowColor: "#7C3AED", shadowOpacity: 0.4, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 8 }]}
              >
                <Icon name="mic" size={32} color="#fff" />
              </View>
            </Pressable>

            <View style={styles.hintContainer}>
              <Icon
                name="info"
                size={14}
                color={theme.textSecondary}
                style={styles.hintIcon}
              />
              <ThemedText
                type="small"
                style={[styles.hint, { color: theme.textSecondary }]}
              >
                Position your phone close to the speaker for best results
              </ThemedText>
            </View>
          </View>
        );

      case "recording":
        return (
          <View style={styles.centerContent}>
            <View style={styles.timerContainer}>
              <View style={styles.recordingIndicator}>
                <View
                  style={[
                    styles.recordingDot,
                    { backgroundColor: "#EF4444" },
                  ]}
                />
                <ThemedText
                  type="caption"
                  style={{ color: "#EF4444", fontWeight: "700", letterSpacing: 1.5 }}
                >
                  RECORDING
                </ThemedText>
              </View>
              <ThemedText type="display" style={[styles.timer, { color: theme.text }]}>
                {formatTime(duration)}
              </ThemedText>
            </View>

            {/* Animated waveform bars during recording */}
            <View style={styles.waveformPlaceholder}>
              {[0.4, 0.7, 1.0, 0.6, 0.9, 0.5, 1.0, 0.7, 0.4, 0.8, 0.6].map((h, i) => (
                <Animated.View
                  key={i}
                  style={[
                    styles.waveBar,
                    {
                      height: 44 * h,
                      backgroundColor: "#7C3AED",
                      opacity: 0.6 + (i % 3) * 0.1,
                    },
                  ]}
                />
              ))}
            </View>

            <View style={styles.recordButtonContainer}>
              <Animated.View
                style={[
                  styles.recordingRing,
                  { borderColor: "#7C3AED" },
                  ringStyle,
                ]}
              />
              <Animated.View style={pulseStyle}>
                <Pressable
                  onPress={stopRecording}
                  style={styles.recordButtonOuter}
                >
                  <View
                    style={[
                      styles.recordButton,
                      styles.stopButton,
                      { backgroundColor: "#7C3AED", shadowColor: "#7C3AED", shadowOpacity: 0.5, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
                    ]}
                  >
                    <View style={[styles.stopIcon, { backgroundColor: "#fff" }]} />
                  </View>
                </Pressable>
              </Animated.View>
            </View>

            <ThemedText
              type="body"
              style={[styles.tapHint, { color: theme.textSecondary }]}
            >
              Tap the button to stop recording
            </ThemedText>
          </View>
        );

      case "processing":
        return (
          <View style={styles.centerContent}>
            <View style={styles.processingHeader}>
              <View
                style={[
                  styles.processingIconContainer,
                  { backgroundColor: theme.info + "15" },
                ]}
              >
                <Icon name="loader" size={32} color={theme.info} />
              </View>
              <ThemedText type="h2" style={styles.heading}>
                Transcribing Audio
              </ThemedText>
              <ThemedText
                type="body"
                style={[styles.instruction, { color: theme.textSecondary }]}
              >
                This only takes a moment...
              </ThemedText>
            </View>

            <Card style={styles.processingCard}>
              <View style={styles.audioCaptured}>
                <Icon name="check-circle" size={18} color={theme.success} />
                <ThemedText type="body" style={styles.audioCapturedText}>
                  Audio captured ({formatTime(duration)})
                </ThemedText>
              </View>
              <ProcessingTimeline steps={getProcessingSteps()} />
            </Card>
          </View>
        );

      case "choosing":
        return (
          <View style={styles.centerContent}>
            <View style={styles.processingHeader}>
              <View
                style={[
                  styles.completedIconContainer,
                  { backgroundColor: theme.success + "15" },
                ]}
              >
                <Icon name="check" size={40} color={theme.success} />
              </View>
              <ThemedText type="h2" style={styles.heading}>
                Transcription Complete
              </ThemedText>
              <ThemedText
                type="body"
                style={[styles.instruction, { color: theme.textSecondary }]}
              >
                Choose what study materials to create
              </ThemedText>
            </View>

            <Card style={[styles.processingCard, { marginBottom: Spacing.xl }]}>
              <Pressable
                onPress={() => toggleMaterial("notes")}
                style={[
                  styles.materialOption,
                  materialSelection.notes
                    ? { backgroundColor: theme.link + "12" }
                    : null,
                ]}
                testID="toggle-notes"
              >
                <View
                  style={[
                    styles.materialCheck,
                    materialSelection.notes
                      ? { backgroundColor: theme.link, borderColor: theme.link }
                      : { borderColor: theme.textSecondary + "40" },
                  ]}
                >
                  {materialSelection.notes ? (
                    <Icon name="check" size={14} color="#fff" />
                  ) : null}
                </View>
                <View style={styles.materialInfo}>
                  <View style={styles.materialRow}>
                    <Icon name="file-text" size={20} color={theme.link} />
                    <ThemedText type="body" style={styles.materialLabel}>
                      Notes
                    </ThemedText>
                  </View>
                  <ThemedText
                    type="small"
                    style={{ color: theme.textSecondary }}
                  >
                    Structured summary of the topic
                  </ThemedText>
                </View>
              </Pressable>

              <Pressable
                onPress={() => toggleMaterial("flashcards")}
                style={[
                  styles.materialOption,
                  materialSelection.flashcards
                    ? { backgroundColor: theme.warning + "12" }
                    : null,
                ]}
                testID="toggle-flashcards"
              >
                <View
                  style={[
                    styles.materialCheck,
                    materialSelection.flashcards
                      ? {
                          backgroundColor: theme.warning,
                          borderColor: theme.warning,
                        }
                      : { borderColor: theme.textSecondary + "40" },
                  ]}
                >
                  {materialSelection.flashcards ? (
                    <Icon name="check" size={14} color="#fff" />
                  ) : null}
                </View>
                <View style={styles.materialInfo}>
                  <View style={styles.materialRow}>
                    <Icon name="layers" size={20} color={theme.warning} />
                    <ThemedText type="body" style={styles.materialLabel}>
                      Flashcards
                    </ThemedText>
                  </View>
                  <ThemedText
                    type="small"
                    style={{ color: theme.textSecondary }}
                  >
                    Q&A cards for spaced repetition study
                  </ThemedText>
                </View>
              </Pressable>

              <Pressable
                onPress={() => toggleMaterial("quiz")}
                style={[
                  styles.materialOption,
                  styles.materialOptionLast,
                  materialSelection.quiz
                    ? { backgroundColor: theme.success + "12" }
                    : null,
                ]}
                testID="toggle-quiz"
              >
                <View
                  style={[
                    styles.materialCheck,
                    materialSelection.quiz
                      ? {
                          backgroundColor: theme.success,
                          borderColor: theme.success,
                        }
                      : { borderColor: theme.textSecondary + "40" },
                  ]}
                >
                  {materialSelection.quiz ? (
                    <Icon name="check" size={14} color="#fff" />
                  ) : null}
                </View>
                <View style={styles.materialInfo}>
                  <View style={styles.materialRow}>
                    <Icon name="award" size={20} color={theme.success} />
                    <ThemedText type="body" style={styles.materialLabel}>
                      Quiz
                    </ThemedText>
                  </View>
                  <ThemedText
                    type="small"
                    style={{ color: theme.textSecondary }}
                  >
                    Multiple choice questions to test knowledge
                  </ThemedText>
                </View>
              </Pressable>
            </Card>

            <View style={styles.completedActions}>
              <Button onPress={generateSelectedMaterials} size="lg" fullWidth>
                Generate Selected Materials
              </Button>
              <Button
                onPress={handleDone}
                variant="ghost"
                size="lg"
                fullWidth
                style={styles.secondaryButton}
              >
                Skip - View Transcript Only
              </Button>
            </View>
          </View>
        );

      case "generating":
        return (
          <View style={styles.centerContent}>
            <View style={styles.processingHeader}>
              <View
                style={[
                  styles.processingIconContainer,
                  { backgroundColor: theme.info + "15" },
                ]}
              >
                <Icon name="loader" size={32} color={theme.info} />
              </View>
              <ThemedText type="h2" style={styles.heading}>
                Creating Study Materials
              </ThemedText>
              <ThemedText
                type="body"
                style={[styles.instruction, { color: theme.textSecondary }]}
              >
                Generating your selected materials...
              </ThemedText>
            </View>

            <Card style={styles.processingCard}>
              <ProcessingTimeline steps={getProcessingSteps()} />
            </Card>
          </View>
        );

      case "completed":
        return (
          <View style={styles.centerContent}>
            <View style={styles.completedHeader}>
              <View
                style={[
                  styles.completedIconContainer,
                  { backgroundColor: theme.success + "15" },
                ]}
              >
                <Icon name="check" size={40} color={theme.success} />
              </View>
              <ThemedText type="h1" style={styles.heading}>
                All Done!
              </ThemedText>
              <ThemedText
                type="body"
                style={[styles.instruction, { color: theme.textSecondary }]}
              >
                Your study materials are ready to use
              </ThemedText>
            </View>

            <Card style={styles.summaryCard}>
              <View style={styles.summaryRow}>
                <View style={styles.summaryItem}>
                  <Icon name="file-text" size={20} color={theme.link} />
                  <ThemedText type="small" style={styles.summaryLabel}>
                    Notes
                  </ThemedText>
                </View>
                <View style={styles.summaryItem}>
                  <Icon name="layers" size={20} color={theme.warning} />
                  <ThemedText type="small" style={styles.summaryLabel}>
                    Flashcards
                  </ThemedText>
                </View>
                <View style={styles.summaryItem}>
                  <Icon name="award" size={20} color={theme.success} />
                  <ThemedText type="small" style={styles.summaryLabel}>
                    Quiz
                  </ThemedText>
                </View>
              </View>
            </Card>

            <View style={styles.completedActions}>
              <Button onPress={handleDone} size="lg" fullWidth>
                View Study Materials
              </Button>
              <Button
                onPress={() => navigation.navigate("StudyToday" as never)}
                variant="secondary"
                size="lg"
                fullWidth
                style={styles.secondaryButton}
              >
                Start Studying
              </Button>
            </View>
          </View>
        );
    }
  };

  return (
    <ThemedView style={styles.container}>
      <View
        style={[
          styles.content,
          {
            paddingTop: headerHeight + Spacing.xl,
            paddingBottom: insets.bottom + Spacing["2xl"],
          },
        ]}
      >
        {renderContent()}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing["2xl"],
  },
  centerContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  instructionContainer: {
    alignItems: "center",
    marginBottom: Spacing["4xl"],
  },
  instructionIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xl,
  },
  heading: {
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  instruction: {
    textAlign: "center",
    maxWidth: 300,
    lineHeight: 22,
  },
  waveformPlaceholder: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 56,
    marginBottom: Spacing["2xl"],
  },
  waveBar: {
    width: 5,
    borderRadius: 3,
  },
  recordButtonOuter: {
    marginBottom: Spacing["2xl"],
  },
  recordButton: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
  },
  stopButton: {
    borderRadius: 32,
  },
  stopIcon: {
    width: 36,
    height: 36,
    backgroundColor: "#fff",
    borderRadius: 8,
  },
  hintContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.xl,
  },
  hintIcon: {
    marginRight: Spacing.xs,
  },
  hint: {
    textAlign: "center",
  },
  timerContainer: {
    alignItems: "center",
    marginBottom: Spacing["4xl"],
  },
  recordingIndicator: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: Spacing.xs,
  },
  timer: {
    fontSize: 72,
    fontWeight: "200",
    letterSpacing: -2,
  },
  recordButtonContainer: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing["2xl"],
  },
  recordingRing: {
    position: "absolute",
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
  },
  tapHint: {
    textAlign: "center",
  },
  processingHeader: {
    alignItems: "center",
    marginBottom: Spacing["2xl"],
  },
  processingIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xl,
  },
  processingCard: {
    width: "100%",
  },
  audioCaptured: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.md,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.1)",
  },
  audioCapturedText: {
    marginLeft: Spacing.sm,
  },
  completedHeader: {
    alignItems: "center",
    marginBottom: Spacing["2xl"],
  },
  completedIconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xl,
  },
  summaryCard: {
    width: "100%",
    marginBottom: Spacing["2xl"],
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  summaryItem: {
    alignItems: "center",
  },
  summaryLabel: {
    marginTop: Spacing.xs,
    fontWeight: "500",
  },
  completedActions: {
    width: "100%",
  },
  secondaryButton: {
    marginTop: Spacing.md,
  },
  materialOption: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.06)",
    borderRadius: BorderRadius.md,
    marginBottom: 2,
  },
  materialOptionLast: {
    borderBottomWidth: 0,
    marginBottom: 0,
  },
  materialCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.md,
  },
  materialInfo: {
    flex: 1,
  },
  materialRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: 2,
  },
  materialLabel: {
    fontWeight: "600",
  },
  permissionCard: {
    width: "100%",
    marginBottom: Spacing.xl,
    paddingVertical: Spacing.sm,
  },
  permissionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
});
