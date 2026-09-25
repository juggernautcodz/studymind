import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateStudyToday,
  getStudyTodayFromRepository,
  type StudyTodayConceptRecord,
  type StudyTodayCourseRecord,
  type StudyTodayMasteryRecord,
  type StudyTodayOwnedData,
  type StudyTodayRepository,
} from "./study-today-domain";

const NOW = new Date("2026-09-25T12:00:00.000Z");

function mastery(
  overrides: Partial<StudyTodayMasteryRecord> = {},
): StudyTodayMasteryRecord {
  return {
    score: 0.4,
    confidence: 0.8,
    evidenceCount: 5,
    correctCount: 4,
    incorrectCount: 6,
    lastPracticedAt: new Date("2026-09-24T12:00:00.000Z"),
    trend: "STEADY",
    ...overrides,
  };
}

function concept(
  id: string,
  overrides: Partial<StudyTodayConceptRecord> = {},
): StudyTodayConceptRecord {
  return {
    id,
    topicId: `topic-${id}`,
    name: `Concept ${id}`,
    mastery: mastery(),
    exams: [],
    capabilities: {
      flashcardCount: 4,
      dueFlashcardCount: 0,
      quizCount: 1,
      hasStudyMaterial: true,
    },
    ...overrides,
  };
}

function course(
  id: string,
  concepts: StudyTodayConceptRecord[],
): StudyTodayCourseRecord {
  return { id, name: `Course ${id}`, concepts };
}

function data(courses: StudyTodayCourseRecord[]): StudyTodayOwnedData {
  return { courses };
}

test("weak concepts rank above strong concepts", () => {
  const weak = concept("weak", { mastery: mastery({ score: 0.2 }) });
  const strong = concept("strong", {
    mastery: mastery({ score: 0.9, confidence: 1 }),
    capabilities: {
      flashcardCount: 4,
      dueFlashcardCount: 2,
      quizCount: 1,
      hasStudyMaterial: true,
    },
  });

  const result = calculateStudyToday(
    data([course("one", [strong, weak])]),
    NOW,
  );

  assert.deepEqual(
    result.recommendations.map((item) => item.concept.id),
    ["weak", "strong"],
  );
  assert.ok(
    result.recommendations[0].priorityScore >
      result.recommendations[1].priorityScore,
  );
});

test("unassessed concepts stay visible without fabricated mastery", () => {
  const result = calculateStudyToday(
    data([course("one", [concept("new", { mastery: null })])]),
    NOW,
  );
  const item = result.recommendations[0];

  assert.equal(item.mastery.state, "UNASSESSED");
  assert.equal(item.mastery.score, null);
  assert.ok(
    item.reasons.some((reason) => reason.code === "NO_MASTERY_EVIDENCE"),
  );
  assert.equal(item.suggestedAction.code, "TAKE_QUIZ");
});

test("an upcoming exam increases priority for a weak scoped concept", () => {
  const baseline = concept("baseline", { mastery: mastery({ score: 0.2 }) });
  const examConcept = concept("exam", {
    mastery: mastery({ score: 0.2 }),
    exams: [
      {
        id: "exam-1",
        name: "Midterm",
        examDate: new Date("2026-09-30T20:00:00.000Z"),
      },
    ],
  });

  const result = calculateStudyToday(
    data([course("one", [baseline, examConcept])]),
    NOW,
  );
  const rankedExam = result.recommendations.find(
    (item) => item.concept.id === "exam",
  )!;
  const rankedBaseline = result.recommendations.find(
    (item) => item.concept.id === "baseline",
  )!;

  assert.ok(rankedExam.priorityScore > rankedBaseline.priorityScore);
  assert.ok(
    rankedExam.reasons.some((reason) => reason.code === "UPCOMING_EXAM"),
  );
  assert.ok(
    rankedExam.reasons.some((reason) => reason.code === "WEAK_EXAM_CONCEPT"),
  );
  assert.equal(rankedExam.examRelevance.nearestExam?.daysUntil, 5);
});

test("far-future and absent exams add no artificial urgency", () => {
  const noExam = concept("none", { mastery: mastery({ score: 0.2 }) });
  const farExam = concept("far", {
    mastery: mastery({ score: 0.2 }),
    exams: [
      {
        id: "exam-far",
        name: "Final",
        examDate: new Date("2026-12-15T12:00:00.000Z"),
      },
    ],
  });

  const result = calculateStudyToday(
    data([course("one", [farExam, noExam])]),
    NOW,
  );
  const far = result.recommendations.find((item) => item.concept.id === "far")!;
  const none = result.recommendations.find(
    (item) => item.concept.id === "none",
  )!;

  assert.equal(far.priorityScore, none.priorityScore);
  assert.equal(
    far.reasons.some((reason) => reason.code === "UPCOMING_EXAM"),
    false,
  );
});

test("strong well-evidenced concepts are omitted unless another real factor exists", () => {
  const result = calculateStudyToday(
    data([
      course("one", [
        concept("strong", {
          mastery: mastery({
            score: 0.95,
            confidence: 1,
            evidenceCount: 12,
            correctCount: 19,
            incorrectCount: 1,
          }),
        }),
      ]),
    ]),
    NOW,
  );

  assert.equal(result.status, "NO_RECOMMENDATIONS");
  assert.equal(result.recommendationCount, 0);
});

test("sparse evidence remains explicit in the recommendation reasons", () => {
  const result = calculateStudyToday(
    data([
      course("one", [
        concept("sparse", {
          mastery: mastery({
            score: 0.6,
            confidence: 0.2,
            evidenceCount: 1,
            correctCount: 1,
            incorrectCount: 1,
          }),
        }),
      ]),
    ]),
    NOW,
  );
  const codes = result.recommendations[0].reasons.map((reason) => reason.code);

  assert.ok(codes.includes("LOW_CONFIDENCE"));
  assert.ok(codes.includes("SPARSE_EVIDENCE"));
});

test("the authenticated user id is passed to the repository", async () => {
  let requestedUserId: string | null = null;
  const repository: StudyTodayRepository = {
    async findOwnedData(userId) {
      requestedUserId = userId;
      return data([course("owned", [concept("owned-concept")])]);
    },
  };

  await getStudyTodayFromRepository(repository, "user-a", NOW);

  assert.equal(requestedUserId, "user-a");
});

test("cross-user records cannot influence an authenticated user's recommendations", async () => {
  const records: Record<string, StudyTodayOwnedData> = {
    "user-a": data([course("a", [concept("a-concept")])]),
    "user-b": data([
      course("b", [
        concept("b-concept", {
          exams: [
            {
              id: "b-exam",
              name: "Other user's exam",
              examDate: new Date("2026-09-26T12:00:00.000Z"),
            },
          ],
        }),
      ]),
    ]),
  };
  const repository: StudyTodayRepository = {
    async findOwnedData(userId) {
      return records[userId] ?? data([]);
    },
  };

  const result = await getStudyTodayFromRepository(repository, "user-a", NOW);

  assert.deepEqual(
    result.recommendations.map((item) => item.course.id),
    ["a"],
  );
  assert.equal(
    result.recommendations.some((item) => item.concept.id === "b-concept"),
    false,
  );
});

test("empty and concept-free course states are distinct", () => {
  const noCourses = calculateStudyToday(data([]), NOW);
  const noConcepts = calculateStudyToday(data([course("empty", [])]), NOW);

  assert.equal(noCourses.status, "NO_COURSES");
  assert.equal(noCourses.totalCourses, 0);
  assert.equal(noConcepts.status, "NO_CONCEPTS");
  assert.equal(noConcepts.totalCourses, 1);
  assert.equal(noConcepts.totalConcepts, 0);
});

test("ranking is deterministic regardless of input order", () => {
  const alpha = concept("alpha", { name: "Alpha" });
  const beta = concept("beta", { name: "Beta" });
  const forward = calculateStudyToday(
    data([course("one", [alpha, beta])]),
    NOW,
  );
  const reverse = calculateStudyToday(
    data([course("one", [beta, alpha])]),
    NOW,
  );

  assert.deepEqual(forward, reverse);
});

test("the recommendation list is bounded", () => {
  const concepts = Array.from({ length: 15 }, (_, index) =>
    concept(`concept-${index.toString().padStart(2, "0")}`),
  );

  const result = calculateStudyToday(data([course("one", concepts)]), NOW);

  assert.equal(result.recommendationCount, 10);
});
