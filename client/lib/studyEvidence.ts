import type { Flashcard, Quiz, QuizQuestion } from "@/types";

export interface StudyTopicEvidence {
  flashcards: Flashcard[];
  quizData: { quiz: Quiz; questions: QuizQuestion[] } | null;
}

export interface FlashcardReviewInput {
  flashcardId: string;
  correct: boolean;
  eventId: string;
}

export interface QuizSubmissionInput {
  quizId: string;
  answers: Record<string, number>;
  submissionId: string;
}

export interface QuizSubmissionResult {
  score: number;
  totalQuestions: number;
  percentage: number;
}

function parseOptions(value: unknown): string[] {
  if (
    Array.isArray(value) &&
    value.every((option) => typeof option === "string")
  ) {
    return value;
  }
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) &&
      parsed.every((option) => typeof option === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

export function normalizeStudyTopicEvidence(raw: any): StudyTopicEvidence {
  const flashcards: Flashcard[] = Array.isArray(raw?.flashcards)
    ? raw.flashcards
        .filter(
          (card: any) =>
            typeof card?.id === "string" &&
            typeof card?.topicId === "string" &&
            typeof card?.question === "string" &&
            typeof card?.answer === "string",
        )
        .map((card: any) => ({
          id: card.id,
          topicId: card.topicId,
          question: card.question,
          answer: card.answer,
          orderIndex: Number.isFinite(card.orderIndex) ? card.orderIndex : 0,
          ...(typeof card.sourceQuote === "string"
            ? { sourceQuote: card.sourceQuote }
            : {}),
        }))
    : [];

  const rawQuiz = Array.isArray(raw?.quizzes)
    ? raw.quizzes.find(
        (quiz: any) =>
          typeof quiz?.id === "string" && Array.isArray(quiz?.questions),
      )
    : null;

  if (!rawQuiz) return { flashcards, quizData: null };

  const questions: QuizQuestion[] = rawQuiz.questions
    .filter(
      (question: any) =>
        typeof question?.id === "string" &&
        typeof question?.question === "string" &&
        Number.isInteger(question?.correctAnswer),
    )
    .map((question: any) => ({
      id: question.id,
      quizId: rawQuiz.id,
      question: question.question,
      options: parseOptions(question.options),
      correctIndex: question.correctAnswer,
      orderIndex: Number.isFinite(question.orderIndex)
        ? question.orderIndex
        : 0,
    }))
    .sort(
      (left: QuizQuestion, right: QuizQuestion) =>
        left.orderIndex - right.orderIndex,
    );

  return {
    flashcards,
    quizData: {
      quiz: {
        id: rawQuiz.id,
        topicId: rawQuiz.topicId,
        createdAt:
          typeof rawQuiz.createdAt === "string"
            ? rawQuiz.createdAt
            : new Date(rawQuiz.createdAt).toISOString(),
      },
      questions,
    },
  };
}

export function quizAnswersByQuestionId(
  questions: QuizQuestion[],
  answers: Array<number | null>,
): Record<string, number> {
  return Object.fromEntries(
    questions.flatMap((question, index) => {
      const answer = answers[index];
      return answer === null || answer === undefined
        ? []
        : [[question.id, answer] as const];
    }),
  );
}

export function studyEvidenceQueryKeys(courseId: string) {
  return [
    ["study-today"],
    ["course-mastery", courseId],
    ["exam-readiness"],
  ] as const;
}

export async function completeDurableFlashcardReview<T>({
  input,
  persist,
  onPersisted,
}: {
  input: FlashcardReviewInput;
  persist: (input: FlashcardReviewInput) => Promise<T>;
  onPersisted: (result: T) => Promise<void> | void;
}): Promise<T> {
  const result = await persist(input);
  await onPersisted(result);
  return result;
}

export async function completeDurableQuizSubmission({
  input,
  persist,
  onPersisted,
}: {
  input: QuizSubmissionInput;
  persist: (input: QuizSubmissionInput) => Promise<QuizSubmissionResult>;
  onPersisted: (result: QuizSubmissionResult) => Promise<void> | void;
}): Promise<QuizSubmissionResult> {
  const result = await persist(input);
  await onPersisted(result);
  return result;
}
