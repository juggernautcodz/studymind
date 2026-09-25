import { AppError } from "./lib/errors";

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

export interface ScopedConceptEvidence {
  conceptId: string;
  topicId: string;
  name: string;
  mastery: {
    score: number;
    confidence: number;
    evidenceCount: number;
    correctCount: number;
    incorrectCount: number;
    lastPracticedAt: Date | null;
    trend: string;
  } | null;
}

export interface OwnedExamReadinessRecord {
  exam: {
    id: string;
    name: string;
    description: string | null;
    examDate: Date;
  };
  course: {
    id: string;
    name: string;
  };
  concepts: ScopedConceptEvidence[];
}

export interface ExamReadinessRepository {
  findOwnedExam(
    examId: string,
    userId: string,
  ): Promise<OwnedExamReadinessRecord | null>;
}

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

export interface ExamReadinessResult {
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

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function percent(value: number): number {
  return Math.round(clamp(value) * 100);
}

function readinessBand(
  score: number,
  coveragePercentage: number,
  totalConcepts: number,
): ExamReadinessBand {
  if (totalConcepts === 0) return "NO_SCOPE";
  if (score >= 80 && coveragePercentage >= 80) return "READY";
  if (score >= 50 && coveragePercentage >= 50) return "PROGRESSING";
  return "NOT_READY";
}

function conceptReadiness(concept: ScopedConceptEvidence): ConceptReadiness {
  const mastery = concept.mastery;
  const hasEvidence =
    mastery !== null &&
    mastery.evidenceCount > 0 &&
    mastery.correctCount + mastery.incorrectCount > 0;

  if (!hasEvidence || !mastery) {
    return {
      conceptId: concept.conceptId,
      topicId: concept.topicId,
      name: concept.name,
      status: "UNASSESSED",
      readinessScore: 0,
      masteryScore: null,
      confidence: mastery ? percent(mastery.confidence) : 0,
      evidenceCount: mastery?.evidenceCount ?? 0,
      correctCount: mastery?.correctCount ?? 0,
      incorrectCount: mastery?.incorrectCount ?? 0,
      lastPracticedAt: mastery?.lastPracticedAt?.toISOString() ?? null,
      trend: mastery?.trend ?? "UNKNOWN",
    };
  }

  const weightedScore = percent(
    clamp(mastery.score) * clamp(mastery.confidence),
  );
  const status: ConceptReadinessStatus =
    weightedScore >= 80
      ? "STRONG"
      : weightedScore >= 50
        ? "DEVELOPING"
        : "WEAK";

  return {
    conceptId: concept.conceptId,
    topicId: concept.topicId,
    name: concept.name,
    status,
    readinessScore: weightedScore,
    masteryScore: percent(mastery.score),
    confidence: percent(mastery.confidence),
    evidenceCount: mastery.evidenceCount,
    correctCount: mastery.correctCount,
    incorrectCount: mastery.incorrectCount,
    lastPracticedAt: mastery.lastPracticedAt?.toISOString() ?? null,
    trend: mastery.trend,
  };
}

export function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

export function calculateExamReadiness(
  record: OwnedExamReadinessRecord,
): ExamReadinessResult {
  const concepts = record.concepts.map(conceptReadiness);
  const totalConcepts = concepts.length;
  const conceptsWithEvidence = concepts.filter(
    (concept) => concept.status !== "UNASSESSED",
  ).length;
  const conceptsWithoutEvidence = totalConcepts - conceptsWithEvidence;
  const coveragePercentage = totalConcepts
    ? Math.round((conceptsWithEvidence / totalConcepts) * 100)
    : 0;
  const score = totalConcepts
    ? Math.round(
        concepts.reduce((sum, concept) => sum + concept.readinessScore, 0) /
          totalConcepts,
      )
    : 0;

  const strongConcepts = concepts.filter(
    (concept) => concept.status === "STRONG",
  );
  const developingConcepts = concepts.filter(
    (concept) => concept.status === "DEVELOPING",
  );
  const weakConcepts = concepts.filter((concept) => concept.status === "WEAK");
  const unassessedConcepts = concepts.filter(
    (concept) => concept.status === "UNASSESSED",
  );
  const drivers = [
    `${conceptsWithEvidence} of ${totalConcepts} exam concepts have meaningful mastery evidence (${coveragePercentage}% coverage).`,
    "Each concept contributes its Phase 5 mastery score weighted by evidence confidence; unassessed concepts contribute zero.",
  ];

  if (conceptsWithoutEvidence > 0) {
    drivers.push(
      `${conceptsWithoutEvidence} ${conceptsWithoutEvidence === 1 ? "concept has" : "concepts have"} no meaningful evidence.`,
    );
  }
  if (weakConcepts.length > 0) {
    drivers.push(
      `Lowest-readiness evidence: ${weakConcepts
        .slice()
        .sort((left, right) => left.readinessScore - right.readinessScore)
        .slice(0, 3)
        .map((concept) => concept.name)
        .join(", ")}.`,
    );
  } else if (strongConcepts.length > 0) {
    drivers.push(
      `Strongest evidence: ${strongConcepts
        .slice()
        .sort((left, right) => right.readinessScore - left.readinessScore)
        .slice(0, 3)
        .map((concept) => concept.name)
        .join(", ")}.`,
    );
  }

  return {
    exam: {
      ...record.exam,
      examDate: record.exam.examDate.toISOString(),
    },
    course: record.course,
    readinessScore: score,
    readinessBand: readinessBand(score, coveragePercentage, totalConcepts),
    totalConcepts,
    conceptsWithEvidence,
    conceptsWithoutEvidence,
    coveragePercentage,
    strongConcepts,
    developingConcepts,
    weakConcepts,
    unassessedConcepts,
    concepts,
    drivers,
  };
}

export async function getExamReadinessFromRepository(
  repository: ExamReadinessRepository,
  userId: string,
  examId: string,
): Promise<ExamReadinessResult> {
  const record = await repository.findOwnedExam(examId, userId);
  if (!record) throw new AppError(404, "NOT_FOUND", "Exam not found");
  return calculateExamReadiness(record);
}
