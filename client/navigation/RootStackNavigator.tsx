import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import MainTabNavigator from "@/navigation/MainTabNavigator";
import LoginScreen from "@/screens/LoginScreen";
import ForgotPasswordScreen from "@/screens/ForgotPasswordScreen";
import ResetPasswordScreen from "@/screens/ResetPasswordScreen";
import SemesterScreen from "@/screens/SemesterScreen";
import CourseScreen from "@/screens/CourseScreen";
import RecordScreen from "@/screens/RecordScreen";
import MindmapScreen from "@/screens/MindmapScreen";
import BillingScreen from "@/screens/BillingScreen";
import StudyTodayScreen from "@/screens/StudyTodayScreen";
import ExamModeScreen from "@/screens/ExamModeScreen";
import ExamReadinessScreen from "@/screens/ExamReadinessScreen";
import SearchScreen from "@/screens/SearchScreen";
import LibraryScreen from "@/screens/LibraryScreen";
import TopicScreen from "@/screens/TopicScreen";
import WritingLabScreen from "@/screens/WritingLabScreen";
import CourseBrainScreen from "@/screens/CourseBrainScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";
import { useAuth } from "@/contexts/AuthContext";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";

export type RootStackParamList = {
  Login: undefined;
  ForgotPassword: undefined;
  ResetPassword: { email: string };
  Main: undefined;
  Semester: { semesterId: string };
  Course: { courseId: string };
  CourseBrain: { courseId: string };
  Topic: {
    topicId: string;
    courseId: string;
    initialTab?: "notes" | "flashcards" | "quiz";
    studyTodayAction?: "REVIEW_FLASHCARDS" | "TAKE_QUIZ";
  };
  Record: { topicId: string };
  Mindmap: { courseId: string };
  Billing: undefined;
  StudyToday: undefined;
  ExamMode: undefined;
  ExamReadiness: { examId: string };
  Search: undefined;
  Library: undefined;
  WritingLab:
    | {
        initialMode?: "essay" | "rewrite" | "clean";
        initialText?: string;
        sourceNoteId?: string;
        sourceTopicId?: string;
        sourceNoteTitle?: string;
        sourceTopicName?: string;
      }
    | undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootStackNavigator() {
  const screenOptions = useScreenOptions();
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <ThemedView
        style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
      >
        <ThemedText>Loading...</ThemedText>
      </ThemedView>
    );
  }

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      {!isAuthenticated ? (
        <>
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="ForgotPassword"
            component={ForgotPasswordScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="ResetPassword"
            component={ResetPasswordScreen}
            options={{ headerShown: false }}
          />
        </>
      ) : (
        <>
          <Stack.Screen
            name="Main"
            component={MainTabNavigator}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Semester"
            component={SemesterScreen}
            options={{ headerTitle: "Semester" }}
          />
          <Stack.Screen
            name="Course"
            component={CourseScreen}
            options={{ headerTitle: "Course" }}
          />
          <Stack.Screen
            name="CourseBrain"
            component={CourseBrainScreen}
            options={{ headerTitle: "Course Brain" }}
          />
          <Stack.Screen
            name="Topic"
            component={TopicScreen}
            options={{ headerTitle: "Topic" }}
          />
          <Stack.Screen
            name="Record"
            component={RecordScreen}
            options={{
              headerTitle: "Record",
              presentation: "modal",
            }}
          />
          <Stack.Screen
            name="Mindmap"
            component={MindmapScreen}
            options={{ headerTitle: "Mind Map" }}
          />
          <Stack.Screen
            name="Billing"
            component={BillingScreen}
            options={{
              headerTitle: "Upgrade Plan",
              presentation: "modal",
            }}
          />
          <Stack.Screen
            name="StudyToday"
            component={StudyTodayScreen}
            options={{ headerTitle: "Study Today" }}
          />
          <Stack.Screen
            name="ExamMode"
            component={ExamModeScreen}
            options={{ headerTitle: "Exam Mode" }}
          />
          <Stack.Screen
            name="ExamReadiness"
            component={ExamReadinessScreen}
            options={{ headerTitle: "Exam Readiness" }}
          />
          <Stack.Screen
            name="Search"
            component={SearchScreen}
            options={{
              headerTitle: "Search",
              presentation: "modal",
            }}
          />
          <Stack.Screen
            name="Library"
            component={LibraryScreen}
            options={{ headerTitle: "Library" }}
          />
          <Stack.Screen
            name="WritingLab"
            component={WritingLabScreen}
            options={{ headerTitle: "Writing Lab" }}
          />
        </>
      )}
    </Stack.Navigator>
  );
}
