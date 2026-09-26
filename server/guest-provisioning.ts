import prisma from "./db";
import { ANONYMOUS_USER_ID } from "./constants";

let provisioningPromise: Promise<void> | null = null;

async function provisionAnonymousUser(): Promise<void> {
  const existingUser = await prisma.user.findUnique({
    where: { id: ANONYMOUS_USER_ID },
    select: { id: true },
  });

  if (existingUser) return;

  try {
    await prisma.$transaction(async (tx) => {
      const existingInTransaction = await tx.user.findUnique({
        where: { id: ANONYMOUS_USER_ID },
        select: { id: true },
      });

      if (existingInTransaction) return;

      await tx.user.create({
        data: {
          id: ANONYMOUS_USER_ID,
          email: "guest@studymind.local",
          passwordHash: "guest-no-login",
          name: "Guest User",
        },
      });

      const semester = await tx.semester.create({
        data: {
          userId: ANONYMOUS_USER_ID,
          name: "My Semester",
        },
      });

      const course = await tx.course.create({
        data: {
          userId: ANONYMOUS_USER_ID,
          semesterId: semester.id,
          name: "My Course",
        },
      });

      const topic = await tx.topic.create({
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

      await tx.flashcard.createMany({
        data: [
          {
            topicId: topic.id,
            front: "What is photosynthesis?",
            back: "Plants converting sunlight into energy.",
            orderIndex: 0,
          },
        ],
      });
    });

    console.log("Created anonymous guest demo content");
  } catch (error) {
    if ((error as { code?: string })?.code === "P2002") {
      const concurrentlyCreatedUser = await prisma.user.findUnique({
        where: { id: ANONYMOUS_USER_ID },
        select: { id: true },
      });
      if (concurrentlyCreatedUser) return;
    }
    throw error;
  }
}

export function ensureAnonymousUserExists(): Promise<void> {
  if (!provisioningPromise) {
    provisioningPromise = provisionAnonymousUser().finally(() => {
      provisioningPromise = null;
    });
  }
  return provisioningPromise;
}
