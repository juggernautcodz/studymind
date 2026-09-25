import prisma from "./db";
import {
  getExamReadinessFromRepository,
  type ExamReadinessRepository,
  type OwnedExamReadinessRecord,
} from "./exam-readiness-domain";

const repository: ExamReadinessRepository = {
  async findOwnedExam(
    examId,
    userId,
  ): Promise<OwnedExamReadinessRecord | null> {
    const exam = await prisma.exam.findFirst({
      where: {
        id: examId,
        userId,
        course: { userId },
      },
      select: {
        id: true,
        name: true,
        description: true,
        examDate: true,
        course: { select: { id: true, name: true } },
        conceptScopes: {
          where: {
            concept: { userId, course: { userId } },
          },
          orderBy: { createdAt: "asc" },
          select: {
            concept: {
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
              },
            },
          },
        },
      },
    });

    if (!exam?.course) return null;
    return {
      exam: {
        id: exam.id,
        name: exam.name,
        description: exam.description,
        examDate: exam.examDate,
      },
      course: exam.course,
      concepts: exam.conceptScopes.map(({ concept }) => ({
        conceptId: concept.id,
        topicId: concept.topicId,
        name: concept.name,
        mastery: concept.masteries[0] ?? null,
      })),
    };
  },
};

export function getExamReadiness(userId: string, examId: string) {
  return getExamReadinessFromRepository(repository, userId, examId);
}
