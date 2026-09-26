import assert from "node:assert/strict";
import test from "node:test";

import {
  completeDurableFlashcardReview,
  completeDurableQuizSubmission,
  normalizeStudyTopicEvidence,
  quizAnswersByQuestionId,
  studyEvidenceQueryKeys,
} from "./studyEvidence";

test("server topic evidence preserves canonical flashcard, quiz, and question IDs", () => {
  const evidence = normalizeStudyTopicEvidence({
    flashcards: [
      {
        id: "server-card",
        topicId: "topic-1",
        question: "Question",
        answer: "Answer",
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
  });

  assert.equal(evidence.flashcards[0].id, "server-card");
  assert.equal(evidence.quizData?.quiz.id, "server-quiz");
  assert.equal(evidence.quizData?.questions[0].id, "server-question");
  assert.deepEqual(evidence.quizData?.questions[0].options, ["One", "Two"]);
});

test("quiz answers are keyed by canonical server question IDs", () => {
  const evidence = normalizeStudyTopicEvidence({
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
  });

  assert.deepEqual(
    quizAnswersByQuestionId(evidence.quizData!.questions, [0, 1]),
    { "question-a": 0, "question-b": 1 },
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
