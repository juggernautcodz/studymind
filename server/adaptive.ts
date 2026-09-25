import { Router, Response } from "express";
import { randomUUID } from "node:crypto";
import prisma from "./db";
import { authMiddleware, AuthRequest } from "./auth";
import { recordFlashcardReview } from "./mastery-service";

const router = Router();

router.post(
  "/flashcards/:id/answer",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const id = req.params.id as string;
      const { correct, eventId } = req.body;

      const flashcard = await prisma.flashcard.findFirst({
        where: {
          id,
          topic: { userId: req.user!.id },
        },
        select: { id: true },
      });

      if (!flashcard) {
        return res.status(404).json({ error: "Flashcard not found" });
      }

      if (typeof correct !== "boolean") return res.status(400).json({ error: "correct must be a boolean" });
      const result = await recordFlashcardReview(req.user!.id, id, correct, typeof eventId === "string" && eventId.length > 0 ? eventId : randomUUID());
      res.json({ stat: result.stat, duplicate: result.duplicate });
    } catch (error) {
      console.error("Answer flashcard error:", error);
      res.status(500).json({ error: "Failed to record answer" });
    }
  },
);

router.get(
  "/study-today",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const now = new Date();

      const dueFlashcards = await prisma.flashcardStat.findMany({
        where: {
          userId: req.user!.id,
          nextReview: { lte: now },
          flashcard: {
            topic: { userId: req.user!.id },
          },
        },
        include: {
          flashcard: {
            include: {
              topic: true,
            },
          },
        },
        orderBy: { nextReview: "asc" },
        take: 20,
      });

      const weakFlashcards = await prisma.flashcardStat.findMany({
        where: {
          userId: req.user!.id,
          timesWrong: { gt: 0 },
          flashcard: {
            topic: { userId: req.user!.id },
          },
        },
        include: {
          flashcard: {
            include: {
              topic: true,
            },
          },
        },
        orderBy: { timesWrong: "desc" },
        take: 10,
      });

      const quizAttempts = await prisma.quizAttempt.findMany({
        where: { userId: req.user!.id },
        include: {
          quiz: {
            include: {
              topic: true,
            },
          },
        },
        orderBy: { completedAt: "desc" },
      });

      const topicScores: Record<
        string,
        { correct: number; total: number; topic: any }
      > = {};

      for (const attempt of quizAttempts) {
        const topicId = attempt.quiz.topicId;
        if (!topicScores[topicId]) {
          topicScores[topicId] = {
            correct: 0,
            total: 0,
            topic: attempt.quiz.topic,
          };
        }
        topicScores[topicId].correct += attempt.score;
        topicScores[topicId].total += attempt.totalQuestions;
      }

      const weakTopics = Object.entries(topicScores)
        .map(([topicId, data]) => ({
          topicId,
          topic: data.topic,
          accuracy: data.total > 0 ? (data.correct / data.total) * 100 : 0,
          totalQuestions: data.total,
        }))
        .filter((t) => t.accuracy < 70)
        .sort((a, b) => a.accuracy - b.accuracy)
        .slice(0, 5);

      res.json({
        dueFlashcards: dueFlashcards.map((s) => ({
          ...s.flashcard,
          stat: {
            timesCorrect: s.timesCorrect,
            timesWrong: s.timesWrong,
            nextReview: s.nextReview,
          },
        })),
        weakFlashcards: weakFlashcards.map((s) => ({
          ...s.flashcard,
          stat: {
            timesCorrect: s.timesCorrect,
            timesWrong: s.timesWrong,
            successRate:
              s.timesCorrect + s.timesWrong > 0
                ? (s.timesCorrect / (s.timesCorrect + s.timesWrong)) * 100
                : 0,
          },
        })),
        weakTopics,
        studyStats: {
          totalFlashcardsDue: dueFlashcards.length,
          totalWeakCards: weakFlashcards.length,
          totalWeakTopics: weakTopics.length,
        },
      });
    } catch (error) {
      console.error("Get study today error:", error);
      res.status(500).json({ error: "Failed to get study recommendations" });
    }
  },
);

router.get(
  "/stats",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const flashcardStats = await prisma.flashcardStat.findMany({
        where: { userId: req.user!.id },
      });

      const quizAttempts = await prisma.quizAttempt.findMany({
        where: { userId: req.user!.id },
        orderBy: { completedAt: "desc" },
      });

      const totalFlashcardsStudied = flashcardStats.length;
      const totalCorrect = flashcardStats.reduce(
        (sum, s) => sum + s.timesCorrect,
        0,
      );
      const totalWrong = flashcardStats.reduce(
        (sum, s) => sum + s.timesWrong,
        0,
      );
      const flashcardAccuracy =
        totalCorrect + totalWrong > 0
          ? (totalCorrect / (totalCorrect + totalWrong)) * 100
          : 0;

      const totalQuizzesTaken = quizAttempts.length;
      const totalQuizScore = quizAttempts.reduce((sum, a) => sum + a.score, 0);
      const totalQuizQuestions = quizAttempts.reduce(
        (sum, a) => sum + a.totalQuestions,
        0,
      );
      const quizAccuracy =
        totalQuizQuestions > 0
          ? (totalQuizScore / totalQuizQuestions) * 100
          : 0;

      const last7Days = new Date();
      last7Days.setDate(last7Days.getDate() - 7);

      const recentActivity = await prisma.flashcardStat.count({
        where: {
          userId: req.user!.id,
          lastReviewed: { gte: last7Days },
        },
      });

      res.json({
        flashcards: {
          total: totalFlashcardsStudied,
          correct: totalCorrect,
          wrong: totalWrong,
          accuracy: flashcardAccuracy,
        },
        quizzes: {
          total: totalQuizzesTaken,
          averageScore: quizAccuracy,
          recentAttempts: quizAttempts.slice(0, 5),
        },
        activity: {
          last7Days: recentActivity,
        },
      });
    } catch (error) {
      console.error("Get stats error:", error);
      res.status(500).json({ error: "Failed to get stats" });
    }
  },
);

export default router;
