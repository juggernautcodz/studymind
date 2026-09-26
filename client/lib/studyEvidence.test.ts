import assert from "node:assert/strict";
import test from "node:test";

import {
  completeDurableFlashcardReview,
  completeDurableQuizSubmission,
  hydrateStudyTopic,
  mergeHydratedTopicCache,
  normalizeStudyTopicEvidence,
  quizAnswersByQuestionId,
  studyEvidenceQueryKeys,
} from "./studyEvidence";
import { scopedStorageKey } from "./storageNamespace";

function topicPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "topic-1",
    userId: "user-1",
    courseId: "course-1",
    name: "Cell Biology",
    orderIndex: 0,
    status: "completed",
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z",
    notes: "# Cell Structure\n- Cells have membranes",
    transcript: null,
    flashcards: [],
    quizzes: [],
    sources: [],
    ...overrides,
  };
}

test("server topic evidence preserves canonical flashcard, quiz, and question IDs", () => {
  const evidence = normalizeStudyTopicEvidence(
    topicPayload({
      flashcards: [
        {
          id: "server-card",
          topicId: "topic-1",
          front: "Question",
          back: "Answer",
          orderIndex: 0,
        },
      ],
      quizzes: [
        {
          id: "server-quiz",
          topicId: "topic-1",
          createdAt: "2026-09-25T00:00:00.000Z",
          questions: [
            {
              id: "server-question",
              question: "Which answer?",
              options: '["One","Two"]',
              correctAnswer: 1,
              orderIndex: 0,
            },
          ],
        },
      ],
    }),
  );

  assert.equal(evidence.notes?.sections[0].bullets[0], "Cells have membranes");
  assert.equal(evidence.flashcards[0].id, "server-card");
  assert.equal(evidence.flashcards[0].question, "Question");
  assert.equal(evidence.quizData?.quiz.id, "server-quiz");
  assert.equal(evidence.quizData?.questions[0].id, "server-question");
  assert.deepEqual(evidence.quizData?.questions[0].options, ["One", "Two"]);
});

test("quiz answers are keyed by canonical server question IDs", () => {
  const evidence = normalizeStudyTopicEvidence(
    topicPayload({
      quizzes: [
        {
          id: "quiz-1",
          topicId: "topic-1",
          createdAt: "2026-09-25T00:00:00.000Z",
          questions: [
            {
              id: "question-a",
              question: "A?",
              options: ["0", "1"],
              correctAnswer: 0,
              orderIndex: 0,
            },
            {
              id: "question-b",
              question: "B?",
              options: ["0", "1"],
              correctAnswer: 1,
              orderIndex: 1,
            },
          ],
        },
      ],
    }),
  );

  assert.deepEqual(
    quizAnswersByQuestionId(evidence.quizData!.questions, [0, 1]),
    { "question-a": 0, "question-b": 1 },
  );
});

test("fresh-device hydration renders and caches server Notes, Cards, and Quiz", async () => {
  const evidence = normalizeStudyTopicEvidence(
    topicPayload({
      flashcards: [
        {
          id: "server-card",
          topicId: "topic-1",
          front: "Front",
          back: "Back",
          orderIndex: 0,
        },
      ],
      quizzes: [
        {
          id: "server-quiz",
          topicId: "topic-1",
          createdAt: "2026-09-25T00:00:00.000Z",
          questions: [
            {
              id: "server-question",
              question: "Question",
              options: '["A","B"]',
              correctAnswer: 0,
              orderIndex: 0,
            },
          ],
        },
      ],
    }),
  );
  let cached = false;
  const hydrated = await hydrateStudyTopic({
    destination: "notes",
    cached: { topic: null, notes: null, flashcards: [], quizData: null },
    fetchServer: async () => evidence,
    cacheServer: async (content) => {
      cached = content === evidence;
    },
  });

  assert.equal(hydrated.source, "SERVER");
  assert.equal(cached, true);
  assert.equal(hydrated.content.notes?.topicId, "topic-1");
  assert.equal(hydrated.content.flashcards[0].id, "server-card");
  assert.equal(hydrated.content.quizData?.quiz.id, "server-quiz");
  assert.equal(hydrated.content.quizData?.questions[0].id, "server-question");
});

test("network failure uses an existing destination cache but never fabricates empty success", async () => {
  const cached = {
    topic: normalizeStudyTopicEvidence(topicPayload()).topic,
    notes: normalizeStudyTopicEvidence(topicPayload()).notes,
    flashcards: [],
    quizData: null,
  };
  const offline = await hydrateStudyTopic({
    destination: "notes",
    cached,
    fetchServer: async () => {
      throw new Error("Network request failed");
    },
    cacheServer: async () => {},
  });
  assert.equal(offline.source, "CACHE");
  assert.equal(offline.warning?.kind, "UNAVAILABLE");

  await assert.rejects(
    hydrateStudyTopic({
      destination: "quiz",
      cached,
      fetchServer: async () => {
        throw new Error("Network request failed");
      },
      cacheServer: async () => {},
    }),
    /Network request failed/,
  );
});

test("unauthorized and not-found server topics cannot fall back to cached content", async () => {
  const cached = {
    topic: normalizeStudyTopicEvidence(topicPayload()).topic,
    notes: normalizeStudyTopicEvidence(topicPayload()).notes,
    flashcards: [],
    quizData: null,
  };
  for (const message of ["401: unauthorized", "404: topic not found"]) {
    await assert.rejects(
      hydrateStudyTopic({
        destination: "notes",
        cached,
        fetchServer: async () => {
          throw new Error(message);
        },
        cacheServer: async () => {},
      }),
      /401|404/,
    );
  }
});

test("empty server topic is a valid hydrated result", async () => {
  const empty = normalizeStudyTopicEvidence(
    topicPayload({ notes: null, transcript: null, sources: [] }),
  );
  const hydrated = await hydrateStudyTopic({
    destination: "notes",
    cached: { topic: null, notes: null, flashcards: [], quizData: null },
    fetchServer: async () => empty,
    cacheServer: async () => {},
  });
  assert.equal(hydrated.source, "SERVER");
  assert.equal(hydrated.content.notes, null);
});

test("source-backed topic content appears in Notes when notes and transcript are absent", () => {
  const evidence = normalizeStudyTopicEvidence(
    topicPayload({
      notes: null,
      transcript: null,
      sources: [
        {
          title: "Lecture handout",
          revisions: [
            {
              segments: [{ position: 0, content: "Mitochondria produce ATP." }],
            },
          ],
        },
      ],
    }),
  );
  assert.deepEqual(evidence.notes?.sections, [
    {
      heading: "Lecture handout",
      bullets: ["Mitochondria produce ATP."],
    },
  ]);
});

test("cache reconciliation fills missing content without overwriting local pending data", () => {
  const hydration = normalizeStudyTopicEvidence(
    topicPayload({
      flashcards: [
        {
          id: "server-card",
          topicId: "topic-1",
          front: "Server",
          back: "Answer",
          orderIndex: 0,
        },
      ],
    }),
  );
  const localNote = {
    ...hydration.notes!,
    id: "local-note",
    sections: [{ heading: "Local", bullets: ["Pending edit"] }],
  };
  const merged = mergeHydratedTopicCache(
    {
      topics: [],
      notes: [localNote],
      flashcards: [],
      quizzes: [],
      questions: [],
    },
    hydration,
  );
  assert.equal(merged.topics[0].id, "topic-1");
  assert.equal(merged.notes[0].id, "local-note");
  assert.equal(merged.flashcards[0].id, "server-card");
});

test("existing cached Cards and Quiz remain untouched for offline compatibility", () => {
  const hydration = normalizeStudyTopicEvidence(
    topicPayload({
      flashcards: [
        {
          id: "server-card",
          topicId: "topic-1",
          front: "Server",
          back: "Answer",
          orderIndex: 0,
        },
      ],
      quizzes: [
        {
          id: "server-quiz",
          topicId: "topic-1",
          createdAt: "2026-09-25T00:00:00.000Z",
          questions: [],
        },
      ],
    }),
  );
  const localCard = {
    id: "local-card",
    topicId: "topic-1",
    question: "Pending local card",
    answer: "Answer",
    orderIndex: 0,
  };
  const localQuiz = {
    id: "local-quiz",
    topicId: "topic-1",
    createdAt: "2026-09-25T00:00:00.000Z",
  };
  const localQuestion = {
    id: "local-question",
    quizId: "local-quiz",
    question: "Pending local question",
    options: ["A", "B"],
    correctIndex: 0,
    orderIndex: 0,
  };
  const merged = mergeHydratedTopicCache(
    {
      topics: [hydration.topic],
      notes: [],
      flashcards: [localCard],
      quizzes: [localQuiz],
      questions: [localQuestion],
    },
    hydration,
  );
  assert.deepEqual(merged.flashcards, [localCard]);
  assert.deepEqual(merged.quizzes, [localQuiz]);
  assert.deepEqual(merged.questions, [localQuestion]);
});

test("hydrated cache keys remain isolated per active user", () => {
  const globalKeys = new Set(["studymind_user", "studymind_auth_token"]);
  assert.equal(
    scopedStorageKey("studymind_notes", "user-a", globalKeys),
    "user-a:studymind_notes",
  );
  assert.equal(
    scopedStorageKey("studymind_notes", "user-b", globalKeys),
    "user-b:studymind_notes",
  );
  assert.notEqual(
    scopedStorageKey("studymind_notes", "user-a", globalKeys),
    scopedStorageKey("studymind_notes", "user-b", globalKeys),
  );
});

test("flashcard review reports success only after durable persistence", async () => {
  const calls: string[] = [];
  await completeDurableFlashcardReview({
    input: { flashcardId: "card-1", correct: true, eventId: "event-1" },
    persist: async () => {
      calls.push("persist");
      return { duplicate: false };
    },
    onPersisted: () => {
      calls.push("success");
    },
  });
  assert.deepEqual(calls, ["persist", "success"]);
});

test("failed flashcard persistence is not reported as a successful review", async () => {
  let successCalled = false;
  await assert.rejects(
    completeDurableFlashcardReview({
      input: { flashcardId: "card-1", correct: false, eventId: "event-1" },
      persist: async () => {
        throw new Error("server rejected review");
      },
      onPersisted: () => {
        successCalled = true;
      },
    }),
    /server rejected review/,
  );
  assert.equal(successCalled, false);
});

test("successful quiz submission refreshes Study Today, Mastery, and readiness", async () => {
  const refreshed: readonly string[][] = studyEvidenceQueryKeys("course-1");
  let completed = false;
  const result = await completeDurableQuizSubmission({
    input: {
      quizId: "quiz-1",
      answers: { "question-1": 1 },
      submissionId: "submission-1",
    },
    persist: async () => ({ score: 1, totalQuestions: 1, percentage: 100 }),
    onPersisted: () => {
      completed = true;
    },
  });

  assert.equal(result.score, 1);
  assert.equal(completed, true);
  assert.deepEqual(refreshed, [
    ["study-today"],
    ["course-mastery", "course-1"],
    ["exam-readiness"],
  ]);
});

test("server quiz failure remains visible and skips cache refresh", async () => {
  let refreshed = false;
  await assert.rejects(
    completeDurableQuizSubmission({
      input: {
        quizId: "quiz-1",
        answers: { "question-1": 0 },
        submissionId: "submission-1",
      },
      persist: async () => {
        throw new Error("500: submission failed");
      },
      onPersisted: () => {
        refreshed = true;
      },
    }),
    /submission failed/,
  );
  assert.equal(refreshed, false);
});
