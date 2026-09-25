export type ConceptReadinessStatus =
  | "STRONG"
  | "DEVELOPING"
  | "WEAK"
  | "UNASSESSED";

export type ExamReadinessBand =
  | "READY"
  | "PROGRESSING"
  | "NOT_READY"
  | "NO_SCOPE";

export interface ConceptReadiness {
  conceptId: string;
  topicId: string;
  name: string;
  status: ConceptReadinessStatus;
  readinessScore: number;
  masteryScore: number | null;
  confidence: number;
  evidenceCount: number;
  correctCount: number;
  incorrectCount: number;
  lastPracticedAt: string | null;
  trend: string;
}

export interface ExamReadiness {
  exam: {
    id: string;
    name: string;
    description: string | null;
    examDate: string;
  };
  course: {
    id: string;
    name: string;
  };
  readinessScore: number;
  readinessBand: ExamReadinessBand;
  totalConcepts: number;
  conceptsWithEvidence: number;
  conceptsWithoutEvidence: number;
  coveragePercentage: number;
  strongConcepts: ConceptReadiness[];
  developingConcepts: ConceptReadiness[];
  weakConcepts: ConceptReadiness[];
  unassessedConcepts: ConceptReadiness[];
  concepts: ConceptReadiness[];
  drivers: string[];
}

export type ExamReadinessErrorKind =
  | "AUTHENTICATION"
  | "ENTITLEMENT"
  | "NOT_FOUND"
  | "UNAVAILABLE";

export type ExamReadinessViewState = "LOADING" | "ERROR" | "READY";

export function classifyExamReadinessError(
  error: unknown,
): ExamReadinessErrorKind {
  const message = error instanceof Error ? error.message : "";
  if (message === "Authentication required" || message.startsWith("401:")) {
    return "AUTHENTICATION";
  }
  if (message.startsWith("403:")) return "ENTITLEMENT";
  if (message.startsWith("404:")) return "NOT_FOUND";
  return "UNAVAILABLE";
}

export function readinessBandLabel(band: ExamReadinessBand): string {
  switch (band) {
    case "READY":
      return "Readiness supported by evidence";
    case "PROGRESSING":
      return "Building readiness";
    case "NOT_READY":
      return "Needs more preparation evidence";
    case "NO_SCOPE":
      return "No exam scope yet";
  }
}

export function getExamReadinessViewState({
  isLoading,
  error,
  readiness,
}: {
  isLoading: boolean;
  error: unknown;
  readiness: ExamReadiness | undefined;
}): ExamReadinessViewState {
  if (isLoading) return "LOADING";
  if (error || !readiness) return "ERROR";
  return "READY";
}

export function getConceptReadinessGroups(readiness: ExamReadiness) {
  return {
    strong: readiness.strongConcepts,
    developing: readiness.developingConcepts,
    weak: readiness.weakConcepts,
    unassessed: readiness.unassessedConcepts,
  };
}

export function getExamReadinessDisplay(readiness: ExamReadiness) {
  const hasScope = readiness.totalConcepts > 0;
  const hasEvidence = readiness.conceptsWithEvidence > 0;
  const isSparse = hasScope && readiness.coveragePercentage < 80;

  return {
    hasScope,
    hasEvidence,
    isSparse,
    showScore: hasScope && hasEvidence,
    coverageLabel: `${readiness.conceptsWithEvidence} of ${readiness.totalConcepts} concepts have mastery evidence (${readiness.coveragePercentage}% coverage).`,
    sparseMessage: isSparse
      ? "Limited mastery evidence is available. More concepts need assessment before this readiness view is representative."
      : null,
    noScopeMessage:
      "This exam does not have a concept scope yet, so readiness cannot be calculated.",
    noEvidenceMessage:
      "No meaningful mastery evidence is available for this exam yet. Complete quizzes or flashcard reviews to build a readiness view.",
  };
}
