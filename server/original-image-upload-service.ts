import { AppError } from "./lib/errors";
import type { OriginalImageStorage } from "./lib/original-image-storage";
import { originalImageObjectKey, type OriginalImageMimeType } from "./lib/original-image-upload-validation";

type OwnedTopic = { id: string };
type WhiteboardImage = { id: string; topicId: string; filename: string; filepath: string; ocrText: string | null };

export interface OriginalImageUploadDatabase {
  topic: { findFirst(args: unknown): Promise<OwnedTopic | null> };
  whiteboardImage: {
    findUnique(args: unknown): Promise<WhiteboardImage | null>;
    create(args: unknown): Promise<WhiteboardImage>;
  };
}

export interface OriginalImageUploadDependencies {
  db: OriginalImageUploadDatabase;
  storage: OriginalImageStorage;
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
