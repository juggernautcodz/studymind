import React from "react";
import { StyleSheet, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <Card style={styles.section}>
      <ThemedText type="h3" style={styles.sectionTitle}>
        {title}
      </ThemedText>
      <ThemedText type="body" style={[styles.sectionBody, { color: theme.textSecondary }]}>
        {children}
      </ThemedText>
    </Card>
  );
}

export default function TermsOfServiceScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + Spacing["3xl"] },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <ThemedText
          type="small"
          style={[styles.lastUpdated, { color: theme.textSecondary }]}
        >
          Last Updated: April 2026
        </ThemedText>

        <ThemedText type="body" style={[styles.intro, { color: theme.textSecondary }]}>
          By downloading or using StudyMind, you agree to these Terms of Service. Please read them carefully.
        </ThemedText>

        <Section title="1. Acceptance of Terms">
          By accessing or using the StudyMind application ("the App"), you agree to be bound by these Terms of Service and all applicable laws and regulations. If you do not agree with any of these terms, you are prohibited from using the App.
        </Section>

        <Section title="2. Use of the App">
          StudyMind grants you a limited, non-exclusive, non-transferable license to use the App for personal, non-commercial educational purposes. You may not:{"\n\n"}
          • Copy, modify, or distribute the App{"\n"}
          • Attempt to reverse engineer any part of the App{"\n"}
          • Use the App to violate any applicable laws{"\n"}
          • Share your account credentials with others{"\n"}
          • Upload content that is unlawful, harmful, or infringing
        </Section>

        <Section title="3. User Accounts">
          You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You must notify us immediately of any unauthorized use of your account at studymindv1@hotmail.com.{"\n\n"}
          We reserve the right to terminate accounts that violate these terms or remain inactive for extended periods.
        </Section>

        <Section title="4. Subscriptions and Payments">
          StudyMind offers free and paid subscription plans. Paid plans are billed through Google Play and are subject to Google Play's payment terms.{"\n\n"}
          • Subscriptions automatically renew unless cancelled at least 24 hours before the end of the current billing period{"\n"}
          • You can manage or cancel your subscription through your Google Play account settings{"\n"}
          • Refunds are handled according to Google Play's refund policy{"\n"}
          • Prices are subject to change with reasonable notice
        </Section>

        <Section title="5. AI-Generated Content">
          The App uses artificial intelligence to generate study materials including transcriptions, notes, flashcards, and quizzes. You acknowledge that:{"\n\n"}
          • AI-generated content may contain errors or inaccuracies{"\n"}
          • AI content should be reviewed and not relied upon as a sole source of academic information{"\n"}
          • We are not responsible for academic outcomes based on AI-generated content{"\n"}
          • You retain ownership of content you upload to the App
        </Section>

        <Section title="6. Privacy">
          Your use of the App is also governed by our Privacy Policy, which is incorporated into these Terms by reference. By using the App, you consent to the collection and use of information as described in our Privacy Policy.
        </Section>

        <Section title="7. Intellectual Property">
          The App and its original content, features, and functionality are owned by StudyMind and are protected by international copyright, trademark, and other intellectual property laws. Study materials generated from your content belong to you.
        </Section>

        <Section title="8. Disclaimer of Warranties">
          The App is provided "as is" without any warranties, express or implied. We do not warrant that the App will be uninterrupted, error-free, or free of viruses or other harmful components. StudyMind is not affiliated with any academic institution.
        </Section>

        <Section title="9. Limitation of Liability">
          To the maximum extent permitted by law, StudyMind shall not be liable for any indirect, incidental, special, consequential, or punitive damages resulting from your use or inability to use the App, including any loss of data or academic outcomes.
        </Section>

        <Section title="10. Changes to Terms">
          We reserve the right to modify these Terms at any time. We will notify users of significant changes through the App. Continued use of the App after changes constitutes acceptance of the new Terms.
        </Section>

        <Section title="11. Contact">
          If you have questions about these Terms, please contact us at:{"\n\n"}studymindv1@hotmail.com
        </Section>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  lastUpdated: {
    marginBottom: Spacing.sm,
  },
  intro: {
    marginBottom: Spacing.lg,
    lineHeight: 22,
  },
  section: {
    marginBottom: Spacing.md,
  },
  sectionTitle: {
    marginBottom: Spacing.sm,
  },
  sectionBody: {
    lineHeight: 22,
  },
});
