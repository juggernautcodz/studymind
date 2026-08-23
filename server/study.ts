import { Router, Response } from "express";
import prisma from "./db";
import { guestOrAuthMiddleware, AuthRequest } from "./auth";
import { ANONYMOUS_USER_ID } from "./constants";

const router = Router();

/* ------------------------------------------------ */
/* SAFETY HELPER                                    */
/* ------------------------------------------------ */

function getUserId(req: AuthRequest) {
  return req.user?.id || ANONYMOUS_USER_ID;
}

/* ------------------------------------------------ */
/* ANONYMOUS USER SEED                              */
/* ------------------------------------------------ */

export async function ensureAnonymousUserExists() {
  try {
    let existingUser = await prisma.user.findUnique({
      where: { id: ANONYMOUS_USER_ID },
    });

    if (!existingUser) {
      await prisma.user.create({
        data: {
          id: ANONYMOUS_USER_ID,
          email: "guest@studymind.local",
          passwordHash: "guest-no-login",
          name: "Guest User",
        },
      });

      const semester = await prisma.semester.create({
        data: {
          userId: ANONYMOUS_USER_ID,
          name: "My Semester",
        },
      });

      const course = await prisma.course.create({
        data: {
          userId: ANONYMOUS_USER_ID,
          semesterId: semester.id,
          name: "My Course",
        },
      });

      const topic = await prisma.topic.create({
        data: {
          userId: ANONYMOUS_USER_ID,
          courseId: course.id,
          name: "Introduction to Photosynthesis",
          orderIndex: 0,
          transcript:
            "Today we'll explore photosynthesis, the process by which plants convert sunlight into energy.",
          notes: "# Photosynthesis Overview",
          status: "completed",
        },
      });

      await prisma.flashcard.createMany({
        data: [
          {
            topicId: topic.id,
            front: "What is photosynthesis?",
            back: "Plants converting sunlight into energy.",
            orderIndex: 0,
          },
        ],
      });

      console.log("Created anonymous guest demo content");
    }
  } catch (error) {
    console.error("Failed to create anonymous user:", error);
  }
}

/* ------------------------------------------------ */
/* DEMO DATA ROUTES                                 */
/* ------------------------------------------------ */

router.get("/guest/demo-data", async (_req, res: Response) => {
  try {
    const topic = await prisma.topic.findFirst({
      where: { userId: ANONYMOUS_USER_ID },
      include: {
        course: {
          include: { semester: true },
        },
      },
    });

    if (!topic) {
      return res.status(404).json({ error: "Demo data not found" });
    }

    res.json({
      topicId: topic.id,
      topicName: topic.name,
      courseId: topic.course.id,
      courseName: topic.course.name,
      semesterId: topic.course.semester.id,
      semesterName: topic.course.semester.name,
    });
  } catch (error) {
    console.error("Get guest demo data error:", error);
    res.status(500).json({ error: "Failed to get demo data" });
  }
});

/* ------------------------------------------------ */
/* SEMESTERS                                        */
/* ------------------------------------------------ */

router.get(
  "/semesters",
  guestOrAuthMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const semesters = await prisma.semester.findMany({
        where: { userId: getUserId(req) },
        include: {
          courses: {
            include: {
              topics: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      res.json({ semesters });
    } catch (error) {
      console.error("Get semesters error:", error);
      res.status(500).json({ error: "Failed to get semesters", details: String(error) });
    }
  },
);

router.post(
  "/semesters",
  guestOrAuthMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id, name, startDate, endDate } = req.body || {};

      if (!name) {
        return res.status(400).json({ error: "Name is required" });
      }

      const userId = req.user?.id || ANONYMOUS_USER_ID;

      if (id) {
        const existing = await prisma.semester.findFirst({
          where: { id, userId },
        });

        if (existing) {
          if (existing.name !== name) {
            const updated = await prisma.semester.update({
              where: { id: existing.id },
              data: { name },
            });
            return res.json({ semester: updated });
          }
          return res.json({ semester: existing });
        }
      }

      const semester = await prisma.semester.create({
        data: {
          ...(id ? { id } : {}),
          userId,
          name,
          startDate: startDate ? new Date(startDate) : null,
          endDate: endDate ? new Date(endDate) : null,
        },
      });

      console.log("[Semester created]", semester.id);

      res.json({ semester });
    } catch (error) {
      console.error("Create semester error:", error);
      res.status(500).json({
        error: "Failed to create semester",
        details: String(error),
      });
    }
  },
);

/* ------------------------------------------------ */
/* COURSES                                          */
/* ------------------------------------------------ */

router.get(
  "/courses",
  guestOrAuthMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const { semesterId } = req.query;

      const courses = await prisma.course.findMany({
        where: {
          userId: getUserId(req),
          ...(semesterId && { semesterId: semesterId as string }),
        },
        include: {
          topics: true,
        },
      });

      res.json({ courses });
    } catch (error) {
      console.error("Get courses error:", error);
      res.status(500).json({ error: "Failed to get courses", details: String(error) });
    }
  },
);

router.post(
  "/courses",
  guestOrAuthMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id, name, semesterId, color } = req.body || {};

      if (!name || !semesterId) {
        return res
          .status(400)
          .json({ error: "Name and semesterId are required" });
      }

      const userId = req.user?.id || ANONYMOUS_USER_ID;

      if (id) {
        const existing = await prisma.course.findFirst({ where: { id, userId } });
        if (existing) {
          if (existing.name !== name) {
            const updated = await prisma.course.update({
              where: { id: existing.id },
              data: { name },
            });
            return res.json({ course: updated });
          }
          return res.json({ course: existing });
        }
      }

      const course = await prisma.course.create({
        data: {
          ...(id ? { id } : {}),
          userId,
          semesterId,
          name,
          color: color || null,
        },
      });

      console.log("[Course created]", course.id);

      res.json({ course });
    } catch (error) {
      console.error("Create course error:", error);
      res.status(500).json({ error: "Failed to create course", details: String(error) });
    }
  },
);

/* ------------------------------------------------ */
/* TOPICS                                           */
/* ------------------------------------------------ */

router.get(
  "/topics",
  guestOrAuthMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const { courseId } = req.query;
      const userId = req.user?.id || ANONYMOUS_USER_ID;

      const topics = await prisma.topic.findMany({
        where: {
          userId,
          ...(courseId ? { courseId: courseId as string } : {}),
        },
        orderBy: { orderIndex: "asc" },
      });

      res.json({ topics });
    } catch (error) {
      console.error("Get topics error:", error);
      res.status(500).json({ error: "Failed to get topics", details: String(error) });
    }
  },
);

router.post(
  "/topics",
  guestOrAuthMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id, name, courseId } = req.body || {};

      if (!name || !courseId) {
        return res
          .status(400)
          .json({ error: "Name and courseId are required" });
      }

      const userId = req.user?.id || ANONYMOUS_USER_ID;

      if (id) {
        const existing = await prisma.topic.findFirst({ where: { id, userId } });
        if (existing) {
          if (existing.name !== name) {
            const updated = await prisma.topic.update({
              where: { id: existing.id },
              data: { name },
            });
            return res.json({ topic: updated });
          }
          return res.json({ topic: existing });
        }
      }

      const maxOrder = await prisma.topic.findFirst({
        where: { courseId },
        orderBy: { orderIndex: "desc" },
        select: { orderIndex: true },
      });

      const topic = await prisma.topic.create({
        data: {
          ...(id ? { id } : {}),
          userId,
          courseId,
          name,
          orderIndex: (maxOrder?.orderIndex ?? -1) + 1,
        },
      });

      console.log("[Topic created]", topic.id);

      res.json({ topic });
    } catch (error) {
      console.error("Create topic error:", error);
      res.status(500).json({ error: "Failed to create topic", details: String(error) });
    }
  },
);

export default router;