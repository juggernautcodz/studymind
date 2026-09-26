import type {
  Flashcard,
  Notes,
  NotesSection,
  Quiz,
  QuizQuestion,
  Topic,
} from "@/types";

export interface StudyTopicEvidence {
  topic: Topic;
  notes: Notes | null;
  flashcards: Flashcard[];
  quizData: { quiz: Quiz; questions: QuizQuestion[] } | null;
}

export interface StudyTopicCachedContent {
  topic: Topic | null;
  notes: Notes | null;
  flashcards: Flashcard[];
  quizData: { quiz: Quiz; questions: QuizQuestion[] } | null;
}

export interface StudyTopicCacheSnapshot {
  topics: Topic[];
  notes: Notes[];
  flashcards: Flashcard[];
  quizzes: Quiz[];
  questions: QuizQuestion[];
}

export type StudyTopicDestination = "notes" | "flashcards" | "quiz";
export type StudyTopicHydrationSource = "SERVER" | "CACHE";

export class StudyTopicHydrationError extends Error {
  constructor(
    public readonly kind: "UNAUTHORIZED" | "NOT_FOUND" | "UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "StudyTopicHydrationError";
  }
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

function contentLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function markdownSections(markdown: string): NotesSection[] {
  const sections: NotesSection[] = [];
  let current: NotesSection = { heading: "Overview", bullets: [] };

  const pushCurrent = () => {
    if (current.bullets.length > 0) sections.push(current);
  };

  for (const line of contentLines(markdown)) {
    const heading = line.match(/^#{1,6}\s+(.+)$/)?.[1]?.trim();
    if (heading) {
      pushCurrent();
      current = { heading, bullets: [] };
      continue;
    }
    const bullet = line.replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, "").trim();
    if (bullet) current.bullets.push(bullet);
  }
  pushCurrent();
  return sections;
}

function sourceSections(rawSources: any[]): NotesSection[] {
  return rawSources.flatMap((source: any) => {
    const segments = Array.isArray(source?.revisions?.[0]?.segments)
      ? source.revisions[0].segments
          .map((segment: any) => segment?.content)
          .filter((content: unknown): content is string =>
            Boolean(typeof content === "string" && content.trim()),
          )
      : [];
    return segments.length
      ? [
          {
            heading:
              typeof source?.title === "string" ? source.title : "Source",
            bullets: segments,
          },
        ]
      : [];
  });
}

function normalizeNotes(raw: any): Notes | null {
  const notesText = typeof raw?.notes === "string" ? raw.notes.trim() : "";
  const transcript =
    typeof raw?.transcript === "string" ? raw.transcript.trim() : "";
  const sections = notesText
    ? markdownSections(notesText)
    : transcript
      ? [{ heading: "Transcript", bullets: contentLines(transcript) }]
      : sourceSections(Array.isArray(raw?.sources) ? raw.sources : []);

  if (sections.length === 0) return null;
  const createdAt = new Date(raw.createdAt).toISOString();
  const updatedAt = new Date(raw.updatedAt ?? raw.createdAt).toISOString();
  return {
    id: `server-topic-notes:${raw.id}`,
    topicId: raw.id,
    title: typeof raw.name === "string" ? raw.name : "Topic Notes",
    sections,
    createdAt,
    updatedAt,
  };
}

function normalizeTopic(raw: any): Topic {
  return {
    id: raw.id,
    serverId: raw.id,
    userId: raw.userId,
    courseId: raw.courseId,
    name: raw.name,
    orderIndex: Number.isFinite(raw.orderIndex) ? raw.orderIndex : 0,
    status:
      raw.status === "transcribing" || raw.status === "completed"
        ? raw.status
        : "pending",
    createdAt: new Date(raw.createdAt).toISOString(),
  };
}

export function normalizeStudyTopicEvidence(raw: any): StudyTopicEvidence {
  const flashcards: Flashcard[] = Array.isArray(raw?.flashcards)
    ? raw.flashcards
        .filter(
          (card: any) =>
            typeof card?.id === "string" &&
            typeof card?.topicId === "string" &&
            (typeof card?.question === "string" ||
              typeof card?.front === "string") &&
            (typeof card?.answer === "string" ||
              typeof card?.back === "string"),
        )
        .map((card: any) => ({
          id: card.id,
          topicId: card.topicId,
          question: card.question ?? card.front,
          answer: card.answer ?? card.back,
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

  const topic = normalizeTopic(raw);
  const notes = normalizeNotes(raw);

  if (!rawQuiz) return { topic, notes, flashcards, quizData: null };

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
    topic,
    notes,
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

export function destinationHasContent(
  content: StudyTopicCachedContent | StudyTopicEvidence,
  destination: StudyTopicDestination,
): boolean {
  if (destination === "notes") return content.notes !== null;
  if (destination === "flashcards") return content.flashcards.length > 0;
  return Boolean(content.quizData?.questions.length);
}

export function classifyHydrationError(
  error: unknown,
): StudyTopicHydrationError {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("401:") || message === "Authentication required") {
    return new StudyTopicHydrationError("UNAUTHORIZED", message);
  }
  if (message.startsWith("404:")) {
    return new StudyTopicHydrationError("NOT_FOUND", message);
  }
  return new StudyTopicHydrationError("UNAVAILABLE", message);
}

export async function hydrateStudyTopic({
  destination,
  cached,
  fetchServer,
  cacheServer,
}: {
  destination: StudyTopicDestination;
  cached: StudyTopicCachedContent;
  fetchServer: () => Promise<StudyTopicEvidence>;
  cacheServer: (content: StudyTopicEvidence) => Promise<void>;
}): Promise<{
  content: StudyTopicCachedContent;
  source: StudyTopicHydrationSource;
  warning: StudyTopicHydrationError | null;
}> {
  try {
    const content = await fetchServer();
    try {
      await cacheServer(content);
      return { content, source: "SERVER", warning: null };
    } catch (cacheError) {
      return {
        content,
        source: "SERVER",
        warning: classifyHydrationError(cacheError),
      };
    }
  } catch (error) {
    const hydrationError = classifyHydrationError(error);
    if (
      hydrationError.kind === "UNAVAILABLE" &&
      destinationHasContent(cached, destination)
    ) {
      return { content: cached, source: "CACHE", warning: hydrationError };
    }
    throw hydrationError;
  }
}

export function mergeHydratedTopicCache(
  cache: StudyTopicCacheSnapshot,
  hydration: StudyTopicEvidence,
): StudyTopicCacheSnapshot {
  const topicId = hydration.topic.id;
  const hasCachedCards = cache.flashcards.some(
    (card) => card.topicId === topicId,
  );
  const hasCachedQuiz = cache.quizzes.some((quiz) => quiz.topicId === topicId);
  const hydratedQuiz = hydration.quizData?.quiz ?? null;

  return {
    topics: cache.topics.some((topic) => topic.id === topicId)
      ? cache.topics
      : [...cache.topics, hydration.topic],
    notes:
      !hydration.notes || cache.notes.some((note) => note.topicId === topicId)
        ? cache.notes
        : [...cache.notes, hydration.notes],
    flashcards:
      hasCachedCards || hydration.flashcards.length === 0
        ? cache.flashcards
        : [...cache.flashcards, ...hydration.flashcards],
    quizzes:
      hasCachedQuiz || !hydratedQuiz
        ? cache.quizzes
        : [...cache.quizzes, hydratedQuiz],
    questions:
      hasCachedQuiz || !hydration.quizData
        ? cache.questions
        : [...cache.questions, ...hydration.quizData.questions],
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
