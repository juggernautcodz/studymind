import { AppError } from "./lib/errors";
import type { OriginalImageStorage } from "./lib/original-image-storage";
import { originalImageObjectKey, type OriginalImageMimeType } from "./lib/original-image-upload-validation";

type OwnedTopic = { id: string };
type WhiteboardImage = { id: string; topicId: string; filename: string; filepath: string; ocrText: string | null };
type SourceOriginalImage = {
  topicId: string | null;
  whiteboardImageId: string | null;
  mimeType: string | null;
  whiteboardImage: {
    id: string;
    topicId: string;
    filepath: string;
    topic: {
      userId: string;
      courseId: string;
      course: { userId: string };
    };
  } | null;
};

export interface OriginalImageUploadDatabase {
  topic: { findFirst(args: unknown): Promise<OwnedTopic | null> };
  source: { findFirst(args: unknown): Promise<SourceOriginalImage | null> };
  whiteboardImage: {
    findUnique(args: unknown): Promise<WhiteboardImage | null>;
    create(args: unknown): Promise<WhiteboardImage>;
  };
}

export interface OriginalImageUploadDependencies {
  db: OriginalImageUploadDatabase;
  storage: OriginalImageStorage;
}

const ORIGINAL_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export type OwnedSourceOriginalImage = {
  whiteboardImageId: string;
  filepath: string;
  mimeType: string;
};

// TEMPORARY: Remove after the failing production sources are diagnosed.
const DIAGNOSTIC_COURSE_ID = "d6d406dc-2ba1-47af-a688-5f2b19d7c956";
const DIAGNOSTIC_SOURCE_IDS = new Set([
  "8ef18dbd-4ba7-40b6-a243-ca6d9c29bf92",
  "4c3ae914-a8b4-402e-9f08-ae83aeab3b93",
  "2c43cead-39bb-4e71-9512-43a84827c3d0",
  "bb5f8838-6b6d-4fcb-a8d3-2ec3fa651a29",
]);

export function shouldLogTemporarySourceImageDiagnostic(
  courseId: string | undefined,
  sourceId: string | undefined,
): boolean {
  return courseId === DIAGNOSTIC_COURSE_ID && !!sourceId && DIAGNOSTIC_SOURCE_IDS.has(sourceId);
}

export type SourceImageDiagnosticReason =
  | "SOURCE_NOT_FOUND"
  | "MISSING_IMAGE_LINK"
  | "UNSUPPORTED_MIME"
  | "IMAGE_ROW_MISMATCH"
  | "OWNERSHIP_MISMATCH"
  | "STORAGE_OBJECT_MISSING"
  | "LOOKUP_VALID"
  | "STORAGE_EXISTS_FAILED"
  | "STORAGE_DOWNLOAD_FAILED";

export function logTemporarySourceImageDiagnostic(input: {
  courseId: string;
  sourceId: string;
  reason: SourceImageDiagnosticReason;
  whiteboardImageId?: string | null;
  filepath?: string | null;
  mimeType?: string | null;
  storageExists?: boolean;
  storageOperation?: string;
  storageStatusCode?: number;
  responseHeadersSent?: boolean;
}): void {
  if (!shouldLogTemporarySourceImageDiagnostic(input.courseId, input.sourceId)) {
    return;
  }

  console.info("[SourceImage diagnostic]", {
    courseId: input.courseId,
    sourceId: input.sourceId,
    whiteboardImageId: input.whiteboardImageId ?? undefined,
    filepath: input.filepath ?? undefined,
    mimeType: input.mimeType ?? undefined,
    storageExists: input.storageExists,
    storageOperation: input.storageOperation,
    storageStatusCode: input.storageStatusCode,
    responseHeadersSent: input.responseHeadersSent,
    reason: input.reason,
  });
}

export async function findOwnedSourceOriginalImage(
  db: OriginalImageUploadDatabase,
  userId: string,
  courseId: string,
  sourceId: string,
): Promise<OwnedSourceOriginalImage> {
  const source = await db.source.findFirst({
    where: { id: sourceId, courseId, course: { userId } },
    select: {
      topicId: true,
      whiteboardImageId: true,
      mimeType: true,
      whiteboardImage: {
        select: {
          id: true,
          topicId: true,
          filepath: true,
          topic: {
            select: {
              userId: true,
              courseId: true,
              course: { select: { userId: true } },
            },
          },
        },
      },
    },
  });

  if (!source) {
    logTemporarySourceImageDiagnostic({
      courseId,
      sourceId,
      reason: "SOURCE_NOT_FOUND",
    });
    throw new AppError(404, "NOT_FOUND", "Original image not found");
  }
  if (!source.topicId || !source.whiteboardImageId) {
    logTemporarySourceImageDiagnostic({
      courseId,
      sourceId,
      whiteboardImageId: source.whiteboardImageId,
      filepath: source.whiteboardImage?.filepath,
      mimeType: source.mimeType,
      reason: "MISSING_IMAGE_LINK",
    });
    throw new AppError(404, "NOT_FOUND", "Original image not found");
  }
  if (
    !source.mimeType ||
    !ORIGINAL_IMAGE_MIME_TYPES.has(source.mimeType)
  ) {
    logTemporarySourceImageDiagnostic({
      courseId,
      sourceId,
      whiteboardImageId: source.whiteboardImageId,
      filepath: source.whiteboardImage?.filepath,
      mimeType: source.mimeType,
      reason: "UNSUPPORTED_MIME",
    });
    throw new AppError(404, "NOT_FOUND", "Original image not found");
  }

  const image = source.whiteboardImage;
  if (
    !image ||
    image.id !== source.whiteboardImageId ||
    image.topicId !== source.topicId
  ) {
    logTemporarySourceImageDiagnostic({
      courseId,
      sourceId,
      whiteboardImageId: source.whiteboardImageId,
      filepath: image?.filepath,
      mimeType: source.mimeType,
      reason: "IMAGE_ROW_MISMATCH",
    });
    throw new AppError(404, "NOT_FOUND", "Original image not found");
  }
  if (
    image.topic.courseId !== courseId ||
    image.topic.userId !== userId ||
    image.topic.course.userId !== userId
  ) {
    logTemporarySourceImageDiagnostic({
      courseId,
      sourceId,
      whiteboardImageId: source.whiteboardImageId,
      filepath: image.filepath,
      mimeType: source.mimeType,
      reason: "OWNERSHIP_MISMATCH",
    });
    throw new AppError(404, "NOT_FOUND", "Original image not found");
  }

  return {
    whiteboardImageId: source.whiteboardImageId,
    filepath: image.filepath,
    mimeType: source.mimeType,
  };
}

export async function requireOwnedTopic(db: OriginalImageUploadDatabase, userId: string, courseId: string, topicId: string): Promise<void> {
  const topic = await db.topic.findFirst({ where: { id: topicId, courseId, userId, course: { userId } }, select: { id: true } });
  if (!topic) throw new AppError(404, "NOT_FOUND", "Topic not found");
}

function isP2002(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function matches(existing: WhiteboardImage, topicId: string, filepath: string, ocrText: string): boolean {
  return existing.topicId === topicId && existing.filepath === filepath && existing.ocrText === ocrText;
}

export type UploadOriginalImageInput = { userId: string; courseId: string; topicId: string; uploadId: string; ocrText: string; bytes: Buffer; mimeType: OriginalImageMimeType };
export type UploadOriginalImageResult = { image: WhiteboardImage; replay: boolean };

export async function uploadOriginalImage(input: UploadOriginalImageInput, dependencies: OriginalImageUploadDependencies): Promise<UploadOriginalImageResult> {
  const { db, storage } = dependencies;
  const filepath = originalImageObjectKey(input);
  const filename = `image.${filepath.split(".").pop()}`;
  const existing = await db.whiteboardImage.findUnique({ where: { id: input.uploadId } });
  if (existing) {
    if (matches(existing, input.topicId, filepath, input.ocrText)) return { image: existing, replay: true };
    throw new AppError(409, "UPLOAD_ID_CONFLICT", "Upload ID conflicts with an existing image");
  }

  try {
    await storage.uploadBytes(filepath, input.bytes);
  } catch {
    throw new AppError(503, "STORAGE_UNAVAILABLE", "Image storage is temporarily unavailable");
  }

  try {
    const image = await db.whiteboardImage.create({ data: { id: input.uploadId, topicId: input.topicId, filename, filepath, ocrText: input.ocrText } });
    return { image, replay: false };
  } catch (error) {
    let winner: WhiteboardImage | null;
    try {
      winner = await db.whiteboardImage.findUnique({ where: { id: input.uploadId } });
    } catch {
      throw new AppError(500, "UPLOAD_PERSISTENCE_FAILED", "Unable to save image metadata");
    }

    if (winner && matches(winner, input.topicId, filepath, input.ocrText)) return { image: winner, replay: true };
    if (winner) {
      // Storage and database commits are not atomic. Even when this upload ID
      // has a divergent winner, the uploaded key may belong to another request
      // whose metadata commit is still in flight. Retain it for reconciliation.
      throw new AppError(409, "UPLOAD_ID_CONFLICT", "Upload ID conflicts with an existing image");
    }
    if (isP2002(error)) throw new AppError(409, "UPLOAD_ID_CONFLICT", "Upload ID conflicts with an existing image");

    // A non-P2002 create failure may have happened after commit, or another
    // request may still be committing this key. With storage outside database
    // transactions there is no race-free proof that deletion is safe, so retain
    // the object for later reconciliation rather than risk deleting a winner.
    throw new AppError(500, "UPLOAD_PERSISTENCE_FAILED", "Unable to save image metadata");
  }
}
