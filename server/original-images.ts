import { Router, type NextFunction, type Request, type Response } from "express";
import multer, { MulterError } from "multer";
import { AppError, badRequest, internalError, sendError } from "./lib/errors";
import { detectOriginalImageMimeType, ORIGINAL_IMAGE_MAX_BYTES, ORIGINAL_IMAGE_MAX_OCR_TEXT_LENGTH, originalImageUploadParams, uploadIdSchema } from "./lib/original-image-upload-validation";
import { sourceDetailRouteParams } from "./lib/source-lock-validation";
import { findOwnedSourceOriginalImage, requireOwnedTopic, uploadOriginalImage, type OriginalImageUploadDatabase, type OriginalImageUploadDependencies } from "./original-image-upload-service";
import type { OriginalImageStorage } from "./lib/original-image-storage";

export interface AuthRequest extends Request { user?: { id: string; email: string } }
type Middleware = (req: AuthRequest, res: Response, next: NextFunction) => unknown;
export interface OriginalImagesRouterOptions extends OriginalImageUploadDependencies { authenticate: Middleware; requireOwned?: (userId: string, courseId: string, topicId: string) => Promise<void>; }

const multipart = multer({ storage: multer.memoryStorage(), limits: { fileSize: ORIGINAL_IMAGE_MAX_BYTES, files: 1, fields: 2 } }).fields([{ name: "image", maxCount: 1 }]);

function safeMulterError(res: Response, error: unknown): void {
  if (error instanceof MulterError && error.code === "LIMIT_FILE_SIZE") return sendError(res, 413, "PAYLOAD_TOO_LARGE", "Image exceeds the 20 MB limit");
  if (error instanceof MulterError) return badRequest(res, "Invalid multipart upload");
  badRequest(res, "Invalid multipart upload");
}

function validateMultipart(req: AuthRequest): { uploadId: string; ocrText: string; file: Express.Multer.File; mimeType: NonNullable<ReturnType<typeof detectOriginalImageMimeType>> } | undefined {
  const fields = req.body as Record<string, unknown>;
  if (!fields || Object.keys(fields).some((key) => key !== "uploadId" && key !== "ocrText") || Object.values(fields).some(Array.isArray)) return undefined;
  const uploadId = uploadIdSchema.safeParse(fields.uploadId);
  if (!uploadId.success || typeof fields.ocrText !== "string" || fields.ocrText.length > ORIGINAL_IMAGE_MAX_OCR_TEXT_LENGTH) return undefined;
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const image = files?.image;
  if (!image || image.length !== 1) return undefined;
  const mimeType = detectOriginalImageMimeType(image[0].buffer);
  if (!mimeType || image[0].mimetype !== mimeType) return undefined;
  return { uploadId: uploadId.data, ocrText: fields.ocrText, file: image[0], mimeType };
}

export function createOriginalImagesRouter(options: OriginalImagesRouterOptions) {
  const router = Router();
  const { authenticate, db, storage } = options;
  const requireOwned = options.requireOwned ?? ((userId, courseId, topicId) => requireOwnedTopic(db, userId, courseId, topicId));
  router.get("/courses/:courseId/sources/:sourceId/original-image", authenticate, async (req: AuthRequest, res: Response) => {
    const params = sourceDetailRouteParams.safeParse(req.params);
    if (!params.success) return badRequest(res, "Invalid route parameters");

    try {
      const image = await findOwnedSourceOriginalImage(
        db,
        req.user!.id,
        params.data.courseId,
        params.data.sourceId,
      );

      let exists: boolean;
      try {
        exists = await storage.exists(image.filepath);
      } catch {
        throw new AppError(
          503,
          "STORAGE_UNAVAILABLE",
          "Original image is temporarily unavailable",
        );
      }
      if (!exists) {
        throw new AppError(404, "NOT_FOUND", "Original image not found");
      }

      res.setHeader("Content-Type", image.mimeType);
      res.setHeader("Cache-Control", "private, no-store, max-age=0");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("X-Content-Type-Options", "nosniff");

      try {
        await storage.pipeTo(image.filepath, res);
      } catch {
        if (res.headersSent) {
          res.destroy();
          return;
        }
        sendError(
          res,
          503,
          "STORAGE_UNAVAILABLE",
          "Original image is temporarily unavailable",
        );
      }
    } catch (error) {
      handleRetrievalError(res, error);
    }
  });
  router.post("/courses/:courseId/topics/:topicId/whiteboard-images", authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    const params = originalImageUploadParams.safeParse(req.params);
    if (!params.success) return badRequest(res, "Invalid route parameters");
    try { await requireOwned(req.user!.id, params.data.courseId, params.data.topicId); } catch (error) { return handleError(res, error); }
    multipart(req, res, async (error) => {
      if (error) return safeMulterError(res, error);
      const data = validateMultipart(req);
      if (!data) return badRequest(res, "Invalid image upload");
      try {
        const result = await uploadOriginalImage({ userId: req.user!.id, courseId: params.data.courseId, topicId: params.data.topicId, uploadId: data.uploadId, ocrText: data.ocrText, bytes: data.file.buffer, mimeType: data.mimeType }, options);
        return res.status(result.replay ? 200 : 201).json({
          whiteboardImage: { id: result.image.id, mimeType: data.mimeType },
        });
      } catch (uploadError) { return handleError(res, uploadError); }
    });
  });
  return router;
}

export async function createProductionOriginalImagesRouter() {
  const [{ default: prisma }, { authMiddleware }, { originalImageStorage }] = await Promise.all([
    import("./db"),
    import("./auth"),
    import("./lib/original-image-storage"),
  ]);
  return createOriginalImagesRouter({
    authenticate: authMiddleware as Middleware,
    db: prisma as unknown as OriginalImageUploadDatabase,
    storage: originalImageStorage as OriginalImageStorage,
  });
}

function handleError(res: Response, error: unknown): void { if (error instanceof AppError) { res.status(error.statusCode).json(error.toJSON()); return; } internalError(res, "Image upload failed"); }
function handleRetrievalError(res: Response, error: unknown): void {
  if (res.headersSent) return;
  if (error instanceof AppError) {
    res.status(error.statusCode).json(error.toJSON());
    return;
  }
  internalError(res, "Original image request failed");
}
