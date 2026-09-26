import { randomUUID } from "node:crypto";

import { AppError } from "./lib/errors";

export interface OwnedQuizQuestion {
  id: string;
  correctAnswer: number;
  explanation: string | null;
}

export interface OwnedQuiz {
  id: string;
  topic: { courseId: string };
  questions: OwnedQuizQuestion[];
}

export interface QuizAttemptRecord {
  id: string;
  answers: string;
  score: number;
  totalQuestions: number;
  submissionId: string | null;
}

export interface QuizSubmissionDependencies {
  findOwnedQuiz: (userId: string, quizId: string) => Promise<OwnedQuiz | null>;
  upsertAttempt: (input: {
    userId: string;
    quizId: string;
    submissionId: string;
    score: number;
    totalQuestions: number;
    answers: string;
  }) => Promise<QuizAttemptRecord>;
  updateMastery: (userId: string, courseId: string) => Promise<unknown>;
  createSubmissionId?: () => string;
}

export interface SubmitQuizInput {
  userId: string;
  quizId: string;
  answers: Record<string, number>;
  submissionId?: string;
}

export function createQuizSubmissionService(
  dependencies: QuizSubmissionDependencies,
) {
  return async function submitQuiz(input: SubmitQuizInput) {
    const quiz = await dependencies.findOwnedQuiz(input.userId, input.quizId);
    if (!quiz) throw new AppError(404, "NOT_FOUND", "Quiz not found");

    let score = 0;
    const results = quiz.questions.map((question) => {
      const userAnswer = input.answers[question.id];
      const isCorrect = userAnswer === question.correctAnswer;
      if (isCorrect) score += 1;
      return {
        questionId: question.id,
        userAnswer,
        correctAnswer: question.correctAnswer,
        isCorrect,
        explanation: question.explanation,
      };
    });

    const serializedAnswers = JSON.stringify(
      Object.fromEntries(
        Object.entries(input.answers).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
    );
    const submissionId =
      input.submissionId ?? (dependencies.createSubmissionId ?? randomUUID)();
    const attempt = await dependencies.upsertAttempt({
      userId: input.userId,
      quizId: input.quizId,
      submissionId,
      score,
      totalQuestions: quiz.questions.length,
      answers: serializedAnswers,
    });

    if (attempt.answers !== serializedAnswers) {
      throw new AppError(
        409,
        "SUBMISSION_CONFLICT",
        "submissionId was already used for different answers",
      );
    }

    await dependencies.updateMastery(input.userId, quiz.topic.courseId);

    return {
      attempt,
      score,
      totalQuestions: quiz.questions.length,
      percentage: quiz.questions.length
        ? (score / quiz.questions.length) * 100
        : 0,
      results,
    };
  };
}
