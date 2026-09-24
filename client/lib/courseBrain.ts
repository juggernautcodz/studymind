import { useQuery } from "@tanstack/react-query";
import { apiRequest, getAuthHeaders } from "./query-client";

export interface CourseBrainTopic {
  id: string;
  name: string;
  orderIndex: number;
  status: string;
  updatedAt: string;
  counts: {
    recordings: number;
    flashcards: number;
    quizzes: number;
    quizAttempts: number;
  };
}

export interface CourseBrain {
  course: {
    id: string;
    name: string;
    color: string | null;
    createdAt: string;
    updatedAt: string;
  };
  semester: {
    id: string;
    name: string;
    startDate: string | null;
    endDate: string | null;
  } | null;
  topics: CourseBrainTopic[];
  totals: {
    topics: number;
    recordings: number;
    flashcards: number;
    quizzes: number;
    quizAttempts: number;
    mindMapNodes: number;
  };
  quizPerformance: {
    score: number;
    questions: number;
    accuracyPercent: number | null;
  };
  exams: Array<{
    id: string;
    name: string;
    examDate: string;
    updatedAt: string;
  }>;
  lastActivityAt: string | null;
  futureDomains: {
    sources: { available: false };
    concepts: { available: false };
    mastery: { available: false };
  };
}

interface CourseBrainResponse {
  brain: CourseBrain;
}

export const courseBrainQueryKey = (courseId: string) =>
  ["course-brain", courseId] as const;

async function fetchCourseBrain(courseId: string): Promise<CourseBrain> {
  const authHeaders = await getAuthHeaders();
  if (!authHeaders.Authorization) throw new Error("Authentication required");

  const response = await apiRequest(
    "GET",
    `/api/courses/${encodeURIComponent(courseId)}/brain`,
  );
  const data = (await response.json()) as CourseBrainResponse;
  return data.brain;
}

export function useCourseBrain(courseId: string) {
  return useQuery({
    queryKey: courseBrainQueryKey(courseId),
    queryFn: () => fetchCourseBrain(courseId),
    enabled: courseId.length > 0,
    staleTime: 30_000,
  });
}
