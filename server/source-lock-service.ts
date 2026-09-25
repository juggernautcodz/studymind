import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";

import type {
  SourceLocatorDto,
  SourceLockCitationDto,
} from "../shared/source-lock";
import prisma from "./db";
import { AppError } from "./lib/errors";
import type {
  CreateSourceInput,
  CreateSourceRevisionInput,
} from "./lib/source-lock-validation";

const MAX_CITATION_EXCERPT_LENGTH = 500;
const SERIALIZABLE_RETRY_LIMIT = 3;

type SegmentInput = CreateSourceInput["segments"][number];

export type CitationArtifactTarget =
  | { kind: "FLASHCARD"; flashcardId: string }
  | { kind: "QUIZ_QUESTION"; quizQuestionId: string }
  | { kind: "TOPIC_NOTES"; topicId: string };

export interface SegmentValidationOptions {
  expectedSourceId?: string;
  expectedRevisionId?: string;
  allowedSegmentIds?: readonly string[];
}

export interface CreateArtifactCitationsInput {
  target: CitationArtifactTarget;
  sourceId: string;
  revisionId: string;
  segmentIds: string[];
  allowedSegmentIds: readonly string[];
  generationRunId?: string;
}

export interface BatchArtifactCitationItem {
  target: CitationArtifactTarget;
  segmentIds: string[];
}

export interface CreateArtifactCitationsBatchInput {
  sourceId: string;
  revisionId: string;
  allowedSegmentIds: readonly string[];
  generationRunId?: string;
  items: BatchArtifactCitationItem[];
}

function isRetryableTransactionError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

async function withSerializableRetry<T>(
  operation: () => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= SERIALIZABLE_RETRY_LIMIT; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (
        !isRetryableTransactionError(error) ||
        attempt === SERIALIZABLE_RETRY_LIMIT
      ) {
        throw error;
      }
    }
  }
  throw new Error("Serializable transaction retry limit exhausted");
}

function hashSegments(segments: SegmentInput[]): string {
  const canonicalContent = segments.map((segment, position) => ({
    position,
    content: segment.content,
    locatorLabel: segment.locatorLabel ?? null,
    pageNumber: segment.pageNumber ?? null,
    startSeconds: segment.startSeconds ?? null,
    endSeconds: segment.endSeconds ?? null,
    charStart: segment.charStart ?? null,
    charEnd: segment.charEnd ?? null,
    regionX: segment.regionX ?? null,
    regionY: segment.regionY ?? null,
    regionWidth: segment.regionWidth ?? null,
    regionHeight: segment.regionHeight ?? null,
  }));
  return createHash("sha256")
    .update(JSON.stringify(canonicalContent))
    .digest("hex");
}

function segmentCreateData(segments: SegmentInput[]) {
  return segments.map((segment, position) => ({
    position,
    content: segment.content,
    locatorLabel: segment.locatorLabel ?? null,
    pageNumber: segment.pageNumber ?? null,
    startSeconds: segment.startSeconds ?? null,
    endSeconds: segment.endSeconds ?? null,
    charStart: segment.charStart ?? null,
    charEnd: segment.charEnd ?? null,
    regionX: segment.regionX ?? null,
    regionY: segment.regionY ?? null,
    regionWidth: segment.regionWidth ?? null,
    regionHeight: segment.regionHeight ?? null,
  }));
}

function contentLength(segments: SegmentInput[]): number {
  return segments.reduce((total, segment) => total + segment.content.length, 0);
}

async function assertOwnedCourse(
  tx: Prisma.TransactionClient,
  courseId: string,
  userId: string,
): Promise<void> {
  const course = await tx.course.findFirst({
    where: { id: courseId, userId },
    select: { id: true },
  });
  if (!course) throw new AppError(404, "NOT_FOUND", "Course not found");
}

async function assertOwnedLegacyLinks(
  tx: Prisma.TransactionClient,
  userId: string,
  courseId: string,
  input: Pick<
    CreateSourceInput,
    "topicId" | "recordingId" | "whiteboardImageId"
  >,
): Promise<string | null> {
  if (input.recordingId && input.whiteboardImageId) {
    throw new AppError(
      400,
      "AMBIGUOUS_SOURCE_ORIGIN",
      "A source may reference either a recording or a whiteboard image, not both",
    );
  }

  const [topic, recording, whiteboardImage] = await Promise.all([
    input.topicId
      ? tx.topic.findFirst({
          where: { id: input.topicId, userId, courseId },
          select: { id: true },
        })
      : null,
    input.recordingId
      ? tx.recording.findFirst({
          where: {
            id: input.recordingId,
            userId,
            topic: { courseId, userId },
          },
          select: { id: true, topicId: true },
        })
      : null,
    input.whiteboardImageId
      ? tx.whiteboardImage.findFirst({
          where: {
            id: input.whiteboardImageId,
            topic: { courseId, userId },
          },
          select: { id: true, topicId: true },
        })
      : null,
  ]);

  if (input.topicId && !topic) {
    throw new AppError(404, "NOT_FOUND", "Topic not found");
  }
  if (input.recordingId && !recording) {
    throw new AppError(404, "NOT_FOUND", "Recording not found");
  }
  if (input.whiteboardImageId && !whiteboardImage) {
    throw new AppError(404, "NOT_FOUND", "Whiteboard image not found");
  }
  if (input.topicId && recording && recording.topicId !== input.topicId) {
    throw new AppError(
      400,
      "SOURCE_LINK_MISMATCH",
      "Recording does not belong to the supplied topic",
    );
  }
  if (
    input.topicId &&
    whiteboardImage &&
    whiteboardImage.topicId !== input.topicId
  ) {
    throw new AppError(
      400,
      "SOURCE_LINK_MISMATCH",
      "Whiteboard image does not belong to the supplied topic",
    );
  }

  return (
    input.topicId ?? recording?.topicId ?? whiteboardImage?.topicId ?? null
  );
}

async function createGenerationRun(
  tx: Prisma.TransactionClient,
  courseId: string,
  generation: CreateSourceInput["generation"],
): Promise<string | null> {
  if (!generation) return null;
  const run = await tx.generationRun.create({
    data: {
      courseId,
      operation: generation.operation,
      provider: generation.provider ?? null,
      model: generation.model ?? null,
    },
    select: { id: true },
  });
  return run.id;
}

async function createRevision(
  tx: Prisma.TransactionClient,
  sourceId: string,
  revision: number,
  generationRunId: string | null,
  segments: SegmentInput[],
) {
  return tx.sourceRevision.create({
    data: {
      sourceId,
      revision,
      generationRunId,
      contentHash: hashSegments(segments),
      contentLength: contentLength(segments),
      segments: { create: segmentCreateData(segments) },
    },
    select: {
      id: true,
      revision: true,
      contentHash: true,
      contentLength: true,
    },
  });
}

export async function createSource(
  userId: string,
  courseId: string,
  input: CreateSourceInput,
) {
  const created = await withSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
        await assertOwnedCourse(tx, courseId, userId);
        const resolvedTopicId = await assertOwnedLegacyLinks(
          tx,
          userId,
          courseId,
          input,
        );
        const generationRunId = await createGenerationRun(
          tx,
          courseId,
          input.generation,
        );
        const source = await tx.source.create({
          data: {
            courseId,
            topicId: resolvedTopicId,
            recordingId: input.recordingId ?? null,
            whiteboardImageId: input.whiteboardImageId ?? null,
            kind: input.kind,
            title: input.title,
            originUri: input.originUri ?? null,
            mimeType: input.mimeType ?? null,
            currentRevision: 1,
          },
          select: { id: true },
        });
        await createRevision(tx, source.id, 1, generationRunId, input.segments);
        return source;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );

  return getSource(userId, courseId, created.id);
}

export async function addSourceRevision(
  userId: string,
  courseId: string,
  sourceId: string,
  input: CreateSourceRevisionInput,
) {
  await withSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const source = await tx.source.findFirst({
          where: { id: sourceId, courseId, course: { userId } },
          select: { id: true },
        });
        if (!source) throw new AppError(404, "NOT_FOUND", "Source not found");

        const updated = await tx.source.update({
          where: { id: source.id },
          data: { currentRevision: { increment: 1 } },
          select: { currentRevision: true },
        });
        const generationRunId = await createGenerationRun(
          tx,
          courseId,
          input.generation,
        );
        await createRevision(
          tx,
          source.id,
          updated.currentRevision,
          generationRunId,
          input.segments,
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );

  return getSource(userId, courseId, sourceId);
}

export async function listSources(userId: string, courseId: string) {
  const course = await prisma.course.findFirst({
    where: { id: courseId, userId },
    select: { id: true },
  });
  if (!course) throw new AppError(404, "NOT_FOUND", "Course not found");

  return prisma.source.findMany({
    where: { courseId, course: { userId } },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      kind: true,
      title: true,
      topicId: true,
      currentRevision: true,
      createdAt: true,
      updatedAt: true,
      revisions: {
        orderBy: { revision: "desc" },
        take: 1,
        select: {
          id: true,
          revision: true,
          contentHash: true,
          contentLength: true,
          createdAt: true,
          _count: { select: { segments: true } },
        },
      },
    },
  });
}

export async function getSource(
  userId: string,
  courseId: string,
  sourceId: string,
  revision?: number,
) {
  const source = await prisma.source.findFirst({
    where: { id: sourceId, courseId, course: { userId } },
    select: {
      id: true,
      kind: true,
      title: true,
      topicId: true,
      recordingId: true,
      whiteboardImageId: true,
      originUri: true,
      mimeType: true,
      currentRevision: true,
      createdAt: true,
      updatedAt: true,
      revisions: {
        where: revision === undefined ? undefined : { revision },
        orderBy: { revision: "desc" },
        take: 1,
        select: {
          id: true,
          revision: true,
          contentHash: true,
          contentLength: true,
          createdAt: true,
          generationRun: {
            select: {
              id: true,
              operation: true,
              provider: true,
              model: true,
              createdAt: true,
            },
          },
          segments: {
            orderBy: { position: "asc" },
            select: {
              id: true,
              position: true,
              content: true,
              locatorLabel: true,
              pageNumber: true,
              startSeconds: true,
              endSeconds: true,
              charStart: true,
              charEnd: true,
              regionX: true,
              regionY: true,
              regionWidth: true,
              regionHeight: true,
            },
          },
        },
      },
    },
  });

  if (!source || source.revisions.length === 0) {
    throw new AppError(404, "NOT_FOUND", "Source or revision not found");
  }
  return source;
}

async function validateSourceSegmentIdsInTransaction(
  tx: Prisma.TransactionClient,
  userId: string,
  courseId: string,
  segmentIds: string[],
  options: SegmentValidationOptions = {},
) {
  const uniqueIds = [...new Set(segmentIds)];
  if (uniqueIds.length !== segmentIds.length || uniqueIds.length === 0) {
    throw new AppError(
      400,
      "INVALID_SOURCE_SEGMENTS",
      "Source segment IDs must be non-empty and unique",
    );
  }

  if (options.allowedSegmentIds) {
    const allowedIds = new Set(options.allowedSegmentIds);
    if (allowedIds.size !== options.allowedSegmentIds.length) {
      throw new AppError(
        400,
        "INVALID_SOURCE_SEGMENT_ALLOWLIST",
        "Allowed source segment IDs must be unique",
      );
    }
    if (uniqueIds.some((id) => !allowedIds.has(id))) {
      throw new AppError(
        400,
        "SOURCE_SEGMENT_NOT_ALLOWED",
        "One or more source segments were not included in the allowed input set",
      );
    }
  }

  const segments = await tx.sourceSegment.findMany({
    where: {
      id: { in: uniqueIds },
      revision: {
        ...(options.expectedRevisionId
          ? { id: options.expectedRevisionId }
          : {}),
        source: {
          ...(options.expectedSourceId ? { id: options.expectedSourceId } : {}),
          courseId,
          course: { userId },
        },
      },
    },
    select: {
      id: true,
      position: true,
      content: true,
      revisionId: true,
    },
  });

  if (segments.length !== uniqueIds.length) {
    throw new AppError(
      400,
      "INVALID_SOURCE_SEGMENTS",
      "One or more source segments are outside the authorized course or revision",
    );
  }
  return segments;
}

export async function validateSourceSegmentIds(
  userId: string,
  courseId: string,
  segmentIds: string[],
  options: SegmentValidationOptions = {},
) {
  return prisma.$transaction((tx) =>
    validateSourceSegmentIdsInTransaction(
      tx,
      userId,
      courseId,
      segmentIds,
      options,
    ),
  );
}

async function assertOwnedCitationTarget(
  tx: Prisma.TransactionClient,
  userId: string,
  courseId: string,
  target: CitationArtifactTarget,
): Promise<void> {
  const artifact =
    target.kind === "FLASHCARD"
      ? await tx.flashcard.findFirst({
          where: {
            id: target.flashcardId,
            topic: { userId, courseId, course: { userId } },
          },
          select: { id: true },
        })
      : target.kind === "QUIZ_QUESTION"
        ? await tx.quizQuestion.findFirst({
            where: {
              id: target.quizQuestionId,
              quiz: { topic: { userId, courseId, course: { userId } } },
            },
            select: { id: true },
          })
        : await tx.topic.findFirst({
            where: { id: target.topicId, userId, courseId, course: { userId } },
            select: { id: true },
          });

  if (!artifact) throw new AppError(404, "NOT_FOUND", "Artifact not found");
}

function citationTargetData(target: CitationArtifactTarget) {
  return target.kind === "FLASHCARD"
    ? {
        artifactKind: target.kind,
        flashcardId: target.flashcardId,
        quizQuestionId: null,
        topicId: null,
      }
    : target.kind === "QUIZ_QUESTION"
      ? {
          artifactKind: target.kind,
          flashcardId: null,
          quizQuestionId: target.quizQuestionId,
          topicId: null,
        }
      : {
          artifactKind: target.kind,
          flashcardId: null,
          quizQuestionId: null,
          topicId: target.topicId,
      };
}

function citationTargetKey(target: CitationArtifactTarget): string {
  return target.kind === "FLASHCARD"
    ? `${target.kind}:${target.flashcardId}`
    : target.kind === "QUIZ_QUESTION"
      ? `${target.kind}:${target.quizQuestionId}`
      : `${target.kind}:${target.topicId}`;
}

async function assertOwnedCitationTargets(
  tx: Prisma.TransactionClient,
  userId: string,
  courseId: string,
  targets: CitationArtifactTarget[],
): Promise<void> {
  const flashcardIds = [
    ...new Set(
      targets.flatMap((target) =>
        target.kind === "FLASHCARD" ? [target.flashcardId] : [],
      ),
    ),
  ];
  const quizQuestionIds = [
    ...new Set(
      targets.flatMap((target) =>
        target.kind === "QUIZ_QUESTION" ? [target.quizQuestionId] : [],
      ),
    ),
  ];
  const topicIds = [
    ...new Set(
      targets.flatMap((target) =>
        target.kind === "TOPIC_NOTES" ? [target.topicId] : [],
      ),
    ),
  ];

  const [flashcards, quizQuestions, topics] = await Promise.all([
    flashcardIds.length
      ? tx.flashcard.findMany({
          where: {
            id: { in: flashcardIds },
            topic: { userId, courseId, course: { userId } },
          },
          select: { id: true },
        })
      : [],
    quizQuestionIds.length
      ? tx.quizQuestion.findMany({
          where: {
            id: { in: quizQuestionIds },
            quiz: { topic: { userId, courseId, course: { userId } } },
          },
          select: { id: true },
        })
      : [],
    topicIds.length
      ? tx.topic.findMany({
          where: { id: { in: topicIds }, userId, courseId, course: { userId } },
          select: { id: true },
        })
      : [],
  ]);

  if (
    flashcards.length !== flashcardIds.length ||
    quizQuestions.length !== quizQuestionIds.length ||
    topics.length !== topicIds.length
  ) {
    throw new AppError(404, "NOT_FOUND", "Artifact not found");
  }
}

export async function createArtifactCitationsBatch(
  userId: string,
  courseId: string,
  input: CreateArtifactCitationsBatchInput,
): Promise<void> {
  if (input.items.length === 0) return;

  const targetKeys = input.items.map((item) => citationTargetKey(item.target));
  if (new Set(targetKeys).size !== targetKeys.length) {
    throw new AppError(
      400,
      "DUPLICATE_CITATION_TARGET",
      "Citation targets must be unique within a batch",
    );
  }

  await prisma.$transaction(async (tx) => {
    await assertOwnedCourse(tx, courseId, userId);
    await assertOwnedCitationTargets(
      tx,
      userId,
      courseId,
      input.items.map((item) => item.target),
    );

    if (input.generationRunId) {
      const generationRun = await tx.generationRun.findFirst({
        where: {
          id: input.generationRunId,
          courseId,
          course: { userId },
        },
        select: { id: true },
      });
      if (!generationRun) {
        throw new AppError(404, "NOT_FOUND", "Generation run not found");
      }
    }

    const requestedSegmentIds = input.items.flatMap((item) => item.segmentIds);
    const uniqueSegmentIds = [...new Set(requestedSegmentIds)];
    const segments = await validateSourceSegmentIdsInTransaction(
      tx,
      userId,
      courseId,
      uniqueSegmentIds,
      {
        expectedSourceId: input.sourceId,
        expectedRevisionId: input.revisionId,
        allowedSegmentIds: input.allowedSegmentIds,
      },
    );
    const segmentsById = new Map(segments.map((segment) => [segment.id, segment]));

    for (const item of input.items) {
      if (
        item.segmentIds.length === 0 ||
        new Set(item.segmentIds).size !== item.segmentIds.length
      ) {
        throw new AppError(
          400,
          "INVALID_SOURCE_SEGMENTS",
          "Each citation target requires unique source segment IDs",
        );
      }
    }

    await tx.artifactCitation.createMany({
      data: input.items.flatMap((item) => {
        const targetData = citationTargetData(item.target);
        return item.segmentIds.map((segmentId) => {
          const segment = segmentsById.get(segmentId);
          if (!segment) {
            throw new AppError(
              400,
              "INVALID_SOURCE_SEGMENTS",
              "Citation segment was not validated",
            );
          }
          return {
            ...targetData,
            sourceSegmentId: segment.id,
            generationRunId: input.generationRunId ?? null,
            evidenceExcerpt: segment.content.slice(
              0,
              MAX_CITATION_EXCERPT_LENGTH,
            ),
          };
        });
      }),
      skipDuplicates: true,
    });
  });
}

export async function createArtifactCitations(
  userId: string,
  courseId: string,
  input: CreateArtifactCitationsInput,
): Promise<SourceLockCitationDto[]> {
  await prisma.$transaction(async (tx) => {
    await assertOwnedCourse(tx, courseId, userId);
    await assertOwnedCitationTarget(tx, userId, courseId, input.target);

    if (input.generationRunId) {
      const generationRun = await tx.generationRun.findFirst({
        where: {
          id: input.generationRunId,
          courseId,
          course: { userId },
        },
        select: { id: true },
      });
      if (!generationRun) {
        throw new AppError(404, "NOT_FOUND", "Generation run not found");
      }
    }

    const segments = await validateSourceSegmentIdsInTransaction(
      tx,
      userId,
      courseId,
      input.segmentIds,
      {
        expectedSourceId: input.sourceId,
        expectedRevisionId: input.revisionId,
        allowedSegmentIds: input.allowedSegmentIds,
      },
    );
    const targetData = citationTargetData(input.target);
    await tx.artifactCitation.createMany({
      data: segments.map((segment) => ({
        ...targetData,
        sourceSegmentId: segment.id,
        generationRunId: input.generationRunId ?? null,
        evidenceExcerpt: segment.content.slice(0, MAX_CITATION_EXCERPT_LENGTH),
      })),
      skipDuplicates: true,
    });
  });

  return getArtifactCitations(userId, courseId, input.target);
}

function locatorFromSegment(segment: {
  locatorLabel: string | null;
  pageNumber: number | null;
  startSeconds: number | null;
  endSeconds: number | null;
  charStart: number | null;
  charEnd: number | null;
  regionX: number | null;
  regionY: number | null;
  regionWidth: number | null;
  regionHeight: number | null;
}): SourceLocatorDto {
  const hasRegion =
    segment.regionX !== null &&
    segment.regionY !== null &&
    segment.regionWidth !== null &&
    segment.regionHeight !== null;
  return {
    label: segment.locatorLabel,
    pageNumber: segment.pageNumber,
    startSeconds: segment.startSeconds,
    endSeconds: segment.endSeconds,
    charStart: segment.charStart,
    charEnd: segment.charEnd,
    region: hasRegion
      ? {
          x: segment.regionX!,
          y: segment.regionY!,
          width: segment.regionWidth!,
          height: segment.regionHeight!,
        }
      : null,
  };
}

export async function getArtifactCitations(
  userId: string,
  courseId: string,
  target: CitationArtifactTarget,
): Promise<SourceLockCitationDto[]> {
  const targetFilter =
    target.kind === "FLASHCARD"
      ? { artifactKind: target.kind, flashcardId: target.flashcardId }
      : target.kind === "QUIZ_QUESTION"
        ? { artifactKind: target.kind, quizQuestionId: target.quizQuestionId }
        : { artifactKind: target.kind, topicId: target.topicId };

  const citations = await prisma.$transaction(async (tx) => {
    await assertOwnedCourse(tx, courseId, userId);
    await assertOwnedCitationTarget(tx, userId, courseId, target);
    return tx.artifactCitation.findMany({
      where: targetFilter,
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        evidenceExcerpt: true,
        createdAt: true,
        generationRun: {
          select: {
            id: true,
            courseId: true,
            operation: true,
            provider: true,
            model: true,
            createdAt: true,
            course: { select: { userId: true } },
          },
        },
        sourceSegment: {
          select: {
            id: true,
            position: true,
            content: true,
            locatorLabel: true,
            pageNumber: true,
            startSeconds: true,
            endSeconds: true,
            charStart: true,
            charEnd: true,
            regionX: true,
            regionY: true,
            regionWidth: true,
            regionHeight: true,
            revision: {
              select: {
                id: true,
                revision: true,
                contentHash: true,
                source: {
                  select: {
                    id: true,
                    kind: true,
                    title: true,
                    courseId: true,
                    course: { select: { userId: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  const hasInvalidContext = citations.some((citation) => {
    const source = citation.sourceSegment.revision.source;
    const generation = citation.generationRun;
    return (
      source.courseId !== courseId ||
      source.course.userId !== userId ||
      (generation !== null &&
        (generation.courseId !== courseId ||
          generation.course.userId !== userId))
    );
  });
  if (hasInvalidContext) {
    throw new AppError(
      500,
      "CITATION_INTEGRITY_ERROR",
      "Stored citation context is inconsistent",
    );
  }

  return citations.map((citation) => {
    const segment = citation.sourceSegment;
    const excerpt = citation.evidenceExcerpt ?? segment.content;
    return {
      id: citation.id,
      source: {
        id: segment.revision.source.id,
        kind: segment.revision.source.kind,
        title: segment.revision.source.title,
      },
      revision: {
        id: segment.revision.id,
        number: segment.revision.revision,
        contentHash: segment.revision.contentHash,
      },
      segment: {
        id: segment.id,
        position: segment.position,
        locator: locatorFromSegment(segment),
        supportingExcerpt: excerpt.slice(0, MAX_CITATION_EXCERPT_LENGTH),
      },
      generation: citation.generationRun
        ? {
            id: citation.generationRun.id,
            operation: citation.generationRun.operation,
            provider: citation.generationRun.provider,
            model: citation.generationRun.model,
            createdAt: citation.generationRun.createdAt.toISOString(),
          }
        : null,
      createdAt: citation.createdAt.toISOString(),
    };
  });
}
