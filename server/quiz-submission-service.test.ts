import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "./lib/errors";
import {
  createQuizSubmissionService,
  type QuizAttemptRecord,
  type QuizSubmissionDependencies,
} from "./quiz-submission-service";

function harness() {
  const attempts = new Map<string, QuizAttemptRecord>();
  const masteryUpdates: Array<{ userId: string; courseId: string }> = [];
  let nextAttempt = 1;

  const dependencies: QuizSubmissionDependencies = {
    findOwnedQuiz: async (userId, quizId) =>
      userId === "owner" && quizId === "quiz-1"
        ? {
            id: quizId,
            topic: { courseId: "course-1" },
            questions: [
              { id: "question-a", correctAnswer: 1, explanation: null },
              { id: "question-b", correctAnswer: 0, explanation: "Because" },
            ],
          }
        : null,
    upsertAttempt: async (input) => {
      const key = `${input.userId}:${input.quizId}:${input.submissionId}`;
      const existing = attempts.get(key);
      if (existing) return existing;
      const attempt = {
        id: `attempt-${nextAttempt++}`,
        answers: input.answers,
        score: input.score,
        totalQuestions: input.totalQuestions,
        submissionId: input.submissionId,
      };
      attempts.set(key, attempt);
      return attempt;
    },
    updateMastery: async (userId, courseId) => {
      masteryUpdates.push({ userId, courseId });
    },
    createSubmissionId: () => "generated-submission",
  };

  return {
    submit: createQuizSubmissionService(dependencies),
    attempts,
    masteryUpdates,
  };
}

test("owned quiz submission scores canonical question IDs and updates mastery", async () => {
  const { submit, attempts, masteryUpdates } = harness();
  const result = await submit({
    userId: "owner",
    quizId: "quiz-1",
    submissionId: "submission-1",
    answers: { "question-b": 1, "question-a": 1 },
  });

  assert.equal(result.score, 1);
  assert.equal(result.totalQuestions, 2);
  assert.equal(result.percentage, 50);
  assert.equal(attempts.size, 1);
  assert.equal(result.attempt.answers, '{"question-a":1,"question-b":1}');
  assert.deepEqual(masteryUpdates, [{ userId: "owner", courseId: "course-1" }]);
});

test("repeating the same submission ID and answers is idempotent", async () => {
  const { submit, attempts } = harness();
  const input = {
    userId: "owner",
    quizId: "quiz-1",
    submissionId: "submission-1",
    answers: { "question-a": 1, "question-b": 0 },
  };

  const first = await submit(input);
  const second = await submit(input);

  assert.equal(first.attempt.id, second.attempt.id);
  assert.equal(attempts.size, 1);
});

test("reusing a submission ID for different answers is rejected", async () => {
  const { submit, attempts, masteryUpdates } = harness();
  await submit({
    userId: "owner",
    quizId: "quiz-1",
    submissionId: "submission-1",
    answers: { "question-a": 1, "question-b": 0 },
  });

  await assert.rejects(
    submit({
      userId: "owner",
      quizId: "quiz-1",
      submissionId: "submission-1",
      answers: { "question-a": 0, "question-b": 0 },
    }),
    (error: unknown) => error instanceof AppError && error.statusCode === 409,
  );
  assert.equal(attempts.size, 1);
  assert.equal(masteryUpdates.length, 1);
});

test("quiz lookup is scoped to the authenticated owner", async () => {
  const { submit, attempts, masteryUpdates } = harness();
  await assert.rejects(
    submit({
      userId: "other-user",
      quizId: "quiz-1",
      submissionId: "submission-1",
      answers: { "question-a": 1 },
    }),
    (error: unknown) => error instanceof AppError && error.statusCode === 404,
  );
  assert.equal(attempts.size, 0);
  assert.equal(masteryUpdates.length, 0);
});
