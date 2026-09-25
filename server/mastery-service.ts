import { Prisma } from "@prisma/client";

import prisma from "./db";
import { AppError } from "./lib/errors";

type Tx = Prisma.TransactionClient;

async function conceptForTopic(tx: Tx, userId: string, courseId: string, topicId: string) {
  const topic = await tx.topic.findFirst({
    where: { id: topicId, userId, courseId, course: { userId } },
    select: { id: true, name: true },
  });
  if (!topic) throw new AppError(404, "NOT_FOUND", "Topic not found");
  return tx.concept.upsert({
    where: { courseId_topicId: { courseId, topicId } },
    create: { userId, courseId, topicId, name: topic.name },
    update: { name: topic.name },
  });
}

function trend(events: Array<{ correctCount: number; incorrectCount: number }>) {
  if (events.length < 4) return "UNKNOWN";
  const midpoint = Math.floor(events.length / 2);
  const accuracy = (rows: typeof events) => {
    const correct = rows.reduce((sum, row) => sum + row.correctCount, 0);
    const total = correct + rows.reduce((sum, row) => sum + row.incorrectCount, 0);
    return total ? correct / total : 0;
  };
  const delta = accuracy(events.slice(midpoint)) - accuracy(events.slice(0, midpoint));
  return delta > 0.1 ? "IMPROVING" : delta < -0.1 ? "DECLINING" : "STEADY";
}

async function recompute(tx: Tx, userId: string, courseId: string, conceptId: string) {
  const events = await tx.masteryEvent.findMany({
    where: { userId, courseId, conceptId },
    orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
    select: { correctCount: true, incorrectCount: true, occurredAt: true },
  });
  const correctCount = events.reduce((sum, event) => sum + event.correctCount, 0);
  const incorrectCount = events.reduce((sum, event) => sum + event.incorrectCount, 0);
  const answers = correctCount + incorrectCount;
  const evidenceCount = events.filter((event) => event.correctCount + event.incorrectCount > 0).length;
  const score = answers ? correctCount / answers : 0;
  const confidence = Math.min(1, answers / 20);
  const lastPracticedAt = events.length ? events[events.length - 1].occurredAt : null;
  return tx.conceptMastery.upsert({
    where: { userId_conceptId: { userId, conceptId } },
    create: { userId, courseId, conceptId, score, confidence, evidenceCount, correctCount, incorrectCount, lastPracticedAt, trend: trend(events) },
    update: { score, confidence, evidenceCount, correctCount, incorrectCount, lastPracticedAt, trend: trend(events) },
  });
}

export async function recordFlashcardReview(userId: string, flashcardId: string, correct: boolean, eventId: string) {
  const eventKey = `flashcard-review:${flashcardId}:${eventId}`;
  try {
    return await prisma.$transaction(async (tx) => {
    const card = await tx.flashcard.findFirst({
      where: { id: flashcardId, topic: { userId, course: { userId } } },
      select: { id: true, topicId: true, topic: { select: { courseId: true } } },
    });
    if (!card) throw new AppError(404, "NOT_FOUND", "Flashcard not found");
    const duplicate = await tx.masteryEvent.findUnique({ where: { eventKey } });
    if (duplicate) return { duplicate: true, stat: await tx.flashcardStat.findUnique({ where: { userId_flashcardId: { userId, flashcardId } } }) };

    const stat = await tx.flashcardStat.upsert({
      where: { userId_flashcardId: { userId, flashcardId } },
      create: { userId, flashcardId, easeFactor: 2.5, interval: 1 },
      update: {},
    });
    const concept = await conceptForTopic(tx, userId, card.topic.courseId, card.topicId);
    await tx.masteryEvent.createMany({
      data: [{
        eventKey: `flashcard-baseline:${stat.id}`,
        userId,
        courseId: card.topic.courseId,
        conceptId: concept.id,
        kind: "FLASHCARD_BASELINE",
        sourceId: stat.id,
        correctCount: stat.timesCorrect,
        incorrectCount: stat.timesWrong,
        occurredAt: stat.lastReviewed ?? new Date(),
      }],
      skipDuplicates: true,
    });

    const easeFactor = Math.max(1.3, stat.easeFactor + (correct ? 0.1 : -0.2));
    const interval = correct ? Math.round(stat.interval * stat.easeFactor) : 1;
    const nextReview = new Date(); nextReview.setDate(nextReview.getDate() + interval);
    const updatedStat = await tx.flashcardStat.update({ where: { id: stat.id }, data: { timesCorrect: correct ? { increment: 1 } : undefined, timesWrong: correct ? undefined : { increment: 1 }, lastReviewed: new Date(), nextReview, easeFactor, interval } });
    await tx.masteryEvent.create({ data: { eventKey, userId, courseId: card.topic.courseId, conceptId: concept.id, kind: "FLASHCARD_REVIEW", sourceId: flashcardId, correctCount: correct ? 1 : 0, incorrectCount: correct ? 0 : 1 } });
    await recompute(tx, userId, card.topic.courseId, concept.id);
    return { duplicate: false, stat: updatedStat };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    // A concurrent retry can pass the first duplicate read, then lose the unique
    // event-key race. Treat it as the same accepted answer rather than surfacing
    // an error or applying the spaced-repetition update twice.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const duplicate = await prisma.masteryEvent.findUnique({ where: { eventKey } });
      if (duplicate) {
        return {
          duplicate: true,
          stat: await prisma.flashcardStat.findUnique({ where: { userId_flashcardId: { userId, flashcardId } } }),
        };
      }
    }
    throw error;
  }
}

export async function backfillCourseMastery(userId: string, courseId: string) {
  return prisma.$transaction(async (tx) => {
    const course = await tx.course.findFirst({ where: { id: courseId, userId }, include: { topics: { where: { userId }, include: { flashcards: { include: { stats: { where: { userId } } } }, quizzes: { include: { attempts: { where: { userId } } } } } } } });
    if (!course) throw new AppError(404, "NOT_FOUND", "Course not found");
    const masteries = [];
    for (const topic of course.topics) {
      const concept = await conceptForTopic(tx, userId, courseId, topic.id);
      for (const card of topic.flashcards) for (const stat of card.stats) await tx.masteryEvent.upsert({ where: { eventKey: `flashcard-baseline:${stat.id}` }, create: { eventKey: `flashcard-baseline:${stat.id}`, userId, courseId, conceptId: concept.id, kind: "FLASHCARD_BASELINE", sourceId: stat.id, correctCount: stat.timesCorrect, incorrectCount: stat.timesWrong, occurredAt: stat.lastReviewed ?? new Date() }, update: {} });
      for (const quiz of topic.quizzes) for (const attempt of quiz.attempts) await tx.masteryEvent.upsert({ where: { eventKey: `quiz-attempt:${attempt.id}` }, create: { eventKey: `quiz-attempt:${attempt.id}`, userId, courseId, conceptId: concept.id, kind: "QUIZ_ATTEMPT", sourceId: attempt.id, correctCount: attempt.score, incorrectCount: Math.max(0, attempt.totalQuestions - attempt.score), occurredAt: attempt.completedAt }, update: {} });
      masteries.push(await recompute(tx, userId, courseId, concept.id));
    }
    return masteries;
  });
}

export async function getCourseMastery(userId: string, courseId: string) {
  const course = await prisma.course.findFirst({ where: { id: courseId, userId }, select: { id: true, concepts: { where: { userId }, include: { masteries: { where: { userId } }, topic: { select: { id: true, name: true } } } } } });
  if (!course) throw new AppError(404, "NOT_FOUND", "Course not found");
  return course.concepts.map((concept) => {
    const mastery = concept.masteries[0];
    const evidenceCount = mastery?.evidenceCount ?? 0;
    return { conceptId: concept.id, topicId: concept.topic.id, name: concept.name, score: evidenceCount > 0 ? mastery!.score : null, confidence: mastery?.confidence ?? 0, evidenceCount, correctCount: mastery?.correctCount ?? 0, incorrectCount: mastery?.incorrectCount ?? 0, lastPracticedAt: mastery?.lastPracticedAt?.toISOString() ?? null, trend: mastery?.trend ?? "UNKNOWN" };
  });
}
