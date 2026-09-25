import { Router, type Response } from "express";

import { authMiddleware, type AuthRequest } from "./auth";
import { AppError, badRequest, internalError } from "./lib/errors";
import {
  createSourceBody,
  createSourceRevisionBody,
  sourceDetailRouteParams,
  sourceRevisionQuery,
  sourceRouteParams,
} from "./lib/source-lock-validation";
import { validateBody, validateParams } from "./lib/validate";
import {
  addSourceRevision,
  createSource,
  getSource,
  listSources,
} from "./source-lock-service";

const router = Router();

function handleSourceLockError(res: Response, error: unknown): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json(error.toJSON());
    return;
  }
  console.error("SourceLock error:", error);
  internalError(res, "SourceLock request failed");
}

router.post(
  "/courses/:courseId/sources",
  authMiddleware,
  validateParams(sourceRouteParams),
  validateBody(createSourceBody),
  async (req: AuthRequest, res: Response) => {
    try {
      const courseId = req.params.courseId as string;
      const source = await createSource(req.user!.id, courseId, req.body);
      res.status(201).json({ source });
    } catch (error) {
      handleSourceLockError(res, error);
    }
  },
);

router.get(
  "/courses/:courseId/sources",
  authMiddleware,
  validateParams(sourceRouteParams),
  async (req: AuthRequest, res: Response) => {
    try {
      const courseId = req.params.courseId as string;
      const sources = await listSources(req.user!.id, courseId);
      res.json({ sources });
    } catch (error) {
      handleSourceLockError(res, error);
    }
  },
);

router.get(
  "/courses/:courseId/sources/:sourceId",
  authMiddleware,
  validateParams(sourceDetailRouteParams),
  async (req: AuthRequest, res: Response) => {
    const query = sourceRevisionQuery.safeParse(req.query);
    if (!query.success) {
      return badRequest(res, "Invalid source revision query");
    }

    try {
      const courseId = req.params.courseId as string;
      const sourceId = req.params.sourceId as string;
      const source = await getSource(
        req.user!.id,
        courseId,
        sourceId,
        query.data.revision,
      );
      return res.json({ source });
    } catch (error) {
      handleSourceLockError(res, error);
    }
  },
);

router.post(
  "/courses/:courseId/sources/:sourceId/revisions",
  authMiddleware,
  validateParams(sourceDetailRouteParams),
  validateBody(createSourceRevisionBody),
  async (req: AuthRequest, res: Response) => {
    try {
      const courseId = req.params.courseId as string;
      const sourceId = req.params.sourceId as string;
      const source = await addSourceRevision(
        req.user!.id,
        courseId,
        sourceId,
        req.body,
      );
      res.status(201).json({ source });
    } catch (error) {
      handleSourceLockError(res, error);
    }
  },
);

export default router;
