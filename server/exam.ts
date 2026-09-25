import { Router, Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "./db";
import { authMiddleware, AuthRequest } from "./auth";
import { checkUsageLimits } from "./middleware";
import { getExamReadiness } from "./exam-readiness-service";
import { uniqueIds } from "./exam-readiness-domain";
import { AppError, internalError } from "./lib/errors";

const router = Router();

type Transaction = Prisma.TransactionClient;

function routeError(res: Response, error: unknown, message: string) {
  if (error instanceof AppError) {
    return res.status(error.statusCode).json(error.toJSON());
  }
  console.error(`${message}:`, error);
  return internalError(res, message);
}

function stringIds(value: unknown, fieldName: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((id) => typeof id !== "string" || !id)
  ) {
    throw new AppError(
      400,
      "BAD_REQUEST",
      `${fieldName} must be an array of IDs`,
    );
  }
  return uniqueIds(value as string[]);
}

async function resolveExamScope(
  tx: Transaction,
  userId: string,
  requestedCourseId: unknown,
  topicIdsInput: unknown,
  conceptIdsInput: unknown,
) {
  const topicIds = stringIds(topicIdsInput, "topicIds");
  const requestedConceptIds =
    conceptIdsInput === undefined
      ? []
      : stringIds(conceptIdsInput, "conceptIds");
  if (
    typeof requestedCourseId !== "string" &&
    requestedCourseId !== undefined
  ) {
    throw new AppError(400, "BAD_REQUEST", "courseId must be an ID");
  }

  const [topics, requestedConcepts] = await Promise.all([
    topicIds.length
      ? tx.topic.findMany({
          where: { id: { in: topicIds }, userId, course: { userId } },
          select: { id: true, name: true, courseId: true },
        })
      : Promise.resolve([]),
    requestedConceptIds.length
      ? tx.concept.findMany({
          where: {
            id: { in: requestedConceptIds },
            userId,
            course: { userId },
          },
          select: { id: true, courseId: true, topicId: true },
        })
      : Promise.resolve([]),
  ]);

  if (topics.length !== topicIds.length) {
    throw new AppError(404, "NOT_FOUND", "Topic not found");
  }
  if (requestedConcepts.length !== requestedConceptIds.length) {
    throw new AppError(404, "NOT_FOUND", "Concept not found");
  }

  const referencedCourseIds = new Set([
    ...topics.map((topic) => topic.courseId),
    ...requestedConcepts.map((concept) => concept.courseId),
  ]);
  const courseId =
    typeof requestedCourseId === "string" && requestedCourseId
      ? requestedCourseId
      : referencedCourseIds.size === 1
        ? [...referencedCourseIds][0]
        : undefined;
  if (!courseId) {
    throw new AppError(400, "BAD_REQUEST", "courseId is required");
  }

  const course = await tx.course.findFirst({
    where: { id: courseId, userId },
    select: { id: true },
  });
  if (!course) throw new AppError(404, "NOT_FOUND", "Course not found");
  if ([...referencedCourseIds].some((id) => id !== courseId)) {
    throw new AppError(
      400,
      "BAD_REQUEST",
      "All exam concepts and topics must belong to the exam course",
    );
  }

  const topicConcepts: Array<{ id: string }> = [];
  for (const topic of topics) {
    topicConcepts.push(
      await tx.concept.upsert({
        where: { courseId_topicId: { courseId, topicId: topic.id } },
        create: { userId, courseId, topicId: topic.id, name: topic.name },
        update: { name: topic.name },
        select: { id: true },
      }),
    );
  }

  return {
    courseId,
    topicIds: uniqueIds([
      ...topicIds,
      ...requestedConcepts.map((concept) => concept.topicId),
    ]),
    topics,
    conceptIds: uniqueIds([
      ...requestedConceptIds,
      ...topicConcepts.map((concept) => concept.id),
    ]),
  };
}

router.get(
  "/",
  authMiddleware,
  checkUsageLimits("exam"),
  async (req: AuthRequest, res: Response) => {
    try {
      const exams = await prisma.exam.findMany({
        where: { userId: req.user!.id },
        orderBy: { examDate: "asc" },
      });

      const examDetails = await Promise.all(
        exams.map(async (exam) => {
          const topicIds = [...new Set(JSON.parse(exam.topicIds) as string[])];
          const topics = await prisma.topic.findMany({
            where: {
              id: { in: topicIds },
              userId: req.user!.id,
              course: { userId: req.user!.id },
            },
            include: { course: true },
          });

          if (topics.length !== topicIds.length) {
            return null;
          }

          const daysUntil = Math.ceil(
            (exam.examDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
          );

          return {
            ...exam,
            topics,
            daysUntil,
            studyPlan: exam.studyPlan ? JSON.parse(exam.studyPlan) : null,
          };
        }),
      );

      const examsWithDetails = examDetails.filter((exam) => exam !== null);

      res.json({ exams: examsWithDetails });
    } catch (error) {
      console.error("Get exams error:", error);
      res.status(500).json({ error: "Failed to get exams" });
    }
  },
);

router.post(
  "/",
  authMiddleware,
  checkUsageLimits("exam"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { name, description, examDate, courseId, topicIds, conceptIds } =
        req.body;

      if (
        typeof name !== "string" ||
        !name.trim() ||
        !examDate ||
        !Array.isArray(topicIds)
      ) {
        return res
          .status(400)
          .json({ error: "Name, examDate, and topicIds are required" });
      }
      if (description !== undefined && typeof description !== "string") {
        return res.status(400).json({ error: "Description must be a string" });
      }

      const parsedExamDate = new Date(examDate);
      if (Number.isNaN(parsedExamDate.getTime())) {
        return res.status(400).json({ error: "examDate must be a valid date" });
      }

      const daysUntil = Math.ceil(
        (parsedExamDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      );

      const result = await prisma.$transaction(async (tx) => {
        const scope = await resolveExamScope(
          tx,
          req.user!.id,
          courseId,
          topicIds,
          conceptIds,
        );
        const topics = scope.topicIds.length
          ? await tx.topic.findMany({
              where: {
                id: { in: scope.topicIds },
                userId: req.user!.id,
                courseId: scope.courseId,
              },
              include: { flashcards: true, quizzes: true },
            })
          : [];
        const studyPlan = generateStudyPlan(topics, daysUntil);
        const exam = await tx.exam.create({
          data: {
            userId: req.user!.id,
            courseId: scope.courseId,
            name: name.trim(),
            description: description?.trim() || null,
            examDate: parsedExamDate,
            topicIds: JSON.stringify(scope.topicIds),
            studyPlan: JSON.stringify(studyPlan),
            conceptScopes: {
              create: scope.conceptIds.map((scopedConceptId) => ({
                conceptId: scopedConceptId,
              })),
            },
          },
        });
        return { exam, topics, studyPlan, conceptIds: scope.conceptIds };
      });

      res.json({
        exam: {
          ...result.exam,
          topics: result.topics,
          daysUntil,
          studyPlan: result.studyPlan,
          conceptIds: result.conceptIds,
        },
      });
    } catch (error) {
      return routeError(res, error, "Failed to create exam");
    }
  },
);

router.get(
  "/:id",
  authMiddleware,
  checkUsageLimits("exam"),
  async (req: AuthRequest, res: Response) => {
    try {
      const id = req.params.id as string;

      const exam = await prisma.exam.findFirst({
        where: { id, userId: req.user!.id },
      });

      if (!exam) {
        return res.status(404).json({ error: "Exam not found" });
      }

      const topicIds = [...new Set(JSON.parse(exam.topicIds) as string[])];
      const topics = await prisma.topic.findMany({
        where: {
          id: { in: topicIds },
          userId: req.user!.id,
          course: { userId: req.user!.id },
        },
        include: {
          course: true,
          flashcards: true,
          quizzes: {
            include: { questions: true },
          },
        },
      });

      if (topics.length !== topicIds.length) {
        return res.status(404).json({ error: "Exam not found" });
      }

      const daysUntil = Math.ceil(
        (exam.examDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      );

      res.json({
        exam: {
          ...exam,
          topics,
          daysUntil,
          studyPlan: exam.studyPlan ? JSON.parse(exam.studyPlan) : null,
        },
      });
    } catch (error) {
      console.error("Get exam error:", error);
      res.status(500).json({ error: "Failed to get exam" });
    }
  },
);

router.put(
  "/:id/concepts",
  authMiddleware,
  checkUsageLimits("exam"),
  async (req: AuthRequest, res: Response) => {
    try {
      const id = req.params.id as string;
      const conceptIds = stringIds(req.body?.conceptIds, "conceptIds");
      const scope = await prisma.$transaction(async (tx) => {
        const exam = await tx.exam.findFirst({
          where: { id, userId: req.user!.id },
          select: { id: true, courseId: true },
        });
        if (!exam) throw new AppError(404, "NOT_FOUND", "Exam not found");

        const resolved = await resolveExamScope(
          tx,
          req.user!.id,
          exam.courseId ?? undefined,
          [],
          conceptIds,
        );
        const concepts = resolved.conceptIds.length
          ? await tx.concept.findMany({
              where: {
                id: { in: resolved.conceptIds },
                userId: req.user!.id,
                courseId: resolved.courseId,
              },
              select: { id: true, topicId: true, name: true },
              orderBy: { createdAt: "asc" },
            })
          : [];

        await tx.examConcept.deleteMany({ where: { examId: id } });
        if (concepts.length) {
          await tx.examConcept.createMany({
            data: concepts.map((concept) => ({
              examId: id,
              conceptId: concept.id,
            })),
            skipDuplicates: true,
          });
        }
        await tx.exam.update({
          where: { id },
          data: {
            courseId: resolved.courseId,
            topicIds: JSON.stringify(
              uniqueIds(concepts.map((concept) => concept.topicId)),
            ),
          },
        });
        return concepts;
      });

      return res.json({ examId: id, concepts: scope });
    } catch (error) {
      return routeError(res, error, "Failed to update exam concept scope");
    }
  },
);

router.get(
  "/:id/readiness",
  authMiddleware,
  checkUsageLimits("exam"),
  async (req: AuthRequest, res: Response) => {
    try {
      const readiness = await getExamReadiness(
        req.user!.id,
        req.params.id as string,
      );
      return res.json({ readiness });
    } catch (error) {
      return routeError(res, error, "Failed to get exam readiness");
    }
  },
);

router.delete(
  "/:id",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const id = req.params.id as string;
      await prisma.exam.delete({
        where: { id, userId: req.user!.id },
      });
      res.json({ success: true });
    } catch (error) {
      console.error("Delete exam error:", error);
      res.status(500).json({ error: "Failed to delete exam" });
    }
  },
);

router.get(
  "/:id/mock-quiz",
  authMiddleware,
  checkUsageLimits("exam"),
  async (req: AuthRequest, res: Response) => {
    try {
      const id = req.params.id as string;

      const exam = await prisma.exam.findFirst({
        where: { id, userId: req.user!.id },
      });

      if (!exam) {
        return res.status(404).json({ error: "Exam not found" });
      }

      const topicIds = [...new Set(JSON.parse(exam.topicIds) as string[])];

      const topics = await prisma.topic.findMany({
        where: {
          id: { in: topicIds },
          userId: req.user!.id,
        },
        select: { id: true },
      });

      if (topics.length !== topicIds.length) {
        return res.status(404).json({ error: "Exam not found" });
      }

      const questions = await prisma.quizQuestion.findMany({
        where: {
          quiz: {
            topic: {
              id: { in: topicIds },
              userId: req.user!.id,
            },
          },
        },
        include: {
          quiz: {
            include: {
              topic: true,
            },
          },
        },
      });

      const shuffled = questions.sort(() => Math.random() - 0.5).slice(0, 20);

      res.json({
        mockQuiz: {
          examId: id,
          examName: exam.name,
          questions: shuffled.map((q) => ({
            id: q.id,
            question: q.question,
            options: JSON.parse(q.options),
            topicName: q.quiz.topic.name,
          })),
          totalQuestions: shuffled.length,
        },
      });
    } catch (error) {
      console.error("Get mock quiz error:", error);
      res.status(500).json({ error: "Failed to generate mock quiz" });
    }
  },
);

function generateStudyPlan(topics: any[], daysUntil: number): any[] {
  const plan: any[] = [];
  const totalTopics = topics.length;

  if (daysUntil <= 0 || totalTopics === 0) {
    return plan;
  }

  const topicsPerDay = Math.ceil(totalTopics / Math.max(1, daysUntil - 1));

  let topicIndex = 0;

  for (let day = 1; day <= Math.min(daysUntil, 14); day++) {
    const dayPlan: any = {
      day,
      date: new Date(Date.now() + day * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0],
      tasks: [],
    };

    if (day === daysUntil) {
      dayPlan.tasks.push({
        type: "review",
        description: "Final review - go through all weak areas",
        priority: "high",
      });
      dayPlan.tasks.push({
        type: "mock-quiz",
        description: "Take a mock quiz to test your knowledge",
        priority: "high",
      });
    } else {
      for (let i = 0; i < topicsPerDay && topicIndex < topics.length; i++) {
        const topic = topics[topicIndex];
        dayPlan.tasks.push({
          type: "study",
          topicId: topic.id,
          topicName: topic.name,
          description: `Study: ${topic.name}`,
          hasFlashcards: topic.flashcards?.length > 0,
          hasQuiz: topic.quizzes?.length > 0,
          priority: "medium",
        });
        topicIndex++;
      }

      if (day % 3 === 0) {
        dayPlan.tasks.push({
          type: "review",
          description: "Review flashcards from previous days",
          priority: "medium",
        });
      }
    }

    plan.push(dayPlan);
  }

  return plan;
}

export default router;
