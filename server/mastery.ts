import { Router, type Response } from "express";
import { authMiddleware, type AuthRequest } from "./auth";
import { AppError, internalError } from "./lib/errors";
import { backfillCourseMastery, getCourseMastery } from "./mastery-service";

const router = Router();

function sendError(res: Response, error: unknown) {
  if (error instanceof AppError) return res.status(error.statusCode).json(error.toJSON());
  console.error("Mastery request failed:", error);
  return internalError(res, "Mastery request failed");
}

router.get("/:courseId/mastery", authMiddleware, async (req: AuthRequest, res) => {
  try { return res.json({ mastery: await getCourseMastery(req.user!.id, req.params.courseId as string) }); }
  catch (error) { return sendError(res, error); }
});

router.post("/:courseId/mastery/recalculate", authMiddleware, async (req: AuthRequest, res) => {
  try { return res.json({ mastery: await backfillCourseMastery(req.user!.id, req.params.courseId as string) }); }
  catch (error) { return sendError(res, error); }
});

export default router;
