import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getAuthHeaders } from "./query-client";

export interface CourseMastery {
  conceptId: string; topicId: string; name: string; score: number | null;
  confidence: number; evidenceCount: number; correctCount: number; incorrectCount: number;
  lastPracticedAt: string | null; trend: string;
}

const key = (courseId: string) => ["course-mastery", courseId] as const;
async function request(courseId: string, method: "GET" | "POST") {
  const headers = await getAuthHeaders();
  if (!headers.Authorization) throw new Error("Authentication required");
  const suffix = method === "POST" ? "/recalculate" : "";
  const response = await apiRequest(method, `/api/courses/${encodeURIComponent(courseId)}/mastery${suffix}`);
  return (await response.json()).mastery as CourseMastery[];
}
export function useCourseMastery(courseId: string) { return useQuery({ queryKey: key(courseId), queryFn: () => request(courseId, "GET"), enabled: !!courseId }); }
export function useRecalculateCourseMastery(courseId: string) { const queryClient = useQueryClient(); return useMutation({ mutationFn: () => request(courseId, "POST"), onSuccess: (mastery) => queryClient.setQueryData(key(courseId), mastery) }); }
