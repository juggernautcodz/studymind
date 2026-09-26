import assert from "node:assert/strict";
import test from "node:test";

import type { StudyToday, StudyTodayRecommendation } from "./studyToday";
import {
  getStudyTodayActionDestination,
  getStudyTodayDisplay,
  getStudyTodayViewState,
  masteryStateLabel,
  priorityLabel,
  studyTodayReasonLabel,
  suggestedActionLabel,
} from "./studyTodayPresentation";

function recommendation(
  id: string,
  overrides: Partial<StudyTodayRecommendation> = {},
): StudyTodayRecommendation {
  return {
    course: { id: "course-1", name: "Biology" },
    concept: { id, topicId: `topic-${id}`, name: `Concept ${id}` },
    priority: "HIGH",
    priorityScore: 65,
    reasons: [
      {
        code: "LOW_MASTERY",
        label: "Low demonstrated mastery",
        points: 35,
      },
    ],
    mastery: {
      state: "WEAK",
      score: 30,
      confidence: 60,
      evidenceCount: 4,
      correctCount: 3,
      incorrectCount: 7,
      lastPracticedAt: null,
      trend: "STEADY",
    },
    examRelevance: { isScoped: false, nearestExam: null },
    suggestedAction: {
      code: "REVIEW_FLASHCARDS",
      label: "Review this concept's flashcards",
      topicId: `topic-${id}`,
    },
    ...overrides,
  };
}

function studyToday(overrides: Partial<StudyToday> = {}): StudyToday {
  return {
    generatedAt: "2026-09-25T12:00:00.000Z",
    timeZone: "UTC",
    status: "READY",
    totalCourses: 1,
    totalConcepts: 2,
    recommendationCount: 2,
    recommendations: [recommendation("first"), recommendation("second")],
    ...overrides,
  };
}

test("normal recommendations retain the canonical server order", () => {
  const first = recommendation("first", { priorityScore: 70 });
  const second = recommendation("second", { priorityScore: 35 });
  const display = getStudyTodayDisplay(
    studyToday({ recommendations: [first, second] }),
  );

  assert.deepEqual(
    display.recommendations.map((item) => item.concept.id),
    ["first", "second"],
  );
});

test("reason, mastery, priority, and action labels are friendly", () => {
  assert.equal(studyTodayReasonLabel("LOW_MASTERY"), "Low mastery");
  assert.equal(
    studyTodayReasonLabel("NO_MASTERY_EVIDENCE"),
    "No mastery evidence yet",
  );
  assert.equal(masteryStateLabel("UNASSESSED"), "Not assessed yet");
  assert.equal(priorityLabel("HIGH"), "High priority");
  assert.equal(suggestedActionLabel("TAKE_QUIZ"), "Take a quiz");
});

test("sparse and missing evidence stay visible", () => {
  const sparse = recommendation("sparse", {
    reasons: [
      {
        code: "NO_MASTERY_EVIDENCE",
        label: "No meaningful mastery evidence yet",
        points: 30,
      },
      {
        code: "SPARSE_EVIDENCE",
        label: "Only sparse practice evidence is available",
        points: 10,
      },
    ],
    mastery: {
      ...recommendation("base").mastery,
      state: "UNASSESSED",
      score: null,
      evidenceCount: 0,
    },
  });

  assert.equal(
    getStudyTodayDisplay(studyToday({ recommendations: [sparse] }))
      .hasEvidenceGap,
    true,
  );
});

test("empty, loading, and error states are distinct", () => {
  assert.equal(
    getStudyTodayViewState({
      isLoading: true,
      error: null,
      studyToday: undefined,
    }),
    "LOADING",
  );
  assert.equal(
    getStudyTodayViewState({
      isLoading: false,
      error: new Error("Network request failed"),
      studyToday: undefined,
    }),
    "ERROR",
  );
  assert.equal(
    getStudyTodayViewState({
      isLoading: false,
      error: null,
      studyToday: studyToday({
        status: "NO_RECOMMENDATIONS",
        recommendations: [],
        recommendationCount: 0,
      }),
    }),
    "EMPTY",
  );
});

test("supported actions map to existing topic tabs", () => {
  const flashcards = getStudyTodayActionDestination(recommendation("cards"));
  const quiz = getStudyTodayActionDestination(
    recommendation("quiz", {
      suggestedAction: {
        code: "TAKE_QUIZ",
        label: "Take a quiz on this concept",
        topicId: "topic-quiz",
      },
    }),
  );
  const notes = getStudyTodayActionDestination(
    recommendation("notes", {
      suggestedAction: {
        code: "REVIEW_CONCEPT",
        label: "Review this concept's source material",
        topicId: "topic-notes",
      },
    }),
  );

  assert.equal(flashcards.params.initialTab, "flashcards");
  assert.equal(flashcards.params.studyTodayAction, "REVIEW_FLASHCARDS");
  assert.equal(quiz.params.initialTab, "quiz");
  assert.equal(quiz.params.studyTodayAction, "TAKE_QUIZ");
  assert.equal(notes.params.initialTab, "notes");
  assert.equal("studyTodayAction" in notes.params, false);
});
