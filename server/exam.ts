import { Router, Response } from "express";
import prisma from "./db";
import { authMiddleware, AuthRequest } from "./auth";
import { checkUsageLimits } from "./middleware";

const router = Router();

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
      const { name, examDate, topicIds } = req.body;

      if (!name || !examDate || !topicIds || !Array.isArray(topicIds)) {
        return res
          .status(400)
          .json({ error: "Name, examDate, and topicIds are required" });
      }

      const daysUntil = Math.ceil(
        (new Date(examDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      );

      const uniqueTopicIds = [...new Set(topicIds as string[])];

      const topics = await prisma.topic.findMany({
        where: {
          id: { in: uniqueTopicIds },
          userId: req.user!.id,
        },
        include: {
          flashcards: true,
          quizzes: true,
        },
      });

      if (topics.length !== uniqueTopicIds.length) {
        return res.status(404).json({ error: "Topic not found" });
      }

      const studyPlan = generateStudyPlan(topics, daysUntil);

      const exam = await prisma.exam.create({
        data: {
          userId: req.user!.id,
          name,
          examDate: new Date(examDate),
          topicIds: JSON.stringify(uniqueTopicIds),
          studyPlan: JSON.stringify(studyPlan),
        },
      });

      res.json({
        exam: {
          ...exam,
          topics,
          daysUntil,
          studyPlan,
        },
      });
    } catch (error) {
      console.error("Create exam error:", error);
      res.status(500).json({ error: "Failed to create exam" });
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
      for (
        let i = 0;
        i < topicsPerDay && topicIndex < topics.length;
        i++
      ) {
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
