import { Router, type NextFunction, type Response } from "express";

import { authMiddleware, type AuthRequest } from "./auth";
import { AI_RATE_LIMIT } from "./constants";
import { AppError, internalError, serviceUnavailable } from "./lib/errors";
import { IS_PRODUCTION, USE_REAL_AI } from "./lib/ai-runtime";
import {
  lectureAutopilotBody,
  lectureAutopilotJobParams,
  lectureAutopilotParams,
  lectureAutopilotRetryBody,
} from "./lib/lecture-autopilot-validation";
import { rateLimit } from "./lib/rate-limit";
import { validateBody, validateParams } from "./lib/validate";
import {
  getLectureAutopilotJob,
  retryLectureAutopilot,
  startLectureAutopilot,
} from "./lecture-autopilot-service";
import { checkUsageLimits } from "./middleware";

const router = Router();
const lectureAutopilotRateLimit = rateLimit("lecture-autopilot", AI_RATE_LIMIT);

function requireLectureAI(
  _req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  if (IS_PRODUCTION && !USE_REAL_AI) {
    serviceUnavailable(
      res,
      "AI_UNAVAILABLE",
      "Lecture Autopilot is temporarily unavailable",
    );
    return;
  }
  next();
}

function handleError(res: Response, error: unknown): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json(error.toJSON());
    return;
  }
  console.error("Lecture Autopilot request error:", error);
  internalError(res, "Lecture Autopilot request failed");
}

router.post(
  "/courses/:courseId/topics/:topicId/lecture-autopilot",
  authMiddleware,
  requireLectureAI,
  lectureAutopilotRateLimit,
  checkUsageLimits("recording"),
  checkUsageLimits("transcription"),
  validateParams(lectureAutopilotParams),
  validateBody(lectureAutopilotBody),
  async (req: AuthRequest, res: Response) => {
    try {
      const job = await startLectureAutopilot(
        req.user!.id,
        req.params.courseId as string,
        req.params.topicId as string,
        req.body,
      );
      res.status(job.status === "complete" ? 200 : 202).json({ job });
    } catch (error) {
      handleError(res, error);
    }
  },
);

router.get(
  "/jobs/:jobId",
  authMiddleware,
  validateParams(lectureAutopilotJobParams),
  async (req: AuthRequest, res: Response) => {
    try {
      const job = await getLectureAutopilotJob(
        req.user!.id,
        req.params.jobId as string,
      );
      res.json({ job });
    } catch (error) {
      handleError(res, error);
    }
  },
);

router.post(
  "/jobs/:jobId/retry",
  authMiddleware,
  requireLectureAI,
  lectureAutopilotRateLimit,
  validateParams(lectureAutopilotJobParams),
  validateBody(lectureAutopilotRetryBody),
  async (req: AuthRequest, res: Response) => {
    try {
      const job = await retryLectureAutopilot(
        req.user!.id,
        req.params.jobId as string,
        req.body.audioBase64,
      );
      res.status(job.status === "complete" ? 200 : 202).json({ job });
    } catch (error) {
      handleError(res, error);
    }
  },
);

export default router;
