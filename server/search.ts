import { Router, Response } from "express";
import prisma from "./db";
import { guestOrAuthMiddleware, AuthRequest } from "./auth";

const router = Router();

router.get(
  "/search",
  guestOrAuthMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const { q, type } = req.query;
      const query = ((q as string) || "").trim().toLowerCase();

      if (!query || query.length < 2) {
        return res.json({
          flashcards: [],
          topics: [],
          courses: [],
          total: 0,
        });
      }

      const results: {
        flashcards: any[];
        topics: any[];
        courses: any[];
      } = {
        flashcards: [],
        topics: [],
        courses: [],
      };

      const searchTypes = type
        ? [type as string]
        : ["flashcards", "topics", "courses"];

      if (searchTypes.includes("flashcards")) {
        const flashcards = await prisma.flashcard.findMany({
          where: {
            topic: {
              userId: req.user!.id,
            },
            OR: [{ front: { contains: query } }, { back: { contains: query } }],
          },
          include: {
            topic: {
              include: {
                course: true,
              },
            },
          },
          take: 20,
        });

        results.flashcards = flashcards.map((f) => ({
          id: f.id,
          front: f.front,
          back: f.back,
          type: "flashcard",
          topicId: f.topicId,
          topic: f.topic?.name,
          course: f.topic?.course?.name,
        }));
      }

      if (searchTypes.includes("topics")) {
        const topics = await prisma.topic.findMany({
          where: {
            userId: req.user!.id,
            name: { contains: query },
          },
          include: {
            course: true,
            flashcards: {
              select: { id: true },
            },
            quizzes: {
              select: { id: true },
            },
          },
          take: 10,
        });

        results.topics = topics.map((t) => ({
          id: t.id,
          name: t.name,
          type: "topic",
          course: t.course?.name,
          courseId: t.courseId,
          flashcardCount: t.flashcards.length,
          quizCount: t.quizzes.length,
        }));
      }

      if (searchTypes.includes("courses")) {
        const courses = await prisma.course.findMany({
          where: {
            userId: req.user!.id,
            name: { contains: query },
          },
          include: {
            semester: true,
            topics: {
              select: { id: true },
            },
          },
          take: 10,
        });

        results.courses = courses.map((c) => ({
          id: c.id,
          name: c.name,
          type: "course",
          semester: c.semester?.name,
          topicCount: c.topics.length,
        }));
      }

      const total =
        results.flashcards.length +
        results.topics.length +
        results.courses.length;

      res.json({ ...results, total });
    } catch (error) {
      console.error("Search error:", error);
      res.status(500).json({ error: "Search failed" });
    }
  },
);

function getSnippet(
  text: string,
  query: string,
  contextLength: number = 100,
): string {
  const lowerText = text.toLowerCase();
  const index = lowerText.indexOf(query);

  if (index === -1) {
    return (
      text.slice(0, contextLength * 2) +
      (text.length > contextLength * 2 ? "..." : "")
    );
  }

  const start = Math.max(0, index - contextLength);
  const end = Math.min(text.length, index + query.length + contextLength);

  let snippet = text.slice(start, end);

  if (start > 0) snippet = "..." + snippet;
  if (end < text.length) snippet = snippet + "...";

  return snippet;
}

export default router;
