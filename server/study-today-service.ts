import prisma from "./db";
import {
  getStudyTodayFromRepository,
  type StudyTodayRepository,
} from "./study-today-domain";

const repository: StudyTodayRepository = {
  async findOwnedData(userId, now) {
    const courses = await prisma.course.findMany({
      where: { userId },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        concepts: {
          where: {
            userId,
            topic: { userId },
          },
          orderBy: { id: "asc" },
          select: {
            id: true,
            topicId: true,
            name: true,
            masteries: {
              where: { userId },
              take: 1,
              select: {
                score: true,
                confidence: true,
                evidenceCount: true,
                correctCount: true,
                incorrectCount: true,
                lastPracticedAt: true,
                trend: true,
              },
            },
            examScopes: {
              where: {
                exam: {
                  userId,
                  course: { userId },
                },
              },
              select: {
                exam: {
                  select: {
                    id: true,
                    name: true,
                    examDate: true,
                  },
                },
              },
            },
            topic: {
              select: {
                notes: true,
                transcript: true,
                sources: { select: { id: true } },
                quizzes: { select: { id: true } },
                flashcards: {
                  select: {
                    id: true,
                    stats: {
                      where: { userId },
                      select: { nextReview: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    return {
      courses: courses.map((course) => ({
        id: course.id,
        name: course.name,
        concepts: course.concepts.map((concept) => ({
          id: concept.id,
          topicId: concept.topicId,
          name: concept.name,
          mastery: concept.masteries[0] ?? null,
          exams: concept.examScopes.map(({ exam }) => exam),
          capabilities: {
            flashcardCount: concept.topic.flashcards.length,
            dueFlashcardCount: concept.topic.flashcards.filter((flashcard) =>
              flashcard.stats.some(
                (stat) => stat.nextReview !== null && stat.nextReview <= now,
              ),
            ).length,
            quizCount: concept.topic.quizzes.length,
            hasStudyMaterial: Boolean(
              concept.topic.notes?.trim() ||
              concept.topic.transcript?.trim() ||
              concept.topic.sources.length > 0,
            ),
          },
        })),
      })),
    };
  },
};

export function getStudyToday(userId: string, now = new Date()) {
  return getStudyTodayFromRepository(repository, userId, now);
}
