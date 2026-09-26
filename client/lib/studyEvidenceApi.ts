import { apiRequest, getAuthHeaders } from "@/lib/query-client";
import {
  normalizeStudyTopicEvidence,
  type FlashcardReviewInput,
  type QuizSubmissionInput,
  type QuizSubmissionResult,
  type StudyTopicEvidence,
} from "@/lib/studyEvidence";

async function requireAuthentication(): Promise<void> {
  const headers = await getAuthHeaders();
  if (!headers.Authorization) throw new Error("Authentication required");
}

export async function fetchStudyTopicEvidence(
  topicId: string,
): Promise<StudyTopicEvidence> {
  await requireAuthentication();
  const response = await apiRequest(
    "GET",
    `/api/sync/topic/${encodeURIComponent(topicId)}`,
  );
  return normalizeStudyTopicEvidence(await response.json());
}

export async function submitFlashcardReview(
  input: FlashcardReviewInput,
): Promise<unknown> {
  await requireAuthentication();
  const response = await apiRequest(
    "POST",
    `/api/adaptive/flashcards/${encodeURIComponent(input.flashcardId)}/answer`,
    { correct: input.correct, eventId: input.eventId },
  );
  return response.json();
}

export async function submitQuizAttempt(
  input: QuizSubmissionInput,
): Promise<QuizSubmissionResult> {
  await requireAuthentication();
  const response = await apiRequest(
    "POST",
    `/api/ai/quizzes/${encodeURIComponent(input.quizId)}/submit`,
    { answers: input.answers, submissionId: input.submissionId },
  );
  const data = (await response.json()) as QuizSubmissionResult;
  return {
    score: data.score,
    totalQuestions: data.totalQuestions,
    percentage: data.percentage,
  };
}
