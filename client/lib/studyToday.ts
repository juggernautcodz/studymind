import { useQuery } from "@tanstack/react-query";

import { apiRequest, getAuthHeaders } from "@/lib/query-client";

export type StudyTodayStatus =
  | "READY"
  | "NO_COURSES"
  | "NO_CONCEPTS"
  | "NO_RECOMMENDATIONS";

export type StudyPriority = "HIGH" | "MEDIUM" | "LOW";

export type StudyTodayReasonCode =
  | "LOW_MASTERY"
  | "NO_MASTERY_EVIDENCE"
  | "LOW_CONFIDENCE"
  | "SPARSE_EVIDENCE"
  | "UPCOMING_EXAM"
  | "WEAK_EXAM_CONCEPT"
  | "DUE_FLASHCARDS";

export type StudyActionCode =
  | "REVIEW_FLASHCARDS"
  | "TAKE_QUIZ"
  | "REVIEW_CONCEPT";

export type MasteryState = "STRONG" | "DEVELOPING" | "WEAK" | "UNASSESSED";

export interface StudyTodayRecommendation {
  course: { id: string; name: string };
  concept: { id: string; topicId: string; name: string };
  priority: StudyPriority;
  priorityScore: number;
  reasons: Array<{
    code: StudyTodayReasonCode;
    label: string;
    points: number;
  }>;
  mastery: {
    state: MasteryState;
    score: number | null;
    confidence: number;
    evidenceCount: number;
    correctCount: number;
    incorrectCount: number;
    lastPracticedAt: string | null;
    trend: string;
  };
  examRelevance: {
    isScoped: boolean;
    nearestExam: {
      id: string;
      name: string;
      examDate: string;
      daysUntil: number;
    } | null;
  };
  suggestedAction: {
    code: StudyActionCode;
    label: string;
    topicId: string;
  };
}

export interface StudyToday {
  generatedAt: string;
  timeZone: "UTC";
  status: StudyTodayStatus;
  totalCourses: number;
  totalConcepts: number;
  recommendationCount: number;
  recommendations: StudyTodayRecommendation[];
}

interface StudyTodayResponse {
  studyToday: StudyToday;
}

export const studyTodayQueryKey = ["study-today"] as const;

export async function fetchStudyToday(): Promise<StudyToday> {
  const headers = await getAuthHeaders();
  if (!headers.Authorization) throw new Error("Authentication required");

  const response = await apiRequest("GET", "/api/study-today");
  const data = (await response.json()) as StudyTodayResponse;
  return data.studyToday;
}

export function useStudyToday() {
  return useQuery({
    queryKey: studyTodayQueryKey,
    queryFn: fetchStudyToday,
    staleTime: 30_000,
  });
}
