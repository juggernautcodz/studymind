import prisma from "../db";

/**
 * Export all study data for a user as a clean JSON structure.
 * Used by the StudyMind Web PC companion to sync phone data to the browser.
 *
 * Supports incremental sync via the `since` parameter (ISO timestamp).
 * If `since` is provided, only data updated after that timestamp is returned.
 */
export async function exportUserData(userId: string, since?: Date) {
  const sinceFilter = since ? { updatedAt: { gte: since } } : {};

  const [semesters, courses, topics, flashcards, flashcardStats, quizAttempts, recordings] =
    await Promise.all([
      // Semesters
      prisma.semester.findMany({
        where: { userId, ...sinceFilter },
        orderBy: { startDate: "desc" },
      }),

      // Courses
      prisma.course.findMany({
        where: { userId, ...sinceFilter },
        orderBy: { createdAt: "desc" },
      }),

      // Topics (with transcript + notes — the core content)
      prisma.topic.findMany({
        where: { userId, ...sinceFilter },
        orderBy: [{ courseId: "asc" }, { orderIndex: "asc" }],
        select: {
          id: true,
          userId: true,
          courseId: true,
          name: true,
          orderIndex: true,
          transcript: true,
          notes: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      }),

      // Flashcards
      prisma.flashcard.findMany({
        where: {
          topic: { userId },
          ...(since ? { updatedAt: { gte: since } } : {}),
        },
        orderBy: [{ topicId: "asc" }, { orderIndex: "asc" }],
      }),

      // Flashcard study stats (for spaced repetition)
      prisma.flashcardStat.findMany({
        where: { userId, ...(since ? { updatedAt: { gte: since } } : {}) },
      }),

      // Quiz attempts
      prisma.quizAttempt.findMany({
        where: { userId, ...(since ? { completedAt: { gte: since } } : {}) },
        orderBy: { completedAt: "desc" },
        take: 200,
      }),

      // Recordings metadata (not the audio file — just the record)
      prisma.recording.findMany({
        where: { userId, ...(since ? { createdAt: { gte: since } } : {}) },
        select: {
          id: true,
          topicId: true,
          filename: true,
          durationSeconds: true,
          transcriptStatus: true,
          createdAt: true,
        },
      }),
    ]);

  return {
    exportedAt: new Date().toISOString(),
    incremental: !!since,
    since: since?.toISOString() ?? null,
    data: {
      semesters,
      courses,
      topics,
      flashcards,
      flashcardStats,
      quizAttempts,
      recordings,
    },
    counts: {
      semesters: semesters.length,
      courses: courses.length,
      topics: topics.length,
      flashcards: flashcards.length,
      recordings: recordings.length,
    },
  };
}

/**
 * Get a single topic with all its children for lazy-loading.
 */
export async function exportTopic(topicId: string, userId: string) {
  const topic = await prisma.topic.findFirst({
    where: { id: topicId, userId, course: { userId } },
    include: {
      flashcards: {
        include: { stats: { where: { userId } } },
        orderBy: { orderIndex: "asc" },
      },
      quizzes: {
        include: { questions: true },
      },
      recordings: {
        select: {
          id: true,
          filename: true,
          durationSeconds: true,
          transcriptStatus: true,
          createdAt: true,
        },
      },
      whiteboardImages: true,
      sources: {
        where: { course: { userId } },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          title: true,
          kind: true,
          currentRevision: true,
          updatedAt: true,
          revisions: {
            orderBy: { revision: "desc" },
            take: 1,
            select: {
              revision: true,
              segments: {
                orderBy: { position: "asc" },
                select: {
                  id: true,
                  position: true,
                  content: true,
                  locatorLabel: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!topic) return null;

  return {
    ...topic,
    flashcards: topic.flashcards.map((fc) => ({
      ...fc,
      myStats: fc.stats[0] ?? null,
    })),
  };
}
