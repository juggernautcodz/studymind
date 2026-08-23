import { Router, Request, Response } from "express";
import { authMiddleware, AuthRequest } from "./auth";
import { exportUserData, exportTopic } from "./lib/sync";

const router = Router();

/**
 * GET /api/sync/export
 * Returns all study data for the authenticated user.
 * Supports ?since=ISO_TIMESTAMP for incremental sync.
 *
 * Used by the StudyMind Web PC companion.
 */
router.get("/export", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const sinceParam = req.query.since as string | undefined;
    const since = sinceParam ? new Date(sinceParam) : undefined;

    if (sinceParam && isNaN(since!.getTime())) {
      return res.status(400).json({ error: "Invalid 'since' timestamp. Use ISO 8601 format." });
    }

    const data = await exportUserData(userId, since);
    res.json(data);
  } catch (err) {
    console.error("[sync/export] error:", err);
    res.status(500).json({ error: "Failed to export study data" });
  }
});

/**
 * GET /api/sync/topic/:id
 * Returns a single topic with all flashcards, quizzes, recordings.
 * Used for lazy-loading on the PC topic viewer.
 */
router.get("/topic/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const topicId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const topic = await exportTopic(topicId, userId);

    if (!topic) {
      return res.status(404).json({ error: "Topic not found" });
    }

    res.json(topic);
  } catch (err) {
    console.error("[sync/topic] error:", err);
    res.status(500).json({ error: "Failed to load topic" });
  }
});

/**
 * GET /api/sync/status
 * Returns a lightweight health + data count summary.
 * Used by the web app to show last-sync time without fetching everything.
 */
router.get("/status", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const data = await exportUserData(userId);
    res.json({
      ok: true,
      counts: data.counts,
      exportedAt: data.exportedAt,
    });
  } catch (err) {
    res.status(500).json({ error: "Sync status check failed" });
  }
});

export default router;
