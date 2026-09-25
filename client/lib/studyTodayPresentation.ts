import type {
  MasteryState,
  StudyActionCode,
  StudyPriority,
  StudyToday,
  StudyTodayReasonCode,
  StudyTodayRecommendation,
} from "@/lib/studyToday";

export type StudyTodayViewState =
  | "LOADING"
  | "ERROR"
  | "NO_COURSES"
  | "NO_CONCEPTS"
  | "EMPTY"
  | "READY";

export type StudyTodayErrorKind = "AUTHENTICATION" | "UNAVAILABLE";
type TopicTab = "notes" | "flashcards" | "quiz";

export function classifyStudyTodayError(error: unknown): StudyTodayErrorKind {
  const message = error instanceof Error ? error.message : "";
  if (message === "Authentication required" || message.startsWith("401:")) {
    return "AUTHENTICATION";
  }
  return "UNAVAILABLE";
}

export function studyTodayReasonLabel(code: StudyTodayReasonCode): string {
  switch (code) {
    case "LOW_MASTERY":
      return "Low mastery";
    case "NO_MASTERY_EVIDENCE":
      return "No mastery evidence yet";
    case "LOW_CONFIDENCE":
      return "Low confidence";
    case "SPARSE_EVIDENCE":
      return "Sparse evidence";
    case "UPCOMING_EXAM":
      return "Upcoming exam";
    case "WEAK_EXAM_CONCEPT":
      return "Weak exam concept";
    case "DUE_FLASHCARDS":
      return "Due flashcards";
  }
}

export function masteryStateLabel(state: MasteryState): string {
  switch (state) {
    case "STRONG":
      return "Strong evidence";
    case "DEVELOPING":
      return "Building mastery";
    case "WEAK":
      return "Needs practice";
    case "UNASSESSED":
      return "Not assessed yet";
  }
}

export function priorityLabel(priority: StudyPriority): string {
  switch (priority) {
    case "HIGH":
      return "High priority";
    case "MEDIUM":
      return "Medium priority";
    case "LOW":
      return "Low priority";
  }
}

export function suggestedActionLabel(code: StudyActionCode): string {
  switch (code) {
    case "REVIEW_FLASHCARDS":
      return "Review flashcards";
    case "TAKE_QUIZ":
      return "Take a quiz";
    case "REVIEW_CONCEPT":
      return "Review course material";
  }
}

export function getStudyTodayViewState({
  isLoading,
  error,
  studyToday,
}: {
  isLoading: boolean;
  error: unknown;
  studyToday: StudyToday | undefined;
}): StudyTodayViewState {
  if (isLoading) return "LOADING";
  if (error || !studyToday) return "ERROR";
  if (studyToday.status === "NO_COURSES") return "NO_COURSES";
  if (studyToday.status === "NO_CONCEPTS") return "NO_CONCEPTS";
  if (
    studyToday.status === "NO_RECOMMENDATIONS" ||
    studyToday.recommendations.length === 0
  ) {
    return "EMPTY";
  }
  return "READY";
}

export function getStudyTodayActionDestination(
  recommendation: StudyTodayRecommendation,
) {
  const initialTab: TopicTab =
    recommendation.suggestedAction.code === "REVIEW_FLASHCARDS"
      ? "flashcards"
      : recommendation.suggestedAction.code === "TAKE_QUIZ"
        ? "quiz"
        : "notes";
  return {
    screen: "Topic" as const,
    params: {
      topicId: recommendation.suggestedAction.topicId,
      courseId: recommendation.course.id,
      initialTab,
    },
  };
}

export function examRelevanceLabel(
  recommendation: StudyTodayRecommendation,
): string | null {
  const exam = recommendation.examRelevance.nearestExam;
  if (!exam) return null;
  if (exam.daysUntil === 0) return `${exam.name} is today`;
  if (exam.daysUntil === 1) return `${exam.name} is tomorrow`;
  return `${exam.name} in ${exam.daysUntil} days`;
}

export function getStudyTodayDisplay(studyToday: StudyToday) {
  return {
    recommendations: studyToday.recommendations,
    hasEvidenceGap: studyToday.recommendations.some((recommendation) =>
      recommendation.reasons.some(
        (reason) =>
          reason.code === "NO_MASTERY_EVIDENCE" ||
          reason.code === "SPARSE_EVIDENCE" ||
          reason.code === "LOW_CONFIDENCE",
      ),
    ),
  };
}
