import { Router, Response } from "express";
import prisma from "./db";
import { authMiddleware, AuthRequest } from "./auth";

const router = Router();

router.post(
  "/register",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const { token } = req.body;
      if (!token || typeof token !== "string") {
        return res.status(400).json({ error: "Push token is required" });
      }

      await prisma.user.update({
        where: { id: req.user!.id },
        data: { pushToken: token },
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Failed to register push token:", error);
      res.status(500).json({ error: "Failed to register push token" });
    }
  },
);

router.delete(
  "/register",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      await prisma.user.update({
        where: { id: req.user!.id },
        data: { pushToken: null },
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to unregister push token" });
    }
  },
);

export default router;
