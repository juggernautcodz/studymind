import React, { useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  LayoutAnimation,
  Platform,
  UIManager,
} from "react-native";
import { Icon } from "@/components/Icon";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface FAQItem {
  question: string;
  answer: string;
  icon: string;
}

interface FeatureSection {
  title: string;
  icon: string;
  color: string;
  items: string[];
}

const GETTING_STARTED: FAQItem[] = [
  {
    question: "How do I get started?",
    answer:
      "Start by creating a Semester (like 'Fall 2024'), then add your Courses (like 'Biology 101'), and Topics within each course (like 'Chapter 1'). Add content to topics via recording, camera, file upload, or clipboard. This keeps all your study materials organized!",
    icon: "play-circle",
  },
  {
    question: "How do I record a lecture?",
    answer:
      "Go to any topic and tap Record in the Add Content row. Press the microphone button to start recording. When you're done, tap stop. The app will automatically transcribe your recording and create notes, flashcards, and quiz questions!",
    icon: "mic",
  },
  {
    question: "How do I add notes or textbook photos?",
    answer:
      "Use the Camera or Gallery button in the Add Content row on any course or topic. The app will extract the text and let you summarize it, create flashcards, or generate quiz questions from it!",
    icon: "camera",
  },
];

const FEATURES: FeatureSection[] = [
  {
    title: "Recording & Transcription",
    icon: "mic",
    color: "#EF4444",
    items: [
      "Record lectures directly in the app",
      "AI automatically transcribes your recordings",
      "Works with any audio - lectures, meetings, study sessions",
    ],
  },
  {
    title: "AI-Generated Notes",
    icon: "file-text",
    color: "#10B981",
    items: [
      "Notes are created automatically from your recordings",
      "Organized with headings and key points",
      "Easy to read and review anytime",
    ],
  },
  {
    title: "Flashcards",
    icon: "layers",
    color: "#3B82F6",
    items: [
      "Flashcards are generated from your recordings and uploaded content",
      "Swipe to flip between question and answer",
      "Uses spaced repetition to help you remember better",
    ],
  },
  {
    title: "Quizzes",
    icon: "help-circle",
    color: "#10B981",
    items: [
      "Multiple choice quizzes to test your knowledge",
      "Generated automatically from your content",
      "See explanations for each answer",
    ],
  },
  {
    title: "Image Capture",
    icon: "camera",
    color: "#7C3AED",
    items: [
      "Take photos of handwritten notes or textbook pages",
      "AI extracts and reads the text for you",
      "Summarize long texts into key points",
      "Create flashcards and quizzes from captured content",
    ],
  },
  {
    title: "Mind Maps",
    icon: "share-2",
    color: "#F59E0B",
    items: [
      "Visual overview of your courses and topics",
      "See connections between your study materials",
      "Quick navigation to any topic",
    ],
  },
  {
    title: "Search",
    icon: "search",
    color: "#3B82F6",
    items: [
      "Search across all your notes, flashcards, and topics",
      "Find anything quickly with keywords",
      "Results show snippets of matching content",
    ],
  },
  {
    title: "Export & Share",
    icon: "share",
    color: "#10B981",
    items: [
      "Export your notes as PDF documents",
      "Share flashcards with classmates",
      "Print study materials for offline use",
    ],
  },
  {
    title: "Study Reminders",
    icon: "bell",
    color: "#F59E0B",
    items: [
      "Set daily study reminders",
      "Get notified when flashcards are due for review",
      "Streak reminders to keep you motivated",
    ],
  },
];

const MORE_FAQ: FAQItem[] = [
  {
    question: "What is spaced repetition?",
    answer:
      "Spaced repetition is a study technique that shows you flashcards at increasing intervals. Cards you find hard will appear more often, while cards you know well appear less frequently. This helps you remember things longer with less study time!",
    icon: "clock",
  },
  {
    question: "How do I study my flashcards?",
    answer:
      "Go to the Study tab from the main menu, or tap 'Cards' in any topic. Tap a card to flip it and see the answer. Rate how well you knew it (Again, Hard, Good, or Easy) and the app will schedule your next review.",
    icon: "book-open",
  },
  {
    question: "Can I use the app offline?",
    answer:
      "Your saved notes, flashcards, and quizzes are available offline. However, recording and AI features (transcription, summarization, generating study materials) require an internet connection.",
    icon: "wifi-off",
  },
  {
    question: "What are the different plans?",
    answer:
      "FREE: Get started with basic features. BASE: One-time purchase for unlimited recordings. PRO: Monthly or yearly subscription for all features plus priority AI processing.",
    icon: "credit-card",
  },
  {
    question: "How do I organize my content?",
    answer:
      "Use the hierarchy: Semesters contain Courses, and Courses contain Topics. Add content (recordings, notes, flashcards, quizzes) directly to Topics. Think of it like folders on your computer. You can create as many as you need!",
    icon: "folder",
  },
];

function FAQCard({
  item,
  isExpanded,
  onToggle,
  theme,
}: {
  item: FAQItem;
  isExpanded: boolean;
  onToggle: () => void;
  theme: any;
}) {
  return (
    <Card style={styles.faqCard}>
      <Pressable onPress={onToggle} style={styles.faqHeader}>
        <View
          style={[
            styles.faqIconContainer,
            { backgroundColor: theme.link + "15" },
          ]}
        >
          <Icon name={item.icon} size={18} color={theme.link} />
        </View>
        <ThemedText type="body" style={styles.faqQuestion}>
          {item.question}
        </ThemedText>
        <Icon
          name={isExpanded ? "chevron-up" : "chevron-down"}
          size={20}
          color={theme.textSecondary}
        />
      </Pressable>
      {isExpanded ? (
        <View style={styles.faqAnswer}>
          <ThemedText
            type="body"
            style={{ color: theme.textSecondary, lineHeight: 22 }}
          >
            {item.answer}
          </ThemedText>
        </View>
      ) : null}
    </Card>
  );
}

function FeatureCard({
  section,
  theme,
}: {
  section: FeatureSection;
  theme: any;
}) {
  return (
    <Card style={styles.featureCard}>
      <View style={styles.featureHeader}>
        <View
          style={[
            styles.featureIconContainer,
            { backgroundColor: section.color + "20" },
          ]}
        >
          <Icon name={section.icon} size={20} color={section.color} />
        </View>
        <ThemedText type="h3" style={styles.featureTitle}>
          {section.title}
        </ThemedText>
      </View>
      {section.items.map((item, index) => (
        <View key={index} style={styles.featureItem}>
          <Icon name="check" size={16} color={theme.success} />
          <ThemedText type="body" style={styles.featureItemText}>
            {item}
          </ThemedText>
        </View>
      ))}
    </Card>
  );
}

export default function HelpScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [expandedFaq, setExpandedFaq] = useState<number | null>(0);
  const [expandedMoreFaq, setExpandedMoreFaq] = useState<number | null>(null);

  const toggleFaq = (index: number) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedFaq(expandedFaq === index ? null : index);
  };

  const toggleMoreFaq = (index: number) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedMoreFaq(expandedMoreFaq === index ? null : index);
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + Spacing["3xl"] },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[styles.heroSection, { backgroundColor: theme.link + "10" }]}
        >
          <Icon name="book-open" size={40} color={theme.link} />
          <ThemedText type="h2" style={styles.heroTitle}>
            Welcome to StudyMind
          </ThemedText>
          <ThemedText
            type="body"
            style={[styles.heroSubtitle, { color: theme.textSecondary }]}
          >
            Your AI-powered study companion that turns recordings and notes into
            effective study materials
          </ThemedText>
        </View>

        <View style={styles.section}>
          <ThemedText type="h2" style={styles.sectionTitle}>
            Getting Started
          </ThemedText>
          {GETTING_STARTED.map((item, index) => (
            <FAQCard
              key={index}
              item={item}
              isExpanded={expandedFaq === index}
              onToggle={() => toggleFaq(index)}
              theme={theme}
            />
          ))}
        </View>

        <View style={styles.section}>
          <ThemedText type="h2" style={styles.sectionTitle}>
            What This App Can Do
          </ThemedText>
          {FEATURES.map((section, index) => (
            <FeatureCard key={index} section={section} theme={theme} />
          ))}
        </View>

        <View style={styles.section}>
          <ThemedText type="h2" style={styles.sectionTitle}>
            More Questions
          </ThemedText>
          {MORE_FAQ.map((item, index) => (
            <FAQCard
              key={index}
              item={item}
              isExpanded={expandedMoreFaq === index}
              onToggle={() => toggleMoreFaq(index)}
              theme={theme}
            />
          ))}
        </View>

        <Card style={[styles.tipCard, { backgroundColor: theme.info + "10" }]}>
          <Icon name="info" size={20} color={theme.info} />
          <View style={styles.tipContent}>
            <ThemedText type="body" style={{ fontWeight: "600" }}>
              Need more help?
            </ThemedText>
            <ThemedText
              type="small"
              style={{ color: theme.textSecondary, marginTop: 4 }}
            >
              Contact us at studymindv1@hotmail.com for questions, feedback, or
              support.
            </ThemedText>
          </View>
        </Card>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: Spacing.lg,
  },
  heroSection: {
    alignItems: "center",
    padding: Spacing["2xl"],
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing["2xl"],
  },
  heroTitle: {
    marginTop: Spacing.lg,
    textAlign: "center",
  },
  heroSubtitle: {
    marginTop: Spacing.sm,
    textAlign: "center",
    lineHeight: 22,
  },
  section: {
    marginBottom: Spacing["2xl"],
  },
  sectionTitle: {
    marginBottom: Spacing.lg,
  },
  faqCard: {
    marginBottom: Spacing.md,
  },
  faqHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  faqIconContainer: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.md,
  },
  faqQuestion: {
    flex: 1,
    fontWeight: "600",
  },
  faqAnswer: {
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.1)",
  },
  featureCard: {
    marginBottom: Spacing.md,
  },
  featureHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  featureIconContainer: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.md,
  },
  featureTitle: {
    flex: 1,
  },
  featureItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: Spacing.sm,
    paddingLeft: Spacing.xs,
  },
  featureItemText: {
    flex: 1,
    marginLeft: Spacing.sm,
    lineHeight: 22,
  },
  tipCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
  },
  tipContent: {
    flex: 1,
    marginLeft: Spacing.md,
  },
});
