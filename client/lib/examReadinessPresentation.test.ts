import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyExamReadinessError,
  getConceptReadinessGroups,
  getExamReadinessDisplay,
  getExamReadinessViewState,
  readinessBandLabel,
  type ConceptReadiness,
  type ExamReadiness,
} from "./examReadinessPresentation";

function readiness(overrides: Partial<ExamReadiness> = {}): ExamReadiness {
  return {
    exam: {
      id: "exam-1",
      name: "Biology midterm",
      description: null,
      examDate: "2026-10-15T14:00:00.000Z",
    },
    course: { id: "course-1", name: "Biology" },
    readinessScore: 72,
    readinessBand: "PROGRESSING",
    totalConcepts: 4,
    conceptsWithEvidence: 4,
    conceptsWithoutEvidence: 0,
    coveragePercentage: 100,
    strongConcepts: [],
    developingConcepts: [],
    weakConcepts: [],
    unassessedConcepts: [],
    concepts: [],
    drivers: [],
    ...overrides,
  };
}

function concept(
  conceptId: string,
  name: string,
  status: ConceptReadiness["status"],
): ConceptReadiness {
  return {
    conceptId,
    name,
    status,
    topicId: `topic-${conceptId}`,
    readinessScore: 0,
    masteryScore: null,
    confidence: 0,
    evidenceCount: 0,
    correctCount: 0,
    incorrectCount: 0,
    lastPracticedAt: null,
    trend: "UNKNOWN",
  };
}

test("normal readiness displays the canonical score and full coverage", () => {
  const display = getExamReadinessDisplay(readiness());
  assert.equal(display.showScore, true);
  assert.equal(display.isSparse, false);
  assert.equal(
    display.coverageLabel,
    "4 of 4 concepts have mastery evidence (100% coverage).",
  );
  assert.equal(readinessBandLabel("PROGRESSING"), "Building readiness");
});

test("sparse evidence remains visible alongside the server score", () => {
  const display = getExamReadinessDisplay(
    readiness({
      totalConcepts: 4,
      conceptsWithEvidence: 1,
      conceptsWithoutEvidence: 3,
      coveragePercentage: 25,
    }),
  );
  assert.equal(display.showScore, true);
  assert.equal(display.isSparse, true);
  assert.match(display.sparseMessage ?? "", /Limited mastery evidence/);
});

test("no scope never displays a fabricated readiness score", () => {
  const display = getExamReadinessDisplay(
    readiness({
      readinessScore: 0,
      readinessBand: "NO_SCOPE",
      totalConcepts: 0,
      conceptsWithEvidence: 0,
      conceptsWithoutEvidence: 0,
      coveragePercentage: 0,
    }),
  );
  assert.equal(display.showScore, false);
  assert.equal(display.hasScope, false);
  assert.match(display.noScopeMessage, /does not have a concept scope/);
});

test("no mastery evidence does not present a zero score as readiness", () => {
  const display = getExamReadinessDisplay(
    readiness({
      readinessScore: 0,
      totalConcepts: 3,
      conceptsWithEvidence: 0,
      conceptsWithoutEvidence: 3,
      coveragePercentage: 0,
    }),
  );
  assert.equal(display.showScore, false);
  assert.equal(display.hasEvidence, false);
  assert.match(display.noEvidenceMessage, /No meaningful mastery evidence/);
});

test("authentication, entitlement, and not-found errors have distinct states", () => {
  assert.equal(
    classifyExamReadinessError(new Error("Authentication required")),
    "AUTHENTICATION",
  );
  assert.equal(
    classifyExamReadinessError(new Error("403: Feature not available")),
    "ENTITLEMENT",
  );
  assert.equal(
    classifyExamReadinessError(new Error("404: Exam not found")),
    "NOT_FOUND",
  );
});

test("loading and error states remain distinct from a normal readiness response", () => {
  assert.equal(
    getExamReadinessViewState({
      isLoading: true,
      error: null,
      readiness: undefined,
    }),
    "LOADING",
  );
  assert.equal(
    getExamReadinessViewState({
      isLoading: false,
      error: new Error("404: Exam not found"),
      readiness: undefined,
    }),
    "ERROR",
  );
  assert.equal(
    getExamReadinessViewState({
      isLoading: false,
      error: null,
      readiness: readiness(),
    }),
    "READY",
  );
});

test("canonical concept categories remain separated for the screen", () => {
  const strong = concept("strong", "Strong", "STRONG");
  const weak = concept("weak", "Weak", "WEAK");
  const unassessed = concept("unassessed", "Unassessed", "UNASSESSED");
  const groups = getConceptReadinessGroups(
    readiness({
      strongConcepts: [strong],
      weakConcepts: [weak],
      unassessedConcepts: [unassessed],
    }),
  );
  assert.equal(groups.strong[0].conceptId, "strong");
  assert.equal(groups.weak[0].conceptId, "weak");
  assert.equal(groups.unassessed[0].conceptId, "unassessed");
});
