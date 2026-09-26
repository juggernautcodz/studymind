import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import prisma from "./db";
import { rateLimit } from "./lib/rate-limit";

const router = Router();

const loginRateLimit = rateLimit("auth-login", {
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
  message: "Too many login attempts. Please try again in 15 minutes.",
});
const signupRateLimit = rateLimit("auth-signup", {
  windowMs: 15 * 60 * 1000,
  maxRequests: 5,
  message: "Too many signup attempts. Please try again in 15 minutes.",
});
const passwordResetRateLimit = rateLimit("auth-password-reset", {
  windowMs: 15 * 60 * 1000,
  maxRequests: 5,
  message: "Too many password reset attempts. Please try again in 15 minutes.",
});

const JWT_SECRET = (() => {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "[Auth] SESSION_SECRET env var must be set in production. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
      );
    }
    console.warn(
      "[Auth] SESSION_SECRET not set — using insecure default for development only.",
    );
    return "studymind-dev-only-not-for-production";
  }
  return secret;
})();

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
  };
}

export const authMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true },
    });

    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid token" });
  }
};

export const optionalAuthMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next();
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true },
    });

    if (user) {
      req.user = user;
    }
  } catch (error) {
    // Token invalid, continue without auth
  }

  next();
};

import { ANONYMOUS_USER_ID } from "./constants";
import { ensureAnonymousUserExists } from "./guest-provisioning";

async function continueAsGuest(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    await ensureAnonymousUserExists();
    req.user = {
      id: ANONYMOUS_USER_ID,
      email: "guest@studymind.app",
    };
    return next();
  } catch (error) {
    console.error("Guest provisioning failed:", error);
    return res.status(503).json({
      error: "Guest mode is temporarily unavailable",
      code: "GUEST_UNAVAILABLE",
    });
  }
}

export const guestOrAuthMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return continueAsGuest(req, res, next);
  }

  const token = authHeader.substring(7);

  if (
    !token ||
    token === "guest-token" ||
    token.startsWith("guest_token_") ||
    token.startsWith("guest-token")
  ) {
    return continueAsGuest(req, res, next);
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true },
    });

    if (!user) {
      return continueAsGuest(req, res, next);
    }

    req.user = user;
    next();
  } catch (error) {
    // Token invalid, fall back to guest
    return continueAsGuest(req, res, next);
  }
};

router.post("/signup", signupRateLimit, async (req: Request, res: Response) => {
  try {
    const { password, name } = req.body;
    const email = typeof req.body.email === "string" ? req.body.email.toLowerCase() : req.body.email;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const reviewerEmail = process.env.REVIEWER_EMAIL;
    if (reviewerEmail && email === reviewerEmail.toLowerCase()) {
      // Reviewer accounts are provisioned out-of-band, never via public signup —
      // return the same error a normal duplicate-email signup would get.
      return res.status(400).json({ error: "Email already registered" });
    }

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    let user;

    if (existingUser) {
      // If user exists and has a password hash, they are registered
      if (existingUser.passwordHash !== "") {
        return res.status(400).json({ error: "Email already registered" });
      }

      // If user exists but has empty password hash (Stripe placeholder account),
      // we update and claim this account!
      const passwordHash = await bcrypt.hash(password, 10);
      user = await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          passwordHash,
          name: name || null,
        },
      });
      console.log(`[Auth Signup] Placeholder user ${email} upgraded to fully registered account.`);
    } else {
      const passwordHash = await bcrypt.hash(password, 10);
      user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          name: name || null,
        },
      });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, {
      expiresIn: "30d",
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({ error: "Failed to create account" });
  }
});

router.post("/login", loginRateLimit, async (req: Request, res: Response) => {
  try {
    const { password } = req.body;
    const email = typeof req.body.email === "string" ? req.body.email.toLowerCase() : req.body.email;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);

    if (!isValidPassword) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, {
      expiresIn: "30d",
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Failed to log in" });
  }
});

router.get("/me", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ user });
  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({ error: "Failed to get user" });
  }
});

router.put(
  "/profile",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const { name } = req.body;

      const user = await prisma.user.update({
        where: { id: req.user!.id },
        data: { name },
        select: {
          id: true,
          email: true,
          name: true,
        },
      });

      res.json({ user });
    } catch (error) {
      console.error("Update profile error:", error);
      res.status(500).json({ error: "Failed to update profile" });
    }
  },
);

router.delete(
  "/data",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.quizAttempt.deleteMany({ where: { userId } });
        await tx.quizQuestion.deleteMany({
          where: { quiz: { topic: { userId } } },
        });
        await tx.quiz.deleteMany({ where: { topic: { userId } } });
        await tx.flashcardStat.deleteMany({ where: { userId } });
        await tx.flashcard.deleteMany({ where: { topic: { userId } } });
        await tx.recording.deleteMany({ where: { userId } });
        await tx.whiteboardImage.deleteMany({ where: { topic: { userId } } });
        await tx.mindmapNode.deleteMany({ where: { userId } });
        await tx.topic.deleteMany({ where: { userId } });
        await tx.course.deleteMany({ where: { userId } });
        await tx.semester.deleteMany({ where: { userId } });
        await tx.exam.deleteMany({ where: { userId } });
        await tx.job.deleteMany({ where: { userId } });
        await tx.usage.deleteMany({ where: { userId } });
      });

      res.json({
        success: true,
        message: "All study data has been permanently deleted",
      });
    } catch (error) {
      console.error("Data deletion error:", error);
      res.status(500).json({ error: "Failed to delete data" });
    }
  },
);

router.delete(
  "/account",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.quizAttempt.deleteMany({ where: { userId } });
        await tx.quizQuestion.deleteMany({
          where: { quiz: { topic: { userId } } },
        });
        await tx.quiz.deleteMany({ where: { topic: { userId } } });
        await tx.flashcardStat.deleteMany({ where: { userId } });
        await tx.flashcard.deleteMany({ where: { topic: { userId } } });
        await tx.recording.deleteMany({ where: { userId } });
        await tx.whiteboardImage.deleteMany({ where: { topic: { userId } } });
        await tx.mindmapNode.deleteMany({ where: { userId } });
        await tx.topic.deleteMany({ where: { userId } });
        await tx.course.deleteMany({ where: { userId } });
        await tx.semester.deleteMany({ where: { userId } });
        await tx.exam.deleteMany({ where: { userId } });
        await tx.job.deleteMany({ where: { userId } });
        await tx.purchase.deleteMany({ where: { userId } });
        await tx.subscriptionStatus.deleteMany({ where: { userId } });
        await tx.usage.deleteMany({ where: { userId } });
        await tx.entitlement.deleteMany({ where: { userId } });
        await tx.user.delete({ where: { id: userId } });
      });

      res.json({
        success: true,
        message:
          "Account and all associated data have been permanently deleted",
      });
    } catch (error) {
      console.error("Account deletion error:", error);
      res.status(500).json({ error: "Failed to delete account" });
    }
  },
);

router.get(
  "/export",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;

      const [
        user,
        semesters,
        courses,
        topics,
        recordings,
        flashcards,
        quizzes,
        quizAttempts,
        jobs,
        purchases,
        entitlement,
        sources,
        generationRuns,
        concepts,
        conceptMasteries,
        masteryEvents,
        exams,
      ] =
        await Promise.all([
          prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, email: true, name: true, createdAt: true },
          }),
          prisma.semester.findMany({ where: { userId } }),
          prisma.course.findMany({ where: { userId }, select: { id: true, semesterId: true, name: true, color: true, createdAt: true } }),
          prisma.topic.findMany({
            where: { userId },
            select: {
              id: true,
              courseId: true,
              name: true,
              status: true,
              transcript: true,
              notes: true,
              createdAt: true,
            },
          }),
          prisma.recording.findMany({
            where: { userId },
            select: {
              id: true,
              topicId: true,
              filename: true,
              durationSeconds: true,
              transcriptStatus: true,
              transcript: true,
              createdAt: true,
            },
          }),
          prisma.flashcard.findMany({
            where: { topic: { userId } },
            select: { id: true, topicId: true, front: true, back: true, createdAt: true },
          }),
          prisma.quiz.findMany({
            where: { topic: { userId } },
            include: { questions: { orderBy: { orderIndex: "asc" } } },
          }),
          prisma.quizAttempt.findMany({
            where: { userId },
            select: { id: true, quizId: true, score: true, totalQuestions: true, completedAt: true },
          }),
          prisma.job.findMany({
            where: { userId },
            select: {
              id: true,
              type: true,
              status: true,
              input: true,
              output: true,
              error: true,
              createdAt: true,
              updatedAt: true,
            },
          }),
          prisma.purchase.findMany({
            where: { userId },
            select: { id: true, platform: true, productId: true, verifiedAt: true, createdAt: true },
          }),
          prisma.entitlement.findUnique({
            where: { userId },
            select: { plan: true, expiresAt: true, source: true },
          }),
          // Follow-up: stream/page SourceLock data if revision volume makes the
          // complete privacy export too large to safely hold in memory.
          prisma.source.findMany({
            where: { course: { userId } },
            include: {
              revisions: {
                orderBy: { revision: "asc" },
                include: {
                  segments: {
                    orderBy: { position: "asc" },
                    include: { citations: true },
                  },
                },
              },
            },
          }),
          prisma.generationRun.findMany({
            where: { course: { userId } },
            orderBy: { createdAt: "asc" },
          }),
          prisma.concept.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
          prisma.conceptMastery.findMany({ where: { userId }, orderBy: { updatedAt: "asc" } }),
          prisma.masteryEvent.findMany({ where: { userId }, orderBy: { occurredAt: "asc" } }),
          prisma.exam.findMany({
            where: { userId },
            orderBy: { examDate: "asc" },
            include: {
              conceptScopes: {
                orderBy: { createdAt: "asc" },
                select: { conceptId: true, createdAt: true },
              },
            },
          }),
        ]);

      res.setHeader("Content-Disposition", `attachment; filename="studymind-export-${userId}.json"`);
      res.json({
        exportedAt: new Date().toISOString(),
        profile: user,
        entitlement: entitlement ?? { plan: "FREE", source: "free" },
        semesters,
        courses,
        topics,
        recordings,
        flashcards,
        quizzes,
        quizAttempts,
        jobs,
        purchases,
        sources,
        generationRuns,
        concepts,
        conceptMasteries,
        masteryEvents,
        exams,
      });
    } catch (error) {
      console.error("Data export error:", error);
      res.status(500).json({ error: "Failed to export data" });
    }
  },
);

async function sendPasswordResetEmail(email: string, code: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "[Auth] RESEND_API_KEY env var must be set in production — refusing to log reset codes to server logs.",
      );
    }
    console.log(`[Auth] Password reset code for ${email}: ${code}`);
    return;
  }
  const from = process.env.EMAIL_FROM || "noreply@studymind.app";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from,
      to: email,
      subject: "Your StudyMind password reset code",
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
          <h2>Reset your password</h2>
          <p>Your 6-digit reset code is:</p>
          <div style="font-size:32px;font-weight:bold;letter-spacing:8px;padding:16px 0">${code}</div>
          <p>This code expires in 1 hour. If you didn't request a reset, you can ignore this email.</p>
        </div>
      `,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error("[Auth] Resend API error:", body);
    throw new Error("Failed to send reset email");
  }
}

router.post("/forgot-password", passwordResetRateLimit, async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

    // Always return 200 — never leak whether the email exists
    if (!user) {
      return res.json({ message: "If that email is registered, a reset code was sent" });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const tokenHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await prisma.passwordResetToken.deleteMany({ where: { email: user.email } });
    await prisma.passwordResetToken.create({
      data: { email: user.email, tokenHash, expiresAt },
    });

    await sendPasswordResetEmail(user.email, code);

    res.json({ message: "If that email is registered, a reset code was sent" });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ error: "Failed to send reset code" });
  }
});

router.post("/reset-password", async (req: Request, res: Response) => {
  try {
    const { email, code, newPassword } = req.body;

    if (!email || !code || !newPassword) {
      return res
        .status(400)
        .json({ error: "Email, code, and new password are required" });
    }

    if (newPassword.length < 8) {
      return res
        .status(400)
        .json({ error: "Password must be at least 8 characters" });
    }

    const resetToken = await prisma.passwordResetToken.findFirst({
      where: { email: email.toLowerCase(), usedAt: null },
      orderBy: { createdAt: "desc" },
    });

    const invalid =
      !resetToken ||
      resetToken.expiresAt < new Date() ||
      !(await bcrypt.compare(String(code).trim(), resetToken.tokenHash));

    if (invalid) {
      return res.status(400).json({ error: "Invalid or expired reset code" });
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) {
      return res.status(400).json({ error: "Invalid or expired reset code" });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await prisma.$transaction([
      prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash },
      }),
    ]);

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "30d" });

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ error: "Failed to reset password" });
  }
});

export default router;
