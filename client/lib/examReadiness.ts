import { useQuery } from "@tanstack/react-query";

import { apiRequest, getAuthHeaders } from "@/lib/query-client";
import type { ExamReadiness } from "@/lib/examReadinessPresentation";

interface ExamReadinessResponse {
  readiness: ExamReadiness;
}

export const examReadinessQueryKey = (examId: string) =>
  ["exam-readiness", examId] as const;

export async function fetchExamReadiness(
  examId: string,
): Promise<ExamReadiness> {
  const headers = await getAuthHeaders();
  if (!headers.Authorization) throw new Error("Authentication required");

  const response = await apiRequest(
    "GET",
    `/api/exams/${encodeURIComponent(examId)}/readiness`,
  );
  const data = (await response.json()) as ExamReadinessResponse;
  return data.readiness;
}

export function useExamReadiness(examId: string) {
  return useQuery({
    queryKey: examReadinessQueryKey(examId),
    queryFn: () => fetchExamReadiness(examId),
    enabled: examId.length > 0,
    staleTime: 30_000,
  });
}
