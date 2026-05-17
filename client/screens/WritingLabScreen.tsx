import React, { useState, useCallback } from "react";
import {
  View,
  ScrollView,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { shareOrDownload } from "@/lib/export";
import { useToast } from "@/components/Toast";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRoute, useNavigation } from "@react-navigation/native";
import { useDismissibleHint } from "@/hooks/useDismissibleHint";
import Icon from "@expo/vector-icons/Feather";
import { storage } from "@/lib/storage";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest, isNetworkError } from "@/lib/query-client";
import { Spacing, BorderRadius, Typography } from "@/constants/theme";

type TabKey = "essay" | "rewrite" | "clean";

const GRADE_LEVELS = ["Middle School", "High School", "College"];
const TONES = ["Neutral", "Formal", "Casual"];
const CITATION_STYLES = ["APA", "MLA", "Chicago", "None"];
const STYLE_MODES = [
  { value: "clearer", label: "Clearer" },
  { value: "formal", label: "More Formal" },
  { value: "casual", label: "More Casual" },
  { value: "shorten", label: "Shorten" },
  { value: "flow", label: "Improve Flow" },
  { value: "grammar", label: "Fix Grammar" },
];

export default function WritingLabScreen() {
  const { theme } = useTheme();
  const { user, isAuthenticated } = useAuth();
  const navigation = useNavigation();
  const route = useRoute<any>();
  const initialMode: TabKey = route.params?.initialMode ?? "essay";
  const initialText: string = route.params?.initialText ?? "";
  const sourceNoteId: string | undefined = route.params?.sourceNoteId;
  const sourceTopicId: string | undefined = route.params?.sourceTopicId;
  const sourceNoteTitle: string | undefined = route.params?.sourceNoteTitle;
  const sourceTopicName: string | undefined = route.params?.sourceTopicName;
  const [activeTab, setActiveTab] = useState<TabKey>(initialMode);

  const handleBackToNotes = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const tabGuide = useDismissibleHint("@studymind_hint_writinglab_tabs");

  if (!isAuthenticated || !user) {
    return <LoginPrompt theme={theme} />;
  }

  return (
    <ThemedView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}
      >
        {sourceNoteId ? (
          <SourceNoteBanner
            theme={theme}
            noteTitle={sourceNoteTitle}
            topicName={sourceTopicName}
          />
        ) : null}
        {tabGuide.visible ? (
          <WritingLabGuideCard onDismiss={tabGuide.dismiss} theme={theme} />
        ) : null}
        <TabBar activeTab={activeTab} onTabChange={setActiveTab} theme={theme} />
        {activeTab === "essay" ? (
          <EssayTab
            theme={theme}
            initialNotes={initialText}
            sourceTopicId={sourceTopicId}
            onBackToNotes={sourceNoteId ? handleBackToNotes : undefined}
          />
        ) : activeTab === "rewrite" ? (
          <RewriteTab
            theme={theme}
            sourceTopicId={sourceTopicId}
            onBackToNotes={sourceNoteId ? handleBackToNotes : undefined}
          />
        ) : (
          <CleanTab
            theme={theme}
            sourceTopicId={sourceTopicId}
            onBackToNotes={sourceNoteId ? handleBackToNotes : undefined}
          />
        )}
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

function SourceNoteBanner({
  theme,
  noteTitle,
  topicName,
}: {
  theme: any;
  noteTitle?: string;
  topicName?: string;
}) {
  const label =
    noteTitle && topicName
      ? `From: ${noteTitle} · ${topicName}`
      : noteTitle
        ? `From: ${noteTitle}`
        : topicName
          ? `From topic: ${topicName}`
          : "Using note content as source material";

  return (
    <View
      style={[
        styles.sourceBanner,
        { backgroundColor: theme.link + "12", borderColor: theme.link + "30", borderLeftColor: theme.link },
      ]}
    >
      <Icon name="file-text" size={14} color={theme.link} />
      <ThemedText
        type="small"
        style={{ color: theme.link, marginLeft: Spacing.xs, flex: 1 }}
        numberOfLines={1}
      >
        {label}
      </ThemedText>
    </View>
  );
}

function WritingLabGuideCard({
  onDismiss,
  theme,
}: {
  onDismiss: () => void;
  theme: any;
}) {
  const tabs = [
    { label: "Essay", desc: "Generate an outline and full draft from a topic and your notes" },
    { label: "Rewrite", desc: "Improve, shorten, or change the style of any existing text" },
    { label: "Clean", desc: "Strip HTML tags, special characters, and formatting artifacts" },
  ];
  return (
    <View
      style={[
        styles.guideCard,
        { backgroundColor: theme.link + "09", borderColor: theme.link + "22" },
      ]}
    >
      <View style={styles.guideHeader}>
        <Icon name="info" size={13} color={theme.link} />
        <ThemedText type="caption" style={[styles.guideTitle, { color: theme.link }]}>
          Writing Lab tabs
        </ThemedText>
        <Pressable onPress={onDismiss} hitSlop={12} accessibilityLabel="Dismiss guide">
          <Icon name="x" size={14} color={theme.textSecondary} />
        </Pressable>
      </View>
      {tabs.map(({ label, desc }) => (
        <View key={label} style={styles.guideRow}>
          <ThemedText type="caption" style={[styles.guideRowLabel, { color: theme.link }]}>
            {label}
          </ThemedText>
          <ThemedText type="caption" style={[styles.guideRowDesc, { color: theme.textSecondary }]}>
            — {desc}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

function LoginPrompt({ theme }: { theme: any }) {
  return (
    <ThemedView style={styles.container}>
      <View style={styles.loginPrompt}>
        <Icon name="lock" size={48} color={theme.textSecondary} />
        <ThemedText
          type="h2"
          style={{ marginTop: Spacing.lg, textAlign: "center" }}
        >
          Log in to use Writing Lab
        </ThemedText>
        <ThemedText
          type="small"
          style={{
            color: theme.textSecondary,
            marginTop: Spacing.sm,
            textAlign: "center",
          }}
        >
          Sign in with your account to access AI-powered writing tools.
        </ThemedText>
      </View>
    </ThemedView>
  );
}

function TabBar({
  activeTab,
  onTabChange,
  theme,
}: {
  activeTab: TabKey;
  onTabChange: (t: TabKey) => void;
  theme: any;
}) {
  const tabs: { key: TabKey; label: string; icon: string }[] = [
    { key: "essay", label: "Essay", icon: "edit-3" },
    { key: "rewrite", label: "Rewrite", icon: "refresh-cw" },
    { key: "clean", label: "Clean", icon: "scissors" },
  ];

  return (
    <View
      style={[styles.tabBar, { backgroundColor: theme.backgroundSecondary }]}
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.key;
        return (
          <Pressable
            key={tab.key}
            style={[
              styles.tabItem,
              isActive && { backgroundColor: theme.link },
            ]}
            onPress={() => {
              Haptics.selectionAsync();
              onTabChange(tab.key);
            }}
            testID={`tab-${tab.key}`}
            accessibilityLabel={tab.label}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
          >
            <Icon
              name={tab.icon as any}
              size={16}
              color={isActive ? "#FFFFFF" : theme.textSecondary}
            />
            <ThemedText
              type="small"
              style={{
                color: isActive ? "#FFFFFF" : theme.textSecondary,
                marginLeft: Spacing.xs,
                fontWeight: isActive ? "600" : "400",
              }}
            >
              {tab.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

function useApiCall() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = useCallback(
    async (
      route: string,
      body: Record<string, unknown>,
    ): Promise<any | null> => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiRequest("POST", route, body);
        const data = await res.json();
        return data;
      } catch (err: any) {
        let msg = "Something went wrong. Tap the button above to try again.";
        if (isNetworkError(err)) {
          msg = "You appear to be offline. Check your connection and try again.";
        } else {
          try {
            if (err?.message) {
              const match = err.message.match(/\d{3}/);
              const status = match ? parseInt(match[0]) : 0;
              if (status === 401) {
                msg = "Please log in to continue.";
              } else if (status === 403) {
                msg = "This feature requires a plan upgrade.";
              } else if (status === 429) {
                msg = "Daily limit reached. Try again tomorrow.";
              } else if (status === 503) {
                msg = "AI temporarily unavailable. Please try again later.";
              } else {
                msg = err.message || msg;
              }
            }
          } catch {}

          if (msg === "Something went wrong. Tap the button above to try again." && err?.status) {
            const s = err.status;
            if (s === 401) msg = "Please log in to continue.";
            else if (s === 403) msg = "This feature requires a plan upgrade.";
            else if (s === 429) msg = "Daily limit reached. Try again tomorrow.";
            else if (s === 503) msg = "AI temporarily unavailable. Please try again later.";
          }
        }
        setError(msg);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { call, loading, error, setError };
}

function DropdownPicker({
  label,
  options,
  value,
  onChange,
  theme,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
  theme: any;
}) {
  return (
    <View style={styles.fieldContainer}>
      <ThemedText
        type="small"
        style={{ color: theme.textSecondary, marginBottom: Spacing.xs }}
      >
        {label}
      </ThemedText>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipRow}
      >
        {options.map((opt) => (
          <Pressable
            key={opt}
            style={[
              styles.chip,
              {
                backgroundColor:
                  value === opt ? theme.link : theme.backgroundSecondary,
                borderColor: value === opt ? theme.link : theme.border,
              },
            ]}
            onPress={() => onChange(opt)}
          >
            <ThemedText
              type="caption"
              style={{
                color: value === opt ? "#FFFFFF" : theme.text,
              }}
            >
              {opt}
            </ThemedText>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

type SaveResult = "success" | "error" | "no-source";

function OutputBox({
  output,
  theme,
  label,
  onSaveToNotes,
  onBackToNotes,
}: {
  output: string;
  theme: any;
  label?: string;
  onSaveToNotes?: () => Promise<SaveResult>;
  onBackToNotes?: () => void;
}) {
  const { showToast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | SaveResult>("idle");

  const handleCopy = async () => {
    await Clipboard.setStringAsync(output);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleShare = async () => {
    const html = `<html><body><div style="font-family:sans-serif;line-height:1.6;padding:20px;"><h2>${label || "Output"}</h2><div style="white-space:pre-wrap;">${output}</div></div></body></html>`;
    const result = await shareOrDownload({ html, plainText: output, title: label || "Writing" });
    if (result.method === "copied") {
      showToast({ type: "success", title: "Copied", message: "Content copied to clipboard" });
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleSave = async () => {
    if (!onSaveToNotes) return;
    setIsSaving(true);
    setSaveState("idle");
    const result = await onSaveToNotes();
    setSaveState(result);
    setIsSaving(false);
    if (result === "success") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  if (!output) return null;

  return (
    <View style={styles.outputContainer}>
      <View style={styles.outputHeader}>
        <ThemedText type="h4">{label || "Output"}</ThemedText>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Pressable
            onPress={handleCopy}
            style={[styles.copyButton, { backgroundColor: theme.link }]}
            testID="button-copy"
            accessibilityLabel="Copy output to clipboard"
            accessibilityRole="button"
          >
            <Icon name="copy" size={14} color="#FFFFFF" />
            <ThemedText
              type="caption"
              style={{ color: "#FFFFFF", marginLeft: Spacing.xs }}
            >
              Copy
            </ThemedText>
          </Pressable>
          <Pressable
            onPress={handleShare}
            style={[styles.copyButton, { backgroundColor: theme.info, marginLeft: Spacing.xs }]}
            testID="button-share"
            accessibilityLabel="Share output"
            accessibilityRole="button"
          >
            <Icon name="share" size={14} color="#FFFFFF" />
            <ThemedText type="caption" style={{ color: "#FFFFFF", marginLeft: Spacing.xs }}>Share</ThemedText>
          </Pressable>
        </View>
      </View>
      <ScrollView
        style={[
          styles.outputScroll,
          {
            backgroundColor: theme.backgroundSecondary,
            borderColor: theme.border,
          },
        ]}
        nestedScrollEnabled
      >
        <ThemedText type="body" style={{ color: theme.text }} selectable>
          {output}
        </ThemedText>
      </ScrollView>
      {onSaveToNotes ? (
        <View style={styles.saveRow}>
          <Pressable
            onPress={handleSave}
            disabled={isSaving || saveState === "success"}
            style={[
              styles.saveButton,
              { backgroundColor: theme.link + "15", borderColor: theme.link + "40" },
              saveState === "success" && { opacity: 0.4 },
            ]}
            testID="button-save-notes"
          >
            {isSaving ? (
              <ActivityIndicator size="small" color={theme.link} />
            ) : (
              <Icon name="bookmark" size={14} color={theme.link} />
            )}
            <ThemedText
              type="small"
              style={{ color: theme.link, marginLeft: Spacing.xs, fontWeight: "600" }}
            >
              {isSaving ? "Saving..." : "Save to Notes"}
            </ThemedText>
          </Pressable>
          {saveState === "success" ? (
            <View style={{ flexDirection: "row", alignItems: "center", marginLeft: Spacing.sm, gap: Spacing.sm }}>
              <ThemedText type="small" style={{ color: theme.success }}>
                Saved!
              </ThemedText>
              {onBackToNotes ? (
                <Pressable
                  onPress={onBackToNotes}
                  style={[styles.backButton, { backgroundColor: theme.success + "15", borderColor: theme.success + "40" }]}
                  testID="button-back-to-notes"
                >
                  <Icon name="arrow-left" size={12} color={theme.success} />
                  <ThemedText type="caption" style={{ color: theme.success, marginLeft: 4, fontWeight: "600" }}>
                    Back to Notes
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>
          ) : saveState === "error" ? (
            <ThemedText type="small" style={{ color: theme.error, marginLeft: Spacing.sm }}>
              Failed to save. Try again.
            </ThemedText>
          ) : saveState === "no-source" ? (
            <ThemedText
              type="small"
              style={{ color: theme.textSecondary, marginLeft: Spacing.sm, flex: 1 }}
            >
              Open Writing Lab from a topic note to save output back to notes.
            </ThemedText>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function ErrorBanner({
  error,
  theme,
  onDismiss,
}: {
  error: string | null;
  theme: any;
  onDismiss: () => void;
}) {
  if (!error) return null;
  return (
    <View
      style={[
        styles.errorBanner,
        {
          backgroundColor: theme.error + "15",
          borderColor: theme.error + "40",
        },
      ]}
    >
      <Icon name="alert-circle" size={16} color={theme.error} />
      <ThemedText
        type="small"
        style={{ color: theme.error, flex: 1, marginLeft: Spacing.sm }}
      >
        {error}
      </ThemedText>
      <Pressable onPress={onDismiss} hitSlop={8} accessibilityLabel="Dismiss error">
        <Icon name="x" size={16} color={theme.error} />
      </Pressable>
    </View>
  );
}

function ActionButton({
  label,
  icon,
  onPress,
  loading,
  theme,
  variant = "primary",
  testID,
}: {
  label: string;
  icon: string;
  onPress: () => void;
  loading: boolean;
  theme: any;
  variant?: "primary" | "secondary";
  testID?: string;
}) {
  const isPrimary = variant === "primary";
  return (
    <Pressable
      style={[
        styles.actionButton,
        {
          backgroundColor: isPrimary ? theme.link : theme.backgroundSecondary,
          borderColor: isPrimary ? theme.link : theme.border,
          opacity: loading ? 0.5 : 1,
        },
      ]}
      onPress={onPress}
      disabled={loading}
      testID={testID}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: loading, busy: loading }}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={isPrimary ? "#FFFFFF" : theme.text}
        />
      ) : (
        <Icon
          name={icon as any}
          size={16}
          color={isPrimary ? "#FFFFFF" : theme.text}
        />
      )}
      <ThemedText
        type="small"
        style={{
          color: isPrimary ? "#FFFFFF" : theme.text,
          marginLeft: Spacing.sm,
          fontWeight: "600",
        }}
      >
        {label}
      </ThemedText>
    </Pressable>
  );
}

function EssayTab({
  theme,
  initialNotes = "",
  sourceTopicId,
  onBackToNotes,
}: {
  theme: any;
  initialNotes?: string;
  sourceTopicId?: string;
  onBackToNotes?: () => void;
}) {
  const [topic, setTopic] = useState("");
  const [gradeLevel, setGradeLevel] = useState("College");
  const [wordCount, setWordCount] = useState("800");
  const [tone, setTone] = useState("Neutral");
  const [citationStyle, setCitationStyle] = useState("APA");
  const [notes, setNotes] = useState(initialNotes);
  const [outline, setOutline] = useState("");
  const [draft, setDraft] = useState("");
  const { call, loading, error, setError } = useApiCall();

  const makeSaveHandler = useCallback(
    (text: string, sectionHeading: string) => async (): Promise<SaveResult> => {
      if (!sourceTopicId) return "no-source";
      try {
        const bullets = text.split("\n").filter((l) => l.trim().length > 0);
        await storage.saveNotes({
          topicId: sourceTopicId,
          title: "",
          sections: [{ heading: sectionHeading, bullets }],
        });
        return "success";
      } catch {
        return "error";
      }
    },
    [sourceTopicId],
  );

  const handleOutline = async () => {
    if (!topic.trim()) return;
    const data = await call("/api/writing/outline", {
      thesis: topic,
      subject: notes || undefined,
      level: gradeLevel,
    });
    if (data?.outline) setOutline(data.outline);
  };

  const handleDraft = async () => {
    const outlineText = outline || topic;
    if (!outlineText.trim()) return;
    const data = await call("/api/writing/draft", {
      outlineText,
      wordCount: parseInt(wordCount) || 800,
      tone: tone.toLowerCase(),
    });
    if (data?.draft) setDraft(data.draft);
  };

  const handleRevise = async () => {
    const text = draft || outline;
    if (!text.trim()) return;
    const data = await call("/api/writing/revise", {
      text,
      instructions: `Grade level: ${gradeLevel}. Citation style: ${citationStyle}. Tone: ${tone}.`,
    });
    if (data?.revised) setDraft(data.revised);
  };

  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={styles.tabContent}
      contentContainerStyle={{ paddingBottom: insets.bottom + Spacing["3xl"] }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <ErrorBanner
        error={error}
        theme={theme}
        onDismiss={() => setError(null)}
      />

      <ThemedText type="small" style={[styles.tabDesc, { color: theme.textSecondary }]}>
        Enter a topic or thesis below, adjust your settings, then generate an outline or full draft.
        {initialNotes ? " Your notes have been pre-filled as source material." : ""}
      </ThemedText>

      <View style={styles.fieldContainer}>
        <ThemedText
          type="small"
          style={{ color: theme.textSecondary, marginBottom: Spacing.xs }}
        >
          Topic / Thesis
        </ThemedText>
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: theme.inputBackground,
              borderColor: theme.inputBorder,
              color: theme.text,
            },
          ]}
          value={topic}
          onChangeText={setTopic}
          placeholder="Enter your essay topic or thesis..."
          placeholderTextColor={theme.placeholder}
          multiline
          testID="input-topic"
        />
      </View>

      <DropdownPicker
        label="Grade Level"
        options={GRADE_LEVELS}
        value={gradeLevel}
        onChange={setGradeLevel}
        theme={theme}
      />

      <View style={styles.rowFields}>
        <View style={{ flex: 1, marginRight: Spacing.sm }}>
          <ThemedText
            type="small"
            style={{ color: theme.textSecondary, marginBottom: Spacing.xs }}
          >
            Word Count
          </ThemedText>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: theme.inputBackground,
                borderColor: theme.inputBorder,
                color: theme.text,
              },
            ]}
            value={wordCount}
            onChangeText={(t) => setWordCount(t.replace(/[^0-9]/g, ""))}
            placeholder="800"
            placeholderTextColor={theme.placeholder}
            keyboardType="numeric"
            maxLength={5}
            testID="input-word-count"
          />
        </View>
      </View>

      <DropdownPicker
        label="Tone"
        options={TONES}
        value={tone}
        onChange={setTone}
        theme={theme}
      />
      <DropdownPicker
        label="Citation Style"
        options={CITATION_STYLES}
        value={citationStyle}
        onChange={setCitationStyle}
        theme={theme}
      />

      <View style={styles.fieldContainer}>
        <ThemedText
          type="small"
          style={{ color: theme.textSecondary, marginBottom: Spacing.xs }}
        >
          Additional Notes (optional)
        </ThemedText>
        <TextInput
          style={[
            styles.inputMultiline,
            {
              backgroundColor: theme.inputBackground,
              borderColor: theme.inputBorder,
              color: theme.text,
            },
          ]}
          value={notes}
          onChangeText={setNotes}
          placeholder="Any additional context or requirements..."
          placeholderTextColor={theme.placeholder}
          multiline
          numberOfLines={3}
          testID="input-notes"
        />
      </View>

      <View style={styles.buttonRow}>
        <ActionButton
          label="Generate Outline"
          icon="list"
          onPress={handleOutline}
          loading={loading}
          theme={theme}
          testID="button-outline"
        />
        <ActionButton
          label="Write Draft"
          icon="file-text"
          onPress={handleDraft}
          loading={loading}
          theme={theme}
          variant="secondary"
          testID="button-draft"
        />
        <ActionButton
          label="Improve Draft"
          icon="trending-up"
          onPress={handleRevise}
          loading={loading}
          theme={theme}
          variant="secondary"
          testID="button-revise"
        />
      </View>

      {outline ? (
        <OutputBox
          output={outline}
          theme={theme}
          label="Outline"
          onSaveToNotes={makeSaveHandler(outline, "Outline")}
          onBackToNotes={onBackToNotes}
        />
      ) : null}
      {draft ? (
        <OutputBox
          output={draft}
          theme={theme}
          label="Draft"
          onSaveToNotes={makeSaveHandler(draft, "Essay Draft")}
          onBackToNotes={onBackToNotes}
        />
      ) : null}
    </ScrollView>
  );
}

function RewriteTab({ theme, sourceTopicId, onBackToNotes }: { theme: any; sourceTopicId?: string; onBackToNotes?: () => void }) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState("clearer");
  const [output, setOutput] = useState("");
  const { call, loading, error, setError } = useApiCall();

  const handleRewrite = async () => {
    if (!text.trim()) return;
    const data = await call("/api/writing/style-edit", { text, mode });
    if (data?.edited) setOutput(data.edited);
  };

  const handleSaveRewrite = useCallback(async (): Promise<SaveResult> => {
    if (!sourceTopicId) return "no-source";
    try {
      const bullets = output.split("\n").filter((l) => l.trim().length > 0);
      await storage.saveNotes({
        topicId: sourceTopicId,
        title: "",
        sections: [{ heading: "Rewritten", bullets }],
      });
      return "success";
    } catch {
      return "error";
    }
  }, [sourceTopicId, output]);

  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={styles.tabContent}
      contentContainerStyle={{ paddingBottom: insets.bottom + Spacing["3xl"] }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <ErrorBanner
        error={error}
        theme={theme}
        onDismiss={() => setError(null)}
      />

      <ThemedText type="small" style={[styles.tabDesc, { color: theme.textSecondary }]}>
        Paste any text and choose a style mode to improve it — clearer, shorter, more formal, or grammar-fixed.
      </ThemedText>

      <View style={styles.fieldContainer}>
        <ThemedText
          type="small"
          style={{ color: theme.textSecondary, marginBottom: Spacing.xs }}
        >
          Paste your text
        </ThemedText>
        <TextInput
          style={[
            styles.inputLarge,
            {
              backgroundColor: theme.inputBackground,
              borderColor: theme.inputBorder,
              color: theme.text,
            },
          ]}
          value={text}
          onChangeText={setText}
          placeholder="Paste the text you want to rewrite..."
          placeholderTextColor={theme.placeholder}
          multiline
          textAlignVertical="top"
          testID="input-rewrite-text"
        />
      </View>

      <View style={styles.fieldContainer}>
        <ThemedText
          type="small"
          style={{ color: theme.textSecondary, marginBottom: Spacing.xs }}
        >
          Style Mode
        </ThemedText>
        <View style={styles.modeGrid}>
          {STYLE_MODES.map((m) => (
            <Pressable
              key={m.value}
              style={[
                styles.modeChip,
                {
                  backgroundColor:
                    mode === m.value ? theme.link : theme.backgroundSecondary,
                  borderColor: mode === m.value ? theme.link : theme.border,
                },
              ]}
              onPress={() => setMode(m.value)}
            >
              <ThemedText
                type="caption"
                style={{ color: mode === m.value ? "#FFFFFF" : theme.text }}
              >
                {m.label}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      </View>

      <ActionButton
        label="Rewrite"
        icon="refresh-cw"
        onPress={handleRewrite}
        loading={loading}
        theme={theme}
        testID="button-rewrite"
      />

      {output ? (
        <OutputBox
          output={output}
          theme={theme}
          label="Rewritten Text"
          onSaveToNotes={handleSaveRewrite}
          onBackToNotes={onBackToNotes}
        />
      ) : null}
    </ScrollView>
  );
}

function CleanTab({ theme, sourceTopicId, onBackToNotes }: { theme: any; sourceTopicId?: string; onBackToNotes?: () => void }) {
  const [text, setText] = useState("");
  const [output, setOutput] = useState("");
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const { call, loading, error, setError } = useApiCall();

  const handleClean = async () => {
    if (!text.trim()) return;
    const data = await call("/api/writing/clean", { text });
    if (data?.cleanedText) {
      setOutput(data.cleanedText);
      setStats(data.stats || null);
    }
  };

  const handleSaveClean = useCallback(async (): Promise<SaveResult> => {
    if (!sourceTopicId) return "no-source";
    try {
      const bullets = output.split("\n").filter((l) => l.trim().length > 0);
      await storage.saveNotes({
        topicId: sourceTopicId,
        title: "",
        sections: [{ heading: "Cleaned", bullets }],
      });
      return "success";
    } catch {
      return "error";
    }
  }, [sourceTopicId, output]);

  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={styles.tabContent}
      contentContainerStyle={{ paddingBottom: insets.bottom + Spacing["3xl"] }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <ErrorBanner
        error={error}
        theme={theme}
        onDismiss={() => setError(null)}
      />

      <ThemedText type="small" style={[styles.tabDesc, { color: theme.textSecondary }]}>
        Paste text with messy formatting, HTML tags, or invisible characters and get a clean version back.
      </ThemedText>

      <View style={styles.fieldContainer}>
        <ThemedText
          type="small"
          style={{ color: theme.textSecondary, marginBottom: Spacing.xs }}
        >
          Paste text to clean
        </ThemedText>
        <TextInput
          style={[
            styles.inputLarge,
            {
              backgroundColor: theme.inputBackground,
              borderColor: theme.inputBorder,
              color: theme.text,
            },
          ]}
          value={text}
          onChangeText={setText}
          placeholder="Paste text with formatting issues, HTML tags, or special characters..."
          placeholderTextColor={theme.placeholder}
          multiline
          textAlignVertical="top"
          testID="input-clean-text"
        />
      </View>

      <ActionButton
        label="Clean Text"
        icon="scissors"
        onPress={handleClean}
        loading={loading}
        theme={theme}
        testID="button-clean"
      />

      {stats ? (
        <View
          style={[
            styles.statsContainer,
            {
              backgroundColor: theme.backgroundSecondary,
              borderColor: theme.border,
            },
          ]}
        >
          <ThemedText type="h4" style={{ marginBottom: Spacing.sm }}>
            Cleaning Stats
          </ThemedText>
          <View style={styles.statsRow}>
            <StatItem
              label="Characters Removed"
              value={stats.charactersRemoved}
              theme={theme}
            />
            <StatItem
              label="HTML Tags"
              value={stats.htmlTagsRemoved}
              theme={theme}
            />
          </View>
          <View style={styles.statsRow}>
            <StatItem
              label="Zero-Width Chars"
              value={stats.zeroWidthCharsRemoved}
              theme={theme}
            />
            <StatItem
              label="Smart Quotes Fixed"
              value={stats.smartQuotesNormalized}
              theme={theme}
            />
          </View>
        </View>
      ) : null}

      {output ? (
        <OutputBox
          output={output}
          theme={theme}
          label="Cleaned Text"
          onSaveToNotes={handleSaveClean}
          onBackToNotes={onBackToNotes}
        />
      ) : null}
    </ScrollView>
  );
}

function StatItem({
  label,
  value,
  theme,
}: {
  label: string;
  value: number;
  theme: any;
}) {
  return (
    <View style={styles.statItem}>
      <ThemedText type="h3" style={{ color: theme.link }}>
        {value}
      </ThemedText>
      <ThemedText
        type="caption"
        style={{ color: theme.textSecondary, marginTop: 2 }}
      >
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  sourceBanner: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderLeftWidth: 3,
  },
  loginPrompt: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing["3xl"],
  },
  tabBar: {
    flexDirection: "row",
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    borderRadius: BorderRadius.md,
    padding: Spacing.xs,
    gap: Spacing.xs,
  },
  tabItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
    minHeight: 44,
  },
  tabContent: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  tabDesc: {
    lineHeight: 20,
    marginBottom: Spacing.lg,
    opacity: 0.85,
  },
  fieldContainer: {
    marginBottom: Spacing.lg,
  },
  input: {
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    ...Typography.body,
    minHeight: Spacing.inputHeight,
  },
  inputMultiline: {
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    ...Typography.body,
    minHeight: 80,
    textAlignVertical: "top" as any,
  },
  inputLarge: {
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    ...Typography.body,
    minHeight: 150,
    textAlignVertical: "top" as any,
  },
  chipRow: {
    flexDirection: "row",
  },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    marginRight: Spacing.sm,
    minHeight: 36,
    justifyContent: "center",
  },
  rowFields: {
    flexDirection: "row",
    marginBottom: Spacing.lg,
  },
  buttonRow: {
    gap: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    minHeight: 48,
    marginBottom: Spacing.sm,
  },
  outputContainer: {
    marginTop: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  outputHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.sm,
  },
  copyButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
    minHeight: 36,
  },
  outputScroll: {
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    padding: Spacing.lg,
    maxHeight: 300,
  },
  saveRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: Spacing.sm,
    flexWrap: "wrap",
  },
  saveButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    minHeight: 36,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
  },
  guideCard: {
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    padding: Spacing.md,
    gap: 4,
  },
  guideHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginBottom: 2,
  },
  guideTitle: {
    flex: 1,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  guideRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingLeft: 2,
    gap: 2,
  },
  guideRowLabel: {
    fontWeight: "700",
    width: 48,
    flexShrink: 0,
  },
  guideRowDesc: {
    flex: 1,
    lineHeight: 18,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    marginBottom: Spacing.lg,
  },
  modeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  modeChip: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    minHeight: 36,
    justifyContent: "center",
  },
  statsContainer: {
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    padding: Spacing.lg,
    marginTop: Spacing.lg,
  },
  statsRow: {
    flexDirection: "row",
    marginBottom: Spacing.sm,
  },
  statItem: {
    flex: 1,
    alignItems: "center",
  },
});
