import React, { useState, useCallback, useRef, useMemo } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  Modal,
  Alert,
  ActivityIndicator,
  LayoutAnimation,
  Platform,
  UIManager,
} from "react-native";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import { shareOrDownload } from "@/lib/export";
import { useToast } from "@/components/Toast";
import { Icon } from "@/components/Icon";
import { storage } from "@/lib/storage";

import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import type { Notes, NotesSection, Topic } from "@/types";
import { useDismissibleHint } from "@/hooks/useDismissibleHint";

const PREVIEW_COUNT = 3;
const JUMP_NAV_THRESHOLD = 3; // show jump nav when >= this many sections

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

interface NotesTabProps {
  notes: Notes | null;
  isGenerating: boolean;
  onGenerate: () => void;
  onSaveNotes?: (updatedNotes: Notes) => void;
  onRegenerateFromNotes?: (notesText: string) => void;
  isRegenerating?: boolean;
  onSendToWritingLab?: (text: string, noteId: string) => void;
  topicId?: string;
  courseId?: string;
}

export default function NotesTab({
  notes,
  isGenerating,
  onGenerate,
  onSaveNotes,
  onRegenerateFromNotes,
  isRegenerating,
  onSendToWritingLab,
  topicId,
  courseId,
}: NotesTabProps) {
  const { theme } = useTheme();
  const { showToast } = useToast();
  const notesGuide = useDismissibleHint("@studymind_hint_notes_guide");

  // --- scroll / layout ---
  const scrollRef = useRef<ScrollView>(null);
  const sectionOffsets = useRef<Record<number, number>>({});

  // --- full note edit state ---
  const [isEditing, setIsEditing] = useState(false);
  const [editedSections, setEditedSections] = useState<NotesSection[]>([]);
  const [editedTitle, setEditedTitle] = useState("");
  const [hasChanges, setHasChanges] = useState(false);

  // --- per-section inline edit state ---
  const [editSectionIndex, setEditSectionIndex] = useState<number | null>(null);
  const [editSectionHeading, setEditSectionHeading] = useState("");
  const [editSectionText, setEditSectionText] = useState("");

  // --- search ---
  const [searchQuery, setSearchQuery] = useState("");

  // --- UI state ---
  const [openMenuIndex, setOpenMenuIndex] = useState<number | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());

  // --- copy/move to topic state ---
  const [showTopicPicker, setShowTopicPicker] = useState(false);
  const [transferMode, setTransferMode] = useState<"copy" | "move">("copy");
  const [availableTopics, setAvailableTopics] = useState<Topic[]>([]);
  const [isTransferring, setIsTransferring] = useState(false);

  // =========================================================
  // DERIVED: sorted + filtered sections (originalIndex preserved)
  // =========================================================
  const orderedSections = useMemo(() => {
    if (!notes || !Array.isArray(notes.sections)) return [];
    const withIndex = notes.sections.map((section, originalIndex) => ({
      section,
      originalIndex,
    }));
    const pinned = withIndex.filter(({ section }) => section.pinned);
    const unpinned = withIndex.filter(({ section }) => !section.pinned);
    return [...pinned, ...unpinned];
  }, [notes]);

  const filteredSections = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return orderedSections;
    return orderedSections.filter(
      ({ section }) =>
        section.heading.toLowerCase().includes(q) ||
        section.bullets.some((b) => b.toLowerCase().includes(q)),
    );
  }, [orderedSections, searchQuery]);

  // =========================================================
  // FULL NOTE EDIT
  // =========================================================
  const startEditing = useCallback(() => {
    if (!notes) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditedTitle(notes.title);
    setEditedSections(
      (notes.sections || []).map((s) => ({ ...s, bullets: [...(s.bullets || [])] })),
    );
    setIsEditing(true);
    setHasChanges(false);
    setOpenMenuIndex(null);
  }, [notes]);

  const cancelEditing = useCallback(() => {
    Haptics.selectionAsync();
    setIsEditing(false);
    setHasChanges(false);
  }, []);

  const saveEdits = useCallback(() => {
    if (!notes || !onSaveNotes) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onSaveNotes({
      ...notes,
      title: editedTitle,
      sections: editedSections.filter((s) => s.bullets.some((b) => b.trim())),
    });
    setIsEditing(false);
    setHasChanges(false);
  }, [notes, editedTitle, editedSections, onSaveNotes]);

  const updateSectionHeading = (idx: number, heading: string) => {
    setEditedSections((prev) => {
      const u = [...prev];
      u[idx] = { ...u[idx], heading };
      return u;
    });
    setHasChanges(true);
  };

  const updateBullet = (sIdx: number, bIdx: number, text: string) => {
    setEditedSections((prev) => {
      const u = [...prev];
      const bullets = [...u[sIdx].bullets];
      bullets[bIdx] = text;
      u[sIdx] = { ...u[sIdx], bullets };
      return u;
    });
    setHasChanges(true);
  };

  const addBullet = (sIdx: number) => {
    Haptics.selectionAsync();
    setEditedSections((prev) => {
      const u = [...prev];
      u[sIdx] = { ...u[sIdx], bullets: [...u[sIdx].bullets, ""] };
      return u;
    });
    setHasChanges(true);
  };

  const removeBullet = (sIdx: number, bIdx: number) => {
    Haptics.selectionAsync();
    setEditedSections((prev) => {
      const u = [...prev];
      u[sIdx] = { ...u[sIdx], bullets: u[sIdx].bullets.filter((_, i) => i !== bIdx) };
      return u;
    });
    setHasChanges(true);
  };

  const addSection = () => {
    Haptics.selectionAsync();
    setEditedSections((prev) => [...prev, { heading: "New Section", bullets: [""] }]);
    setHasChanges(true);
  };

  const removeEditSection = (sIdx: number) => {
    Haptics.selectionAsync();
    setEditedSections((prev) => prev.filter((_, i) => i !== sIdx));
    setHasChanges(true);
  };

  // =========================================================
  // TEXT HELPERS
  // =========================================================
  const formatNoteAsText = useCallback(
    (sections: NotesSection[], title: string): string => {
      const body = sections
        .map((s) => `# ${s.heading}\n${s.bullets.map((b) => `- ${b}`).join("\n")}`)
        .join("\n\n");
      return title ? `${title}\n\n${body}` : body;
    },
    [],
  );

  const getNotesAsText = useCallback((): string => {
    const source = isEditing ? editedSections : notes?.sections ?? [];
    return formatNoteAsText(source, isEditing ? editedTitle : notes?.title ?? "");
  }, [isEditing, editedSections, editedTitle, notes, formatNoteAsText]);

  const handleCopy = useCallback(async () => {
    if (!notes) return;
    await Clipboard.setStringAsync(getNotesAsText());
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast({ type: "success", title: "Copied", message: "Note copied to clipboard" });
  }, [getNotesAsText, notes, showToast]);

  const handleShare = useCallback(async () => {
    if (!notes) return;
    const text = getNotesAsText();
    const html = `<html><body style="font-family:system-ui;padding:20px;max-width:720px;margin:auto"><h1>${notes.title}</h1>${notes.sections.map((s) => `<h2>${s.heading}</h2><ul>${s.bullets.map((b) => `<li>${b}</li>`).join("")}</ul>`).join("")}</body></html>`;
    const result = await shareOrDownload({ html, plainText: text, title: notes.title });
    if (result.method === "copied") {
      showToast({ type: "success", title: "Copied", message: "Notes copied to clipboard" });
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [notes, getNotesAsText, showToast]);

  const handleRegenerate = useCallback(() => {
    if (!onRegenerateFromNotes) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const text = getNotesAsText();
    if (!text.trim()) return;
    onRegenerateFromNotes(text);
  }, [onRegenerateFromNotes, getNotesAsText]);

  const formatForWritingLab = useCallback((): string => {
    if (!notes) return "";
    return notes.sections
      .flatMap((s) => [`# ${s.heading}`, ...s.bullets.map((b) => `- ${b}`), ""])
      .join("\n")
      .trim();
  }, [notes]);

  const handleSendToWritingLab = useCallback(() => {
    if (!notes || !onSendToWritingLab) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSendToWritingLab(formatForWritingLab(), notes.id);
  }, [notes, onSendToWritingLab, formatForWritingLab]);

  // =========================================================
  // FAVORITE
  // =========================================================
  const handleToggleFavorite = useCallback(() => {
    if (!notes || !onSaveNotes) return;
    onSaveNotes({ ...notes, favorite: !notes.favorite });
    Haptics.selectionAsync();
  }, [notes, onSaveNotes]);

  // =========================================================
  // PER-SECTION ACTIONS
  // =========================================================
  const handleCopySection = useCallback(
    async (originalIdx: number) => {
      if (!notes) return;
      const s = notes.sections[originalIdx];
      const text = `# ${s.heading}\n${s.bullets.map((b) => `- ${b}`).join("\n")}`;
      await Clipboard.setStringAsync(text);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setOpenMenuIndex(null);
      showToast({ type: "success", title: "Copied", message: "Section copied to clipboard" });
    },
    [notes, showToast],
  );

  const handleTogglePin = useCallback(
    (originalIdx: number) => {
      if (!notes || !onSaveNotes) return;
      setOpenMenuIndex(null);
      const sections = notes.sections.map((s, i) =>
        i === originalIdx ? { ...s, pinned: !s.pinned } : s,
      );
      onSaveNotes({ ...notes, sections });
      Haptics.selectionAsync();
    },
    [notes, onSaveNotes],
  );

  const handleSendSectionToWritingLab = useCallback(
    (originalIdx: number) => {
      if (!notes || !onSendToWritingLab) return;
      const s = notes.sections[originalIdx];
      const text = `# ${s.heading}\n${s.bullets.map((b) => `- ${b}`).join("\n")}`;
      setOpenMenuIndex(null);
      onSendToWritingLab(text, notes.id);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [notes, onSendToWritingLab],
  );

  const startSectionEdit = useCallback(
    (originalIdx: number) => {
      if (!notes) return;
      const s = notes.sections[originalIdx];
      setEditSectionIndex(originalIdx);
      setEditSectionHeading(s.heading);
      setEditSectionText(s.bullets.join("\n"));
      setOpenMenuIndex(null);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [notes],
  );

  const saveSectionEdit = useCallback(() => {
    if (!notes || !onSaveNotes || editSectionIndex === null) return;
    const bullets = editSectionText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (bullets.length === 0) return;
    const sections = notes.sections.map((s, i) =>
      i === editSectionIndex
        ? { ...s, heading: editSectionHeading, bullets }
        : s,
    );
    onSaveNotes({ ...notes, sections });
    setEditSectionIndex(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast({ type: "success", title: "Saved", message: "Section updated" });
  }, [notes, onSaveNotes, editSectionIndex, editSectionHeading, editSectionText, showToast]);

  const cancelSectionEdit = useCallback(() => {
    setEditSectionIndex(null);
    Haptics.selectionAsync();
  }, []);

  const handleDeleteSection = useCallback(
    (originalIdx: number) => {
      if (!notes || !onSaveNotes) return;
      setOpenMenuIndex(null);
      Alert.alert(
        "Delete Section",
        `Remove "${notes.sections[originalIdx].heading}"? This cannot be undone.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              onSaveNotes({ ...notes, sections: notes.sections.filter((_, i) => i !== originalIdx) });
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              showToast({ type: "success", title: "Deleted", message: "Section removed" });
            },
          },
        ],
      );
    },
    [notes, onSaveNotes, showToast],
  );

  // =========================================================
  // COLLAPSE
  // =========================================================
  const toggleSection = useCallback((originalIdx: number) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedSections((prev) => {
      const next = new Set(prev);
      next.has(originalIdx) ? next.delete(originalIdx) : next.add(originalIdx);
      return next;
    });
    Haptics.selectionAsync();
  }, []);

  // =========================================================
  // QUICK JUMP
  // =========================================================
  const jumpToSection = useCallback((originalIdx: number) => {
    const offset = sectionOffsets.current[originalIdx];
    if (offset !== undefined) {
      scrollRef.current?.scrollTo({ y: Math.max(0, offset - 8), animated: true });
    }
    Haptics.selectionAsync();
  }, []);

  // =========================================================
  // COPY / MOVE TO TOPIC
  // =========================================================
  const openTopicPicker = useCallback(
    async (mode: "copy" | "move") => {
      setOpenMenuIndex(null);
      setTransferMode(mode);
      if (!courseId) {
        showToast({ type: "info", title: "Unavailable", message: "No course found for this topic." });
        return;
      }
      const topics = await storage.getTopicsByCourse(courseId);
      const others = topics.filter((t) => t.id !== topicId);
      if (others.length === 0) {
        showToast({
          type: "info",
          title: "No other topics",
          message: "There are no other topics in this course to transfer to.",
        });
        return;
      }
      setAvailableTopics(others);
      setShowTopicPicker(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [courseId, topicId, showToast],
  );

  const handleTransfer = useCallback(
    async (targetTopicId: string, targetTopicName: string) => {
      if (!notes || !onSaveNotes) return;
      setIsTransferring(true);
      try {
        await storage.saveNotes({ topicId: targetTopicId, title: "", sections: notes.sections });
        if (transferMode === "move") {
          await storage.updateNotes(notes.topicId, { sections: [] });
          onSaveNotes({ ...notes, sections: [] });
          showToast({ type: "success", title: "Moved", message: `Content moved to "${targetTopicName}"` });
        } else {
          showToast({ type: "success", title: "Copied", message: `Content copied to "${targetTopicName}"` });
        }
        setShowTopicPicker(false);
      } catch {
        showToast({ type: "error", title: "Failed", message: "Could not complete the transfer." });
      } finally {
        setIsTransferring(false);
      }
    },
    [notes, onSaveNotes, transferMode, showToast],
  );

  // =========================================================
  // EMPTY STATE
  // =========================================================
  if (!notes) {
    return (
      <View style={styles.emptyContainer}>
        <View style={[styles.emptyIcon, { backgroundColor: theme.link + "15" }]}>
          <ThemedText style={{ fontSize: 24, color: theme.link, fontWeight: "700" }}>N</ThemedText>
        </View>
        <ThemedText type="h3" style={styles.emptyTitle}>No Notes Yet</ThemedText>
        <ThemedText type="body" style={[styles.emptyDescription, { color: theme.textSecondary }]}>
          Generate notes from lectures, photos, or pasted text — or record and let AI do the work. Notes are organised by section, searchable, and can be sent to Writing Lab.
        </ThemedText>
        <Button onPress={onGenerate} disabled={isGenerating} style={styles.generateButton}>
          {isGenerating ? "Generating..." : "Generate Study Materials"}
        </Button>
      </View>
    );
  }

  // =========================================================
  // FULL EDIT MODE
  // =========================================================
  if (isEditing) {
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.editHeader}>
          <Pressable onPress={cancelEditing} style={styles.editHeaderButton}>
            <Icon name="x" size={18} color={theme.textSecondary} />
            <ThemedText type="small" style={{ color: theme.textSecondary }}>Cancel</ThemedText>
          </Pressable>
          <ThemedText type="body" style={{ fontWeight: "600" }}>Editing Notes</ThemedText>
          <Pressable onPress={saveEdits} style={styles.editHeaderButton}>
            <Icon name="check" size={18} color={theme.link} />
            <ThemedText type="small" style={{ color: theme.link, fontWeight: "600" }}>Save</ThemedText>
          </Pressable>
        </View>

        <TextInput
          style={[styles.titleInput, { color: theme.text, borderColor: theme.border }]}
          value={editedTitle}
          onChangeText={(t) => { setEditedTitle(t); setHasChanges(true); }}
          placeholder="Notes title"
          placeholderTextColor={theme.textSecondary}
        />

        {editedSections.map((section, sIdx) => (
          <Card key={sIdx} style={styles.editSection}>
            <View style={styles.sectionEditHeader}>
              <TextInput
                style={[styles.headingInput, { color: theme.text, borderColor: theme.border }]}
                value={section.heading}
                onChangeText={(t) => updateSectionHeading(sIdx, t)}
                placeholder="Section heading"
                placeholderTextColor={theme.textSecondary}
              />
              {editedSections.length > 1 ? (
                <Pressable onPress={() => removeEditSection(sIdx)} style={styles.removeButton}>
                  <Icon name="trash-2" size={16} color={theme.error} />
                </Pressable>
              ) : null}
            </View>
            {section.bullets.map((bullet, bIdx) => (
              <View key={bIdx} style={styles.bulletEditRow}>
                <View style={[styles.editBulletDot, { backgroundColor: theme.link }]} />
                <TextInput
                  style={[styles.bulletInput, { color: theme.text, borderColor: theme.border }]}
                  value={bullet}
                  onChangeText={(t) => updateBullet(sIdx, bIdx, t)}
                  placeholder="Enter note point..."
                  placeholderTextColor={theme.textSecondary}
                  multiline
                />
                <Pressable onPress={() => removeBullet(sIdx, bIdx)} style={styles.removeBulletButton}>
                  <Icon name="minus-circle" size={16} color={theme.error + "80"} />
                </Pressable>
              </View>
            ))}
            <Pressable onPress={() => addBullet(sIdx)} style={[styles.addButton, { borderColor: theme.border }]}>
              <Icon name="plus" size={14} color={theme.link} />
              <ThemedText type="small" style={{ color: theme.link }}>Add point</ThemedText>
            </Pressable>
          </Card>
        ))}

        <Pressable onPress={addSection} style={[styles.addSectionButton, { borderColor: theme.border }]}>
          <Icon name="plus" size={16} color={theme.link} />
          <ThemedText type="body" style={{ color: theme.link, fontWeight: "500" }}>Add Section</ThemedText>
        </Pressable>
      </ScrollView>
    );
  }

  // =========================================================
  // VIEW MODE
  // =========================================================
  const sections = Array.isArray(notes.sections) ? notes.sections : [];
  const hasSections = sections.length > 0;
  const showJumpNav = sections.length >= JUMP_NAV_THRESHOLD && !searchQuery;

  return (
    <>
      <ScrollView
        ref={scrollRef}
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={() => setOpenMenuIndex(null)}
      >
        {/* ACTION BAR */}
        <View style={styles.actionBar}>
          <Pressable
            onPress={startEditing}
            style={[styles.actionButton, { backgroundColor: theme.link + "12" }]}
            accessibilityLabel="Edit notes"
          >
            <Icon name="edit-2" size={14} color={theme.link} />
            <ThemedText type="small" style={{ color: theme.link, fontWeight: "600" }}>Edit</ThemedText>
          </Pressable>
          <Pressable
            onPress={handleCopy}
            style={[styles.actionButton, { backgroundColor: theme.success + "12" }]}
            accessibilityLabel="Copy all notes"
          >
            <Icon name="copy" size={14} color={theme.success} />
            <ThemedText type="small" style={{ color: theme.success, fontWeight: "600" }}>Copy</ThemedText>
          </Pressable>
          <Pressable
            onPress={handleShare}
            style={[styles.actionButton, { backgroundColor: theme.info + "12" }]}
            accessibilityLabel="Share notes"
          >
            <Icon name="share" size={14} color={theme.info} />
            <ThemedText type="small" style={{ color: theme.info, fontWeight: "600" }}>Share</ThemedText>
          </Pressable>
          {courseId ? (
            <Pressable
              onPress={() => openTopicPicker("copy")}
              style={[styles.actionButton, { backgroundColor: theme.info + "12" }]}
              accessibilityLabel="Copy to another topic"
            >
              <Icon name="folder" size={14} color={theme.info} />
              <ThemedText type="small" style={{ color: theme.info, fontWeight: "600" }}>Copy to Topic</ThemedText>
            </Pressable>
          ) : null}
          {courseId ? (
            <Pressable
              onPress={() => openTopicPicker("move")}
              style={[styles.actionButton, { backgroundColor: theme.warning + "12" }]}
              accessibilityLabel="Move to another topic"
            >
              <Icon name="arrow-right" size={14} color={theme.warning} />
              <ThemedText type="small" style={{ color: theme.warning, fontWeight: "600" }}>Move to Topic</ThemedText>
            </Pressable>
          ) : null}
          {onRegenerateFromNotes ? (
            <Pressable
              onPress={handleRegenerate}
              style={[styles.actionButton, { backgroundColor: theme.warning + "12" }]}
              disabled={isRegenerating}
              accessibilityLabel="Redo cards and quiz"
            >
              <Icon name="refresh-cw" size={14} color={theme.warning} />
              <ThemedText type="small" style={{ color: theme.warning, fontWeight: "600" }}>
                {isRegenerating ? "Regenerating..." : "Redo Cards"}
              </ThemedText>
            </Pressable>
          ) : null}
          {onSendToWritingLab ? (
            <Pressable
              onPress={handleSendToWritingLab}
              style={[styles.actionButton, { backgroundColor: theme.link + "12" }]}
              accessibilityLabel="Send to Writing Lab"
            >
              <Icon name="edit-3" size={14} color={theme.link} />
              <ThemedText type="small" style={{ color: theme.link, fontWeight: "600" }}>Writing Lab</ThemedText>
            </Pressable>
          ) : null}
        </View>

        {/* FIRST-USE GUIDE */}
        {notesGuide.visible && hasSections ? (
          <NotesGuideCard
            showWritingLab={!!onSendToWritingLab}
            onDismiss={notesGuide.dismiss}
            theme={theme}
          />
        ) : null}

        {/* SEARCH BAR */}
        {hasSections ? (
          <View style={[styles.searchBar, { backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}>
            <Icon name="search" size={14} color={theme.textSecondary} />
            <TextInput
              style={[styles.searchInput, { color: theme.text }]}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search sections..."
              placeholderTextColor={theme.textSecondary}
              returnKeyType="search"
              clearButtonMode="while-editing"
              accessibilityLabel="Search within notes"
            />
            {searchQuery.length > 0 ? (
              <Pressable onPress={() => setSearchQuery("")} hitSlop={8}>
                <Icon name="x" size={14} color={theme.textSecondary} />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* QUICK JUMP NAV */}
        {showJumpNav ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.jumpNav}
            contentContainerStyle={styles.jumpNavContent}
          >
            {orderedSections.map(({ section, originalIndex }) => (
              <Pressable
                key={originalIndex}
                onPress={() => jumpToSection(originalIndex)}
                style={[
                  styles.jumpPill,
                  {
                    backgroundColor: section.pinned
                      ? theme.warning + "20"
                      : theme.backgroundSecondary,
                    borderColor: section.pinned ? theme.warning + "60" : theme.border,
                  },
                ]}
                accessibilityLabel={`Jump to ${section.heading}`}
              >
                {section.pinned ? (
                  <Icon name="star" size={10} color={theme.warning} />
                ) : null}
                <ThemedText
                  type="caption"
                  style={{
                    color: section.pinned ? theme.warning : theme.textSecondary,
                    marginLeft: section.pinned ? 3 : 0,
                  }}
                  numberOfLines={1}
                >
                  {section.heading}
                </ThemedText>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {/* TITLE ROW */}
        <View style={styles.titleRow}>
          <ThemedText type="h2" style={[styles.title, { flex: 1 }]}>{notes.title}</ThemedText>
          <Pressable
            onPress={handleToggleFavorite}
            style={styles.favoriteButton}
            accessibilityLabel={notes.favorite ? "Remove from favorites" : "Add to favorites"}
            hitSlop={8}
          >
            <Icon
              name="star"
              size={20}
              color={notes.favorite ? theme.warning : theme.textSecondary}
            />
          </Pressable>
        </View>
        {notes.updatedAt ? (
          <ThemedText
            type="caption"
            style={{ color: theme.textSecondary, marginTop: -2, marginBottom: Spacing.sm, opacity: 0.7 }}
          >
            Last updated {formatRelativeTime(notes.updatedAt)}
          </ThemedText>
        ) : null}

        {/* SEARCH EMPTY STATE */}
        {searchQuery.length > 0 && filteredSections.length === 0 ? (
          <View style={styles.searchEmpty}>
            <ThemedText type="body" style={{ color: theme.textSecondary, textAlign: "center" }}>
              No sections match "{searchQuery}"
            </ThemedText>
          </View>
        ) : null}

        {/* SECTIONS */}
        {filteredSections.map(({ section, originalIndex }) => {
          const isLong = section.bullets.length > PREVIEW_COUNT + 1;
          const isExpanded = expandedSections.has(originalIndex);
          const showCollapsed = isLong && !isExpanded;
          const displayedBullets = showCollapsed
            ? section.bullets.slice(0, PREVIEW_COUNT)
            : section.bullets;
          const menuOpen = openMenuIndex === originalIndex;
          const isBeingEdited = editSectionIndex === originalIndex;

          if (isBeingEdited) {
            return (
              <View
                key={originalIndex}
                onLayout={(e) => { sectionOffsets.current[originalIndex] = e.nativeEvent.layout.y; }}
              >
                <Card style={[styles.section, { borderColor: theme.link + "50", borderWidth: 1 }]}>
                  <View style={styles.sectionEditHeader}>
                    <TextInput
                      style={[styles.headingInput, { color: theme.text, borderColor: theme.border, flex: 1 }]}
                      value={editSectionHeading}
                      onChangeText={setEditSectionHeading}
                      placeholder="Section heading"
                      placeholderTextColor={theme.textSecondary}
                      autoFocus
                    />
                  </View>
                  <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: Spacing.xs }}>
                    One bullet per line
                  </ThemedText>
                  <TextInput
                    style={[
                      styles.sectionTextInput,
                      { color: theme.text, borderColor: theme.border, backgroundColor: theme.inputBackground },
                    ]}
                    value={editSectionText}
                    onChangeText={setEditSectionText}
                    placeholder="Each line becomes a bullet..."
                    placeholderTextColor={theme.textSecondary}
                    multiline
                    textAlignVertical="top"
                  />
                  <View style={styles.sectionEditActions}>
                    <Pressable
                      onPress={cancelSectionEdit}
                      style={[styles.sectionEditBtn, { borderColor: theme.border }]}
                    >
                      <Icon name="x" size={14} color={theme.textSecondary} />
                      <ThemedText type="small" style={{ color: theme.textSecondary }}>Cancel</ThemedText>
                    </Pressable>
                    <Pressable
                      onPress={saveSectionEdit}
                      style={[styles.sectionEditBtn, { backgroundColor: theme.link, borderColor: theme.link }]}
                    >
                      <Icon name="check" size={14} color="#FFFFFF" />
                      <ThemedText type="small" style={{ color: "#FFFFFF", fontWeight: "600" }}>Save</ThemedText>
                    </Pressable>
                  </View>
                </Card>
              </View>
            );
          }

          return (
            <View
              key={originalIndex}
              onLayout={(e) => { sectionOffsets.current[originalIndex] = e.nativeEvent.layout.y; }}
            >
              <Card
                style={[
                  styles.section,
                  section.pinned && {
                    borderLeftWidth: 3,
                    borderLeftColor: theme.warning,
                    borderColor: theme.warning + "30",
                    borderWidth: 1,
                  },
                ]}
              >
                {/* SECTION HEADER */}
                <View style={styles.sectionHeader}>
                  {section.pinned ? (
                    <View style={[styles.pinnedDot, { backgroundColor: theme.warning + "25" }]}>
                      <Icon name="star" size={11} color={theme.warning} />
                    </View>
                  ) : (
                    <View style={[styles.sectionNumber, { backgroundColor: theme.link + "15" }]}>
                      <ThemedText type="small" style={[styles.sectionNumberText, { color: theme.link }]}>
                        {originalIndex + 1}
                      </ThemedText>
                    </View>
                  )}
                  <ThemedText type="h4" style={styles.sectionHeading} numberOfLines={2}>{section.heading}</ThemedText>
                  <Pressable
                    onPress={() => {
                      setOpenMenuIndex(menuOpen ? null : originalIndex);
                      Haptics.selectionAsync();
                    }}
                    style={styles.menuButton}
                    accessibilityLabel="Section options"
                    hitSlop={8}
                  >
                    <Icon name="more-horizontal" size={17} color={theme.textSecondary} />
                  </Pressable>
                </View>

                {/* INLINE SECTION MENU */}
                {menuOpen ? (
                  <View
                    style={[
                      styles.sectionMenu,
                      { backgroundColor: theme.backgroundSecondary, borderColor: theme.border },
                    ]}
                  >
                    <SectionMenuItem
                      icon="star"
                      label={section.pinned ? "Unpin section" : "Pin section"}
                      color={theme.warning}
                      onPress={() => handleTogglePin(originalIndex)}
                      theme={theme}
                    />
                    <SectionMenuItem
                      icon="copy"
                      label="Copy section"
                      color={theme.success}
                      onPress={() => handleCopySection(originalIndex)}
                      theme={theme}
                    />
                    <SectionMenuItem
                      icon="edit-2"
                      label="Edit section"
                      color={theme.link}
                      onPress={() => startSectionEdit(originalIndex)}
                      theme={theme}
                    />
                    {onSendToWritingLab ? (
                      <SectionMenuItem
                        icon="edit-3"
                        label="Send section to Writing Lab"
                        color={theme.link}
                        onPress={() => handleSendSectionToWritingLab(originalIndex)}
                        theme={theme}
                      />
                    ) : null}
                    <SectionMenuItem
                      icon="trash-2"
                      label="Delete section"
                      color={theme.error}
                      onPress={() => handleDeleteSection(originalIndex)}
                      theme={theme}
                      last
                    />
                  </View>
                ) : null}

                {/* BULLETS */}
                {displayedBullets.map((bullet, bIdx) => (
                  <View key={bIdx} style={styles.bulletRow}>
                    <View style={[styles.bulletDot, { backgroundColor: section.pinned ? theme.warning : theme.link }]} />
                    <ThemedText type="body" style={styles.bulletText}>{bullet}</ThemedText>
                  </View>
                ))}

                {/* COLLAPSE TOGGLE */}
                {isLong ? (
                  <Pressable
                    onPress={() => toggleSection(originalIndex)}
                    style={styles.collapseToggle}
                    accessibilityLabel={isExpanded ? "Show less" : "Show more bullets"}
                  >
                    <Icon
                      name={isExpanded ? "chevron-up" : "chevron-down"}
                      size={14}
                      color={theme.textSecondary}
                    />
                    <ThemedText type="small" style={{ color: theme.textSecondary, marginLeft: Spacing.xs }}>
                      {isExpanded
                        ? "Show less"
                        : `${section.bullets.length - PREVIEW_COUNT} more`}
                    </ThemedText>
                  </Pressable>
                ) : null}
              </Card>
            </View>
          );
        })}
      </ScrollView>

      {/* TOPIC PICKER MODAL */}
      <Modal
        visible={showTopicPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowTopicPicker(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowTopicPicker(false)}>
          <Pressable
            style={[styles.modalSheet, { backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={[styles.modalHandle, { backgroundColor: theme.border }]} />
            <ThemedText type="h3" style={styles.modalTitle}>
              {transferMode === "copy" ? "Copy to Topic" : "Move to Topic"}
            </ThemedText>
            <ThemedText type="small" style={{ color: theme.textSecondary, marginBottom: Spacing.lg }}>
              {transferMode === "copy"
                ? "Sections will be appended to the target topic's notes."
                : "Sections will be removed from this note after moving."}
            </ThemedText>
            <ScrollView style={styles.topicList} showsVerticalScrollIndicator={false}>
              {availableTopics.map((topic) => (
                <Pressable
                  key={topic.id}
                  style={[styles.topicItem, { borderBottomColor: theme.border }]}
                  onPress={() => handleTransfer(topic.id, topic.name)}
                  disabled={isTransferring}
                  accessibilityLabel={`Transfer to ${topic.name}`}
                >
                  <Icon name="file-text" size={15} color={theme.link} />
                  <ThemedText type="body" style={{ flex: 1, marginLeft: Spacing.sm }}>
                    {topic.name}
                  </ThemedText>
                  {isTransferring ? (
                    <ActivityIndicator size="small" color={theme.link} />
                  ) : (
                    <Icon name="chevron-right" size={15} color={theme.textSecondary} />
                  )}
                </Pressable>
              ))}
            </ScrollView>
            <Pressable
              style={[styles.modalCancel, { borderColor: theme.border }]}
              onPress={() => setShowTopicPicker(false)}
            >
              <ThemedText type="body" style={{ color: theme.textSecondary, fontWeight: "500" }}>
                Cancel
              </ThemedText>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

// =========================================================
// NOTES GUIDE CARD
// =========================================================
function NotesGuideCard({
  showWritingLab,
  onDismiss,
  theme,
}: {
  showWritingLab: boolean;
  onDismiss: () => void;
  theme: any;
}) {
  const tips = [
    "Tap ⋯ on any section to pin, edit, copy, or send to Writing Lab",
    "Use the search bar above to find sections instantly",
    ...(showWritingLab ? ['Tap "Writing Lab" in the action bar to draft an essay from these notes'] : []),
  ];
  return (
    <View style={[guideStyles.card, { backgroundColor: theme.link + "09", borderColor: theme.link + "22" }]}>
      <View style={guideStyles.header}>
        <Icon name="info" size={13} color={theme.link} />
        <ThemedText type="caption" style={[guideStyles.title, { color: theme.link }]}>
          Tips
        </ThemedText>
        <Pressable onPress={onDismiss} hitSlop={12} accessibilityLabel="Dismiss tips">
          <Icon name="x" size={14} color={theme.textSecondary} />
        </Pressable>
      </View>
      {tips.map((tip, i) => (
        <View key={i} style={guideStyles.tipRow}>
          <View style={[guideStyles.dot, { backgroundColor: theme.link }]} />
          <ThemedText type="caption" style={[guideStyles.tipText, { color: theme.textSecondary }]}>
            {tip}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

const guideStyles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  title: {
    flex: 1,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  tipRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.xs,
    marginTop: 3,
    paddingLeft: 2,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 6,
    flexShrink: 0,
    opacity: 0.7,
  },
  tipText: {
    flex: 1,
    lineHeight: 18,
  },
});

// =========================================================
// SECTION MENU ITEM
// =========================================================
function SectionMenuItem({
  icon,
  label,
  color,
  onPress,
  theme,
  last = false,
}: {
  icon: string;
  label: string;
  color: string;
  onPress: () => void;
  theme: any;
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.sectionMenuRow,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
      ]}
    >
      <Icon name={icon} size={14} color={color} />
      <ThemedText type="small" style={{ color, marginLeft: Spacing.sm, fontWeight: "500" }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingBottom: Spacing["3xl"] },

  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing["2xl"],
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: BorderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xl,
  },
  emptyTitle: { textAlign: "center", marginBottom: Spacing.sm },
  emptyDescription: { textAlign: "center", marginBottom: Spacing["2xl"] },
  generateButton: { minWidth: 200 },

  // action bar
  actionBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
    marginBottom: Spacing.md,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: BorderRadius.md,
  },

  // search
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 7,
    marginBottom: Spacing.sm,
    gap: Spacing.xs,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
  },
  searchEmpty: {
    paddingVertical: Spacing["2xl"],
    alignItems: "center",
  },

  // jump nav
  jumpNav: {
    marginBottom: Spacing.sm,
  },
  jumpNavContent: {
    gap: Spacing.xs,
    paddingRight: Spacing.sm,
  },
  jumpPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    maxWidth: 140,
  },

  // title row
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: Spacing.lg,
    marginTop: Spacing.xs,
  },
  title: {},
  favoriteButton: {
    padding: Spacing.xs,
    marginTop: 2,
    marginLeft: Spacing.sm,
  },

  // section card
  section: { marginBottom: Spacing.md },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  sectionNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.sm,
  },
  pinnedDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.sm,
  },
  sectionNumberText: { fontWeight: "600", fontSize: 11 },
  sectionHeading: { flex: 1 },
  menuButton: { padding: 4, marginLeft: 4 },

  // section inline menu
  sectionMenu: {
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    marginBottom: Spacing.sm,
    overflow: "hidden",
  },
  sectionMenuRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    minHeight: 40,
  },

  // bullets (view mode)
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 6,
    paddingLeft: Spacing.sm,
  },
  bulletDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginTop: 9,
    marginRight: Spacing.sm,
    flexShrink: 0,
  },
  bulletText: { flex: 1, lineHeight: 22 },

  collapseToggle: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
    paddingTop: Spacing.sm,
  },

  // inline section editor
  sectionTextInput: {
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: 14,
    lineHeight: 20,
    minHeight: 120,
    marginBottom: Spacing.sm,
  },
  sectionEditActions: {
    flexDirection: "row",
    gap: Spacing.sm,
    justifyContent: "flex-end",
  },
  sectionEditBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    minHeight: 36,
  },

  // full edit mode
  editHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  editHeaderButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    padding: Spacing.sm,
  },
  titleInput: {
    fontSize: 20,
    fontWeight: "700",
    borderBottomWidth: 1,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  editSection: { marginBottom: Spacing.lg },
  sectionEditHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  headingInput: {
    fontSize: 16,
    fontWeight: "600",
    borderBottomWidth: 1,
    paddingVertical: Spacing.xs,
  },
  removeButton: { padding: Spacing.sm },
  bulletEditRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: Spacing.sm,
    paddingLeft: Spacing.xs,
  },
  editBulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 8,
    marginRight: Spacing.md,
  },
  bulletInput: {
    flex: 1,
    fontSize: 15,
    borderBottomWidth: 1,
    paddingVertical: Spacing.xs,
    minHeight: 32,
  },
  removeBulletButton: { padding: Spacing.sm, marginLeft: Spacing.xs },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    padding: Spacing.sm,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: BorderRadius.sm,
    justifyContent: "center",
    marginTop: Spacing.sm,
  },
  addSectionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.lg,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: BorderRadius.md,
    justifyContent: "center",
    marginBottom: Spacing.lg,
  },

  // modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    borderTopLeftRadius: BorderRadius.lg,
    borderTopRightRadius: BorderRadius.lg,
    borderWidth: 1,
    padding: Spacing.lg,
    paddingBottom: Spacing["3xl"],
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: Spacing.lg,
    opacity: 0.5,
  },
  modalTitle: { marginBottom: Spacing.xs },
  topicList: { maxHeight: 280 },
  topicItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 52,
  },
  modalCancel: {
    marginTop: Spacing.md,
    paddingVertical: Spacing.md,
    alignItems: "center",
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
  },
});
