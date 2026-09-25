import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateExamReadiness,
  getExamReadinessFromRepository,
  uniqueIds,
  type ExamReadinessRepository,
  type OwnedExamReadinessRecord,
  type ScopedConceptEvidence,
} from "./exam-readiness-domain";
import { AppError } from "./lib/errors";

function concept(
  id: string,
  score: number | null,
  confidence = 1,
  answers = 20,
): ScopedConceptEvidence {
  return {
    conceptId: id,
    topicId: `topic-${id}`,
    name: `Concept ${id}`,
    mastery:
      score === null
        ? null
        : {
            score,
            confidence,
            evidenceCount: answers > 0 ? 1 : 0,
            correctCount: Math.round(score * answers),
            incorrectCount: answers - Math.round(score * answers),
            lastPracticedAt: new Date("2026-09-24T12:00:00.000Z"),
            trend: "STEADY",
          },
  };
}

function record(concepts: ScopedConceptEvidence[]): OwnedExamReadinessRecord {
  return {
    exam: {
      id: "exam-1",
      name: "Midterm",
      description: "Units 1-3",
      examDate: new Date("2026-10-15T14:00:00.000Z"),
    },
    course: { id: "course-1", name: "Biology" },
    concepts,
  };
}

test("high mastery with strong evidence produces high readiness", () => {
  const result = calculateExamReadiness(
    record([concept("a", 0.9), concept("b", 0.8)]),
  );
  assert.equal(result.readinessScore, 85);
  assert.equal(result.readinessBand, "READY");
  assert.equal(result.strongConcepts.length, 2);
  assert.equal(result.coveragePercentage, 100);
});

test("mixed mastery produces a mixed readiness result", () => {
  const result = calculateExamReadiness(
    record([concept("a", 0.9), concept("b", 0.6), concept("c", 0.2)]),
  );
  assert.equal(result.readinessScore, 57);
  assert.equal(result.readinessBand, "PROGRESSING");
  assert.equal(result.strongConcepts.length, 1);
  assert.equal(result.developingConcepts.length, 1);
  assert.equal(result.weakConcepts.length, 1);
});

test("weak mastery produces low readiness", () => {
  const result = calculateExamReadiness(
    record([concept("a", 0.2), concept("b", 0.3)]),
  );
  assert.equal(result.readinessScore, 25);
  assert.equal(result.readinessBand, "NOT_READY");
  assert.equal(result.weakConcepts.length, 2);
});

test("missing mastery evidence is unassessed and contributes zero", () => {
  const result = calculateExamReadiness(
    record([concept("a", 0.9), concept("b", null)]),
  );
  assert.equal(result.readinessScore, 45);
  assert.equal(result.conceptsWithEvidence, 1);
  assert.equal(result.conceptsWithoutEvidence, 1);
  assert.equal(result.unassessedConcepts[0].masteryScore, null);
  assert.equal(result.unassessedConcepts[0].readinessScore, 0);
});

test("sparse evidence is exposed through confidence and coverage", () => {
  const result = calculateExamReadiness(
    record([concept("a", 1, 0.1, 2), concept("b", null)]),
  );
  assert.equal(result.readinessScore, 5);
  assert.equal(result.coveragePercentage, 50);
  assert.equal(result.concepts[0].masteryScore, 100);
  assert.equal(result.concepts[0].confidence, 10);
  assert.equal(result.concepts[0].readinessScore, 10);
});

test("only concepts returned in the exam scope affect readiness", async () => {
  const repository: ExamReadinessRepository = {
    async findOwnedExam() {
      return record([concept("scoped", 0.8)]);
    },
  };
  const result = await getExamReadinessFromRepository(
    repository,
    "user-1",
    "exam-1",
  );
  assert.equal(result.totalConcepts, 1);
  assert.equal(result.concepts[0].conceptId, "scoped");
  assert.equal(result.readinessScore, 80);
});

test("ownership boundaries return the same not-found response", async () => {
  const repository: ExamReadinessRepository = {
    async findOwnedExam(_examId, userId) {
      return userId === "owner" ? record([]) : null;
    },
  };
  await assert.rejects(
    getExamReadinessFromRepository(repository, "different-user", "exam-1"),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 404 &&
      error.message === "Exam not found",
  );
});

test("duplicate concept associations are normalized idempotently", () => {
  assert.deepEqual(uniqueIds(["a", "a", "b", "a"]), ["a", "b"]);
});

test("nonexistent exams return not found", async () => {
  const repository: ExamReadinessRepository = {
    async findOwnedExam() {
      return null;
    },
  };
  await assert.rejects(
    getExamReadinessFromRepository(repository, "user-1", "missing"),
    (error: unknown) => error instanceof AppError && error.code === "NOT_FOUND",
  );
});

test("readiness calculation preserves Phase 5 mastery data", () => {
  const input = record([concept("a", 0.75, 0.5, 8)]);
  const before = structuredClone(input);
  const result = calculateExamReadiness(input);
  assert.deepEqual(input, before);
  assert.equal(result.concepts[0].masteryScore, 75);
  assert.equal(result.concepts[0].confidence, 50);
  assert.equal(result.concepts[0].readinessScore, 38);
});
