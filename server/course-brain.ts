import { Router, Response } from "express";
import prisma from "./db";
import { authMiddleware, AuthRequest } from "./auth";
import { internalError, notFound } from "./lib/errors";

export interface CourseBrainTopicDto {
  id: string;
  name: string;
  orderIndex: number;
  status: string;
  updatedAt: string;
  counts: {
    recordings: number;
    flashcards: number;
    quizzes: number;
    quizAttempts: number;
  };
}

export interface CourseBrainExamDto {
  id: string;
  name: string;
  examDate: string;
  updatedAt: string;
}

export interface CourseBrainDto {
  course: {
    id: string;
    name: string;
    color: string | null;
    createdAt: string;
    updatedAt: string;
  };
  semester: {
    id: string;
    name: string;
    startDate: string | null;
    endDate: string | null;
  } | null;
  topics: CourseBrainTopicDto[];
  totals: {
    topics: number;
    recordings: number;
    flashcards: number;
    quizzes: number;
    quizAttempts: number;
    mindMapNodes: number;
    sources: number;
  };
  quizPerformance: {
    score: number;
    questions: number;
    accuracyPercent: number | null;
  };
  exams: CourseBrainExamDto[];
  lastActivityAt: string | null;
  futureDomains: {
    sources: { available: true; count: number };
    concepts: { available: false };
    mastery: { available: false };
  };
}

function latestDate(dates: Array<Date | null | undefined>): string | null {
  let latest: Date | null = null;
  for (const date of dates) {
    if (date && (!latest || date.getTime() > latest.getTime())) latest = date;
  }
  return latest?.toISOString() ?? null;
}

function parseExamTopicIds(value: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((id) => typeof id === "string")
      ? [...new Set(parsed)]
      : null;
  } catch {
    return null;
  }
}

export async function getCourseBrain(
  courseId: string,
  userId: string,
): Promise<CourseBrainDto | null> {
  const course = await prisma.course.findFirst({
    where: { id: courseId, userId },
    select: {
      id: true,
      userId: true,
      semesterId: true,
      name: true,
      color: true,
      createdAt: true,
      updatedAt: true,
      topics: {
        where: { userId },
        orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          name: true,
          orderIndex: true,
          status: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!course) return null;

  const topicIds = course.topics.map((topic) => topic.id);
  const [semester, recordings, flashcards, quizzes, mindMapSummary, exams, sourceSummary] =
    await Promise.all([
      prisma.semester.findFirst({
        where: { id: course.semesterId, userId },
        select: { id: true, name: true, startDate: true, endDate: true },
      }),
      topicIds.length
        ? prisma.recording.groupBy({
            by: ["topicId"],
            where: { userId, topicId: { in: topicIds } },
            _count: { _all: true },
            _max: { createdAt: true },
          })
        : Promise.resolve([]),
      topicIds.length
        ? prisma.flashcard.groupBy({
            by: ["topicId"],
            where: { topicId: { in: topicIds } },
            _count: { _all: true },
            _max: { createdAt: true },
          })
        : Promise.resolve([]),
      topicIds.length
        ? prisma.quiz.findMany({
            where: { topicId: { in: topicIds } },
            select: {
              id: true,
              topicId: true,
              createdAt: true,
              attempts: {
                where: { userId },
                select: { score: true, totalQuestions: true, completedAt: true },
              },
            },
          })
        : Promise.resolve([]),
      prisma.mindmapNode.aggregate({
        where: { courseId, userId },
        _count: { _all: true },
        _max: { updatedAt: true },
      }),
      prisma.exam.findMany({
        where: { userId },
        select: { id: true, name: true, examDate: true, updatedAt: true, topicIds: true },
        orderBy: { examDate: "asc" },
      }),
      prisma.source.aggregate({
        where: { courseId, course: { userId } },
        _count: { _all: true },
        _max: { updatedAt: true },
      }),
    ]);

  const recordingsByTopic = new Map(
    recordings.map((row) => [row.topicId, row._count._all]),
  );
  const flashcardsByTopic = new Map(
    flashcards.map((row) => [row.topicId, row._count._all]),
  );
  const quizzesByTopic = new Map<string, number>();
  const quizAttemptsByTopic = new Map<string, number>();
  let score = 0;
  let questions = 0;
  const quizActivity: Date[] = [];

  for (const quiz of quizzes) {
    quizzesByTopic.set(quiz.topicId, (quizzesByTopic.get(quiz.topicId) ?? 0) + 1);
    quizActivity.push(quiz.createdAt);
    for (const attempt of quiz.attempts) {
      quizAttemptsByTopic.set(
        quiz.topicId,
        (quizAttemptsByTopic.get(quiz.topicId) ?? 0) + 1,
      );
      score += attempt.score;
      questions += attempt.totalQuestions;
      quizActivity.push(attempt.completedAt);
    }
  }

  const topicDtos = course.topics.map((topic): CourseBrainTopicDto => ({
    id: topic.id,
    name: topic.name,
    orderIndex: topic.orderIndex,
    status: topic.status,
    updatedAt: topic.updatedAt.toISOString(),
    counts: {
      recordings: recordingsByTopic.get(topic.id) ?? 0,
      flashcards: flashcardsByTopic.get(topic.id) ?? 0,
      quizzes: quizzesByTopic.get(topic.id) ?? 0,
      quizAttempts: quizAttemptsByTopic.get(topic.id) ?? 0,
    },
  }));

  const ownedTopicIds = new Set(topicIds);
  const courseExams = exams
    .filter((exam) => {
      const examTopicIds = parseExamTopicIds(exam.topicIds);
      return (
        examTopicIds !== null &&
        examTopicIds.length > 0 &&
        examTopicIds.every((topicId) => ownedTopicIds.has(topicId))
      );
    })
    .map(({ id, name, examDate, updatedAt }) => ({
      id,
      name,
      examDate: examDate.toISOString(),
      updatedAt: updatedAt.toISOString(),
    }));

  const lastActivityAt = latestDate([
    course.updatedAt,
    ...course.topics.map((topic) => topic.updatedAt),
    ...recordings.map((row) => row._max.createdAt),
    ...flashcards.map((row) => row._max.createdAt),
    ...quizActivity,
    mindMapSummary._max.updatedAt,
    sourceSummary._max.updatedAt,
    ...courseExams.map((exam) => new Date(exam.updatedAt)),
  ]);

  const totalQuizAttempts = [...quizAttemptsByTopic.values()].reduce(
    (total, count) => total + count,
    0,
  );

  return {
    course: {
      id: course.id,
      name: course.name,
      color: course.color,
      createdAt: course.createdAt.toISOString(),
      updatedAt: course.updatedAt.toISOString(),
    },
    semester: semester
      ? {
          id: semester.id,
          name: semester.name,
          startDate: semester.startDate?.toISOString() ?? null,
          endDate: semester.endDate?.toISOString() ?? null,
        }
      : null,
    topics: topicDtos,
    totals: {
      topics: topicDtos.length,
      recordings: topicDtos.reduce((total, topic) => total + topic.counts.recordings, 0),
      flashcards: topicDtos.reduce((total, topic) => total + topic.counts.flashcards, 0),
      quizzes: topicDtos.reduce((total, topic) => total + topic.counts.quizzes, 0),
      quizAttempts: totalQuizAttempts,
      mindMapNodes: mindMapSummary._count._all,
      sources: sourceSummary._count._all,
    },
    quizPerformance: {
      score,
      questions,
      accuracyPercent: questions > 0 ? Math.round((score / questions) * 100) : null,
    },
    exams: courseExams,
    lastActivityAt,
    futureDomains: {
      sources: { available: true, count: sourceSummary._count._all },
      concepts: { available: false },
      mastery: { available: false },
    },
  };
}

const router = Router();

router.get(
  "/:courseId/brain",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const courseId = req.params.courseId as string;
      const brain = await getCourseBrain(courseId, req.user!.id);
      if (!brain) return notFound(res, "Course not found");
      return res.json({ brain });
    } catch (error) {
      console.error("Get course brain error:", error);
      return internalError(res, "Failed to get course brain");
    }
  },
);

export default router;
