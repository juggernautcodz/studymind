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

export interface StudyTodayMasteryRecord {
  score: number;
  confidence: number;
  evidenceCount: number;
  correctCount: number;
  incorrectCount: number;
  lastPracticedAt: Date | null;
  trend: string;
}

export interface StudyTodayExamRecord {
  id: string;
  name: string;
  examDate: Date;
}

export interface StudyTodayConceptRecord {
  id: string;
  topicId: string;
  name: string;
  mastery: StudyTodayMasteryRecord | null;
  exams: StudyTodayExamRecord[];
  capabilities: {
    flashcardCount: number;
    dueFlashcardCount: number;
    quizCount: number;
    hasStudyMaterial: boolean;
  };
}

export interface StudyTodayCourseRecord {
  id: string;
  name: string;
  concepts: StudyTodayConceptRecord[];
}

export interface StudyTodayOwnedData {
  courses: StudyTodayCourseRecord[];
}

export interface StudyTodayRepository {
  findOwnedData(userId: string, now: Date): Promise<StudyTodayOwnedData>;
}

export interface StudyTodayFactor {
  code: StudyTodayReasonCode;
  label: string;
  points: number;
}

export interface StudyTodayRecommendation {
  course: { id: string; name: string };
  concept: { id: string; topicId: string; name: string };
  priority: StudyPriority;
  priorityScore: number;
  reasons: StudyTodayFactor[];
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

export interface StudyTodayResult {
  generatedAt: string;
  timeZone: "UTC";
  status: StudyTodayStatus;
  totalCourses: number;
  totalConcepts: number;
  recommendationCount: number;
  recommendations: StudyTodayRecommendation[];
}

export const STUDY_TODAY_CONFIG = {
  maxRecommendations: 10,
  maxPriorityScore: 100,
  mastery: {
    weakBelow: 0.5,
    strongAtOrAbove: 0.8,
    lowConfidenceBelow: 0.5,
    sparseEvidenceAtOrBelow: 2,
  },
  exam: {
    highestUrgencyWithinDays: 7,
    mediumUrgencyWithinDays: 14,
    maximumUrgencyWithinDays: 30,
    weakReadinessBelow: 0.5,
  },
  priority: {
    highAtOrAbove: 55,
    mediumAtOrAbove: 30,
  },
  points: {
    lowMastery: 35,
    noMasteryEvidence: 30,
    lowConfidence: 10,
    sparseEvidence: 10,
    weakExamConcept: 10,
    dueFlashcards: 10,
    upcomingExam: {
      within7Days: 20,
      within14Days: 15,
      within30Days: 8,
    },
  },
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function percent(value: number): number {
  return Math.round(clamp(value) * 100);
}

function startOfUtcDay(value: Date): number {
  return Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  );
}

function daysUntil(examDate: Date, now: Date): number {
  return Math.round((startOfUtcDay(examDate) - startOfUtcDay(now)) / DAY_MS);
}

function meaningfulEvidence(mastery: StudyTodayMasteryRecord | null): boolean {
  return Boolean(
    mastery &&
    mastery.evidenceCount > 0 &&
    mastery.correctCount + mastery.incorrectCount > 0,
  );
}

function masteryState(mastery: StudyTodayMasteryRecord | null): MasteryState {
  if (!mastery || !meaningfulEvidence(mastery)) return "UNASSESSED";
  if (mastery.score >= STUDY_TODAY_CONFIG.mastery.strongAtOrAbove) {
    return "STRONG";
  }
  if (mastery.score < STUDY_TODAY_CONFIG.mastery.weakBelow) return "WEAK";
  return "DEVELOPING";
}

function priority(score: number): StudyPriority {
  if (score >= STUDY_TODAY_CONFIG.priority.highAtOrAbove) return "HIGH";
  if (score >= STUDY_TODAY_CONFIG.priority.mediumAtOrAbove) return "MEDIUM";
  return "LOW";
}

function upcomingExamPoints(days: number): number {
  if (days < 0 || days > STUDY_TODAY_CONFIG.exam.maximumUrgencyWithinDays) {
    return 0;
  }
  if (days <= STUDY_TODAY_CONFIG.exam.highestUrgencyWithinDays) {
    return STUDY_TODAY_CONFIG.points.upcomingExam.within7Days;
  }
  if (days <= STUDY_TODAY_CONFIG.exam.mediumUrgencyWithinDays) {
    return STUDY_TODAY_CONFIG.points.upcomingExam.within14Days;
  }
  return STUDY_TODAY_CONFIG.points.upcomingExam.within30Days;
}

function suggestedAction(
  concept: StudyTodayConceptRecord,
  state: MasteryState,
): StudyTodayRecommendation["suggestedAction"] | null {
  if (state === "UNASSESSED" && concept.capabilities.quizCount > 0) {
    return {
      code: "TAKE_QUIZ",
      label: "Take a quiz to establish mastery evidence",
      topicId: concept.topicId,
    };
  }
  if (concept.capabilities.dueFlashcardCount > 0) {
    return {
      code: "REVIEW_FLASHCARDS",
      label: "Review due flashcards",
      topicId: concept.topicId,
    };
  }
  if (state === "WEAK" && concept.capabilities.quizCount > 0) {
    return {
      code: "TAKE_QUIZ",
      label: "Take a quiz on this concept",
      topicId: concept.topicId,
    };
  }
  if (concept.capabilities.flashcardCount > 0) {
    return {
      code: "REVIEW_FLASHCARDS",
      label: "Review this concept's flashcards",
      topicId: concept.topicId,
    };
  }
  if (concept.capabilities.hasStudyMaterial) {
    return {
      code: "REVIEW_CONCEPT",
      label: "Review this concept's source material",
      topicId: concept.topicId,
    };
  }
  return null;
}

function recommendationForConcept(
  course: StudyTodayCourseRecord,
  concept: StudyTodayConceptRecord,
  now: Date,
): StudyTodayRecommendation | null {
  const mastery = concept.mastery;
  const hasEvidence = meaningfulEvidence(mastery);
  const state = masteryState(mastery);
  const action = suggestedAction(concept, state);
  if (!action) return null;

  const upcomingExams = concept.exams
    .map((exam) => ({ ...exam, daysUntil: daysUntil(exam.examDate, now) }))
    .filter((exam) => exam.daysUntil >= 0)
    .sort(
      (left, right) =>
        left.daysUntil - right.daysUntil || left.id.localeCompare(right.id),
    );
  const nearestExam = upcomingExams[0] ?? null;
  const factors: StudyTodayFactor[] = [];

  if (!hasEvidence) {
    factors.push({
      code: "NO_MASTERY_EVIDENCE",
      label: "No meaningful mastery evidence yet",
      points: STUDY_TODAY_CONFIG.points.noMasteryEvidence,
    });
  } else if (mastery!.score < STUDY_TODAY_CONFIG.mastery.weakBelow) {
    factors.push({
      code: "LOW_MASTERY",
      label: "Low demonstrated mastery",
      points: STUDY_TODAY_CONFIG.points.lowMastery,
    });
  }

  if (
    hasEvidence &&
    mastery!.confidence < STUDY_TODAY_CONFIG.mastery.lowConfidenceBelow
  ) {
    factors.push({
      code: "LOW_CONFIDENCE",
      label: "Mastery confidence is still low",
      points: STUDY_TODAY_CONFIG.points.lowConfidence,
    });
  }
  if (
    hasEvidence &&
    mastery!.evidenceCount <= STUDY_TODAY_CONFIG.mastery.sparseEvidenceAtOrBelow
  ) {
    factors.push({
      code: "SPARSE_EVIDENCE",
      label: "Only sparse practice evidence is available",
      points: STUDY_TODAY_CONFIG.points.sparseEvidence,
    });
  }

  if (nearestExam) {
    const examPoints = upcomingExamPoints(nearestExam.daysUntil);
    if (examPoints > 0) {
      factors.push({
        code: "UPCOMING_EXAM",
        label: `${nearestExam.name} is ${nearestExam.daysUntil === 0 ? "today" : `in ${nearestExam.daysUntil} days`}`,
        points: examPoints,
      });
      if (
        hasEvidence &&
        mastery!.score * mastery!.confidence <
          STUDY_TODAY_CONFIG.exam.weakReadinessBelow
      ) {
        factors.push({
          code: "WEAK_EXAM_CONCEPT",
          label: "Exam-scoped readiness evidence is weak",
          points: STUDY_TODAY_CONFIG.points.weakExamConcept,
        });
      }
    }
  }

  if (concept.capabilities.dueFlashcardCount > 0) {
    factors.push({
      code: "DUE_FLASHCARDS",
      label: `${concept.capabilities.dueFlashcardCount} flashcard${concept.capabilities.dueFlashcardCount === 1 ? " is" : "s are"} due`,
      points: STUDY_TODAY_CONFIG.points.dueFlashcards,
    });
  }

  if (factors.length === 0) return null;
  const priorityScore = Math.min(
    STUDY_TODAY_CONFIG.maxPriorityScore,
    factors.reduce((sum, factor) => sum + factor.points, 0),
  );

  return {
    course: { id: course.id, name: course.name },
    concept: {
      id: concept.id,
      topicId: concept.topicId,
      name: concept.name,
    },
    priority: priority(priorityScore),
    priorityScore,
    reasons: factors,
    mastery: {
      state,
      score: hasEvidence ? percent(mastery!.score) : null,
      confidence: percent(mastery?.confidence ?? 0),
      evidenceCount: mastery?.evidenceCount ?? 0,
      correctCount: mastery?.correctCount ?? 0,
      incorrectCount: mastery?.incorrectCount ?? 0,
      lastPracticedAt: mastery?.lastPracticedAt?.toISOString() ?? null,
      trend: mastery?.trend ?? "UNKNOWN",
    },
    examRelevance: {
      isScoped: concept.exams.length > 0,
      nearestExam: nearestExam
        ? {
            id: nearestExam.id,
            name: nearestExam.name,
            examDate: nearestExam.examDate.toISOString(),
            daysUntil: nearestExam.daysUntil,
          }
        : null,
    },
    suggestedAction: action,
  };
}

export function calculateStudyToday(
  data: StudyTodayOwnedData,
  now: Date,
  limit = STUDY_TODAY_CONFIG.maxRecommendations,
): StudyTodayResult {
  const totalCourses = data.courses.length;
  const totalConcepts = data.courses.reduce(
    (sum, course) => sum + course.concepts.length,
    0,
  );
  const recommendations = data.courses
    .flatMap((course) =>
      course.concepts
        .map((concept) => recommendationForConcept(course, concept, now))
        .filter((item): item is StudyTodayRecommendation => item !== null),
    )
    .sort(
      (left, right) =>
        right.priorityScore - left.priorityScore ||
        left.course.name.localeCompare(right.course.name) ||
        left.concept.name.localeCompare(right.concept.name) ||
        left.concept.id.localeCompare(right.concept.id),
    )
    .slice(0, Math.max(0, limit));

  const status: StudyTodayStatus =
    totalCourses === 0
      ? "NO_COURSES"
      : totalConcepts === 0
        ? "NO_CONCEPTS"
        : recommendations.length === 0
          ? "NO_RECOMMENDATIONS"
          : "READY";

  return {
    generatedAt: now.toISOString(),
    timeZone: "UTC",
    status,
    totalCourses,
    totalConcepts,
    recommendationCount: recommendations.length,
    recommendations,
  };
}

export async function getStudyTodayFromRepository(
  repository: StudyTodayRepository,
  userId: string,
  now = new Date(),
): Promise<StudyTodayResult> {
  const data = await repository.findOwnedData(userId, now);
  return calculateStudyToday(data, now);
}
