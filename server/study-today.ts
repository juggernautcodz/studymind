import { Router, type Response } from "express";

import { authMiddleware, type AuthRequest } from "./auth";
import { internalError } from "./lib/errors";
import { getStudyToday } from "./study-today-service";

const router = Router();

router.get(
  "/study-today",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const studyToday = await getStudyToday(req.user!.id);
      return res.json({ studyToday });
    } catch (error) {
      console.error("Study Today request failed:", error);
      return internalError(res, "Study Today request failed");
    }
  },
);

export default router;
