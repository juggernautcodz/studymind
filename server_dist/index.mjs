var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/db.ts
import pkg from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
function getDatabaseUrl() {
  const url = process.env.SQLITE_DATABASE_URL || process.env.DATABASE_URL || "file:./prisma/dev.db";
  if (/^postgres(ql)?:\/\//i.test(url)) {
    throw new Error(
      `SQLite app detected a Postgres DATABASE_URL.
Set SQLITE_DATABASE_URL to a file: URL (e.g. file:./prisma/dev.db).
Got: ${url}`
    );
  }
  if (!/^file:/i.test(url)) {
    throw new Error(`SQLite datasource URL must start with "file:". Got: ${url}`);
  }
  return url;
}
var PrismaClient, databaseUrl, adapter, globalForPrisma, prisma, db_default;
var init_db = __esm({
  "server/db.ts"() {
    "use strict";
    ({ PrismaClient } = pkg);
    databaseUrl = getDatabaseUrl();
    adapter = new PrismaBetterSqlite3({ url: databaseUrl });
    globalForPrisma = globalThis;
    prisma = globalForPrisma.prisma ?? new PrismaClient({
      adapter,
      log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"]
    });
    if (process.env.NODE_ENV !== "production") {
      globalForPrisma.prisma = prisma;
    }
    db_default = prisma;
  }
});

// server/lib/rate-limit.ts
function getStore(name) {
  let store = stores.get(name);
  if (!store) {
    store = /* @__PURE__ */ new Map();
    stores.set(name, store);
  }
  return store;
}
function rateLimit(name, config) {
  const { windowMs, maxRequests, message } = config;
  const store = getStore(name);
  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of store) {
      if (record.resetAt <= now) {
        store.delete(key);
      }
    }
  }, windowMs);
  return (req, res, next) => {
    const key = req.user?.id || req.ip || "unknown";
    const now = Date.now();
    let record = store.get(key);
    if (!record || record.resetAt <= now) {
      record = { count: 0, resetAt: now + windowMs };
      store.set(key, record);
    }
    record.count++;
    res.setHeader("X-RateLimit-Limit", String(maxRequests));
    res.setHeader(
      "X-RateLimit-Remaining",
      String(Math.max(0, maxRequests - record.count))
    );
    res.setHeader(
      "X-RateLimit-Reset",
      String(Math.ceil(record.resetAt / 1e3))
    );
    if (record.count > maxRequests) {
      const retryAfter = Math.ceil((record.resetAt - now) / 1e3);
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message: message || "Too many requests. Please try again later.",
          retryAfterSeconds: retryAfter
        }
      });
    }
    next();
  };
}
var stores;
var init_rate_limit = __esm({
  "server/lib/rate-limit.ts"() {
    "use strict";
    stores = /* @__PURE__ */ new Map();
  }
});

// server/constants.ts
var ANONYMOUS_USER_ID, AI_RATE_LIMIT, TRANSCRIPTION_RATE_LIMIT;
var init_constants = __esm({
  "server/constants.ts"() {
    "use strict";
    ANONYMOUS_USER_ID = "anonymous-guest-user";
    AI_RATE_LIMIT = {
      windowMs: 6e4,
      maxRequests: 10
    };
    TRANSCRIPTION_RATE_LIMIT = {
      windowMs: 6e4,
      maxRequests: 5
    };
  }
});

// server/auth.ts
var auth_exports = {};
__export(auth_exports, {
  authMiddleware: () => authMiddleware,
  default: () => auth_default,
  guestOrAuthMiddleware: () => guestOrAuthMiddleware,
  optionalAuthMiddleware: () => optionalAuthMiddleware
});
import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
async function sendPasswordResetEmail(email, code) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "[Auth] RESEND_API_KEY env var must be set in production \u2014 refusing to log reset codes to server logs."
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
      Authorization: `Bearer ${apiKey}`
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
      `
    })
  });
  if (!res.ok) {
    const body = await res.text();
    console.error("[Auth] Resend API error:", body);
    throw new Error("Failed to send reset email");
  }
}
var router, loginRateLimit, signupRateLimit, passwordResetRateLimit, JWT_SECRET, authMiddleware, optionalAuthMiddleware, guestOrAuthMiddleware, auth_default;
var init_auth = __esm({
  "server/auth.ts"() {
    "use strict";
    init_db();
    init_rate_limit();
    init_constants();
    router = Router();
    loginRateLimit = rateLimit("auth-login", {
      windowMs: 15 * 60 * 1e3,
      maxRequests: 10,
      message: "Too many login attempts. Please try again in 15 minutes."
    });
    signupRateLimit = rateLimit("auth-signup", {
      windowMs: 15 * 60 * 1e3,
      maxRequests: 5,
      message: "Too many signup attempts. Please try again in 15 minutes."
    });
    passwordResetRateLimit = rateLimit("auth-password-reset", {
      windowMs: 15 * 60 * 1e3,
      maxRequests: 5,
      message: "Too many password reset attempts. Please try again in 15 minutes."
    });
    JWT_SECRET = (() => {
      const secret = process.env.SESSION_SECRET;
      if (!secret) {
        if (process.env.NODE_ENV === "production") {
          throw new Error(
            `[Auth] SESSION_SECRET env var must be set in production. Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
          );
        }
        console.warn(
          "[Auth] SESSION_SECRET not set \u2014 using insecure default for development only."
        );
        return "studymind-dev-only-not-for-production";
      }
      return secret;
    })();
    authMiddleware = async (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "No token provided" });
      }
      const token = authHeader.substring(7);
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await db_default.user.findUnique({
          where: { id: decoded.userId },
          select: { id: true, email: true }
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
    optionalAuthMiddleware = async (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return next();
      }
      const token = authHeader.substring(7);
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await db_default.user.findUnique({
          where: { id: decoded.userId },
          select: { id: true, email: true }
        });
        if (user) {
          req.user = user;
        }
      } catch (error) {
      }
      next();
    };
    guestOrAuthMiddleware = async (req, res, next) => {
      const authHeader = req.headers.authorization;
      const guestUser = {
        id: ANONYMOUS_USER_ID,
        email: "guest@studymind.app"
      };
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        req.user = guestUser;
        return next();
      }
      const token = authHeader.substring(7);
      if (!token || token === "guest-token" || token.startsWith("guest_token_") || token.startsWith("guest-token")) {
        req.user = guestUser;
        return next();
      }
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await db_default.user.findUnique({
          where: { id: decoded.userId },
          select: { id: true, email: true }
        });
        if (!user) {
          req.user = guestUser;
          return next();
        }
        req.user = user;
        next();
      } catch (error) {
        req.user = {
          id: ANONYMOUS_USER_ID,
          email: "guest@studymind.app"
        };
        next();
      }
    };
    router.post("/signup", signupRateLimit, async (req, res) => {
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
          return res.status(400).json({ error: "Email already registered" });
        }
        const existingUser = await db_default.user.findUnique({
          where: { email }
        });
        let user;
        if (existingUser) {
          if (existingUser.passwordHash !== "") {
            return res.status(400).json({ error: "Email already registered" });
          }
          const passwordHash = await bcrypt.hash(password, 10);
          user = await db_default.user.update({
            where: { id: existingUser.id },
            data: {
              passwordHash,
              name: name || null
            }
          });
          console.log(`[Auth Signup] Placeholder user ${email} upgraded to fully registered account.`);
        } else {
          const passwordHash = await bcrypt.hash(password, 10);
          user = await db_default.user.create({
            data: {
              email,
              passwordHash,
              name: name || null
            }
          });
        }
        const token = jwt.sign({ userId: user.id }, JWT_SECRET, {
          expiresIn: "30d"
        });
        res.json({
          token,
          user: {
            id: user.id,
            email: user.email,
            name: user.name
          }
        });
      } catch (error) {
        console.error("Signup error:", error);
        res.status(500).json({ error: "Failed to create account" });
      }
    });
    router.post("/login", loginRateLimit, async (req, res) => {
      try {
        const { password } = req.body;
        const email = typeof req.body.email === "string" ? req.body.email.toLowerCase() : req.body.email;
        if (!email || !password) {
          return res.status(400).json({ error: "Email and password are required" });
        }
        const user = await db_default.user.findUnique({
          where: { email }
        });
        if (!user) {
          return res.status(401).json({ error: "Invalid email or password" });
        }
        const isValidPassword = await bcrypt.compare(password, user.passwordHash);
        if (!isValidPassword) {
          return res.status(401).json({ error: "Invalid email or password" });
        }
        const token = jwt.sign({ userId: user.id }, JWT_SECRET, {
          expiresIn: "30d"
        });
        res.json({
          token,
          user: {
            id: user.id,
            email: user.email,
            name: user.name
          }
        });
      } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ error: "Failed to log in" });
      }
    });
    router.get("/me", authMiddleware, async (req, res) => {
      try {
        const user = await db_default.user.findUnique({
          where: { id: req.user.id },
          select: {
            id: true,
            email: true,
            name: true,
            createdAt: true
          }
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
      async (req, res) => {
        try {
          const { name } = req.body;
          const user = await db_default.user.update({
            where: { id: req.user.id },
            data: { name },
            select: {
              id: true,
              email: true,
              name: true
            }
          });
          res.json({ user });
        } catch (error) {
          console.error("Update profile error:", error);
          res.status(500).json({ error: "Failed to update profile" });
        }
      }
    );
    router.delete(
      "/data",
      guestOrAuthMiddleware,
      async (req, res) => {
        try {
          const userId = req.user.id;
          await db_default.$transaction(async (tx) => {
            await tx.quizAttempt.deleteMany({ where: { userId } });
            await tx.quizQuestion.deleteMany({
              where: { quiz: { topic: { userId } } }
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
            message: "All study data has been permanently deleted"
          });
        } catch (error) {
          console.error("Data deletion error:", error);
          res.status(500).json({ error: "Failed to delete data" });
        }
      }
    );
    router.delete(
      "/account",
      guestOrAuthMiddleware,
      async (req, res) => {
        try {
          const userId = req.user.id;
          await db_default.$transaction(async (tx) => {
            await tx.quizAttempt.deleteMany({ where: { userId } });
            await tx.quizQuestion.deleteMany({
              where: { quiz: { topic: { userId } } }
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
            message: "Account and all associated data have been permanently deleted"
          });
        } catch (error) {
          console.error("Account deletion error:", error);
          res.status(500).json({ error: "Failed to delete account" });
        }
      }
    );
    router.get(
      "/export",
      authMiddleware,
      async (req, res) => {
        try {
          const userId = req.user.id;
          const [user, semesters, courses, topics, flashcards, quizAttempts, purchases, entitlement] = await Promise.all([
            db_default.user.findUnique({
              where: { id: userId },
              select: { id: true, email: true, name: true, createdAt: true }
            }),
            db_default.semester.findMany({ where: { userId } }),
            db_default.course.findMany({ where: { userId }, select: { id: true, semesterId: true, name: true, color: true, createdAt: true } }),
            db_default.topic.findMany({
              where: { userId },
              select: { id: true, courseId: true, name: true, status: true, notes: true, createdAt: true }
            }),
            db_default.flashcard.findMany({
              where: { topic: { userId } },
              select: { id: true, topicId: true, front: true, back: true, createdAt: true }
            }),
            db_default.quizAttempt.findMany({
              where: { userId },
              select: { id: true, quizId: true, score: true, totalQuestions: true, completedAt: true }
            }),
            db_default.purchase.findMany({
              where: { userId },
              select: { id: true, platform: true, productId: true, verifiedAt: true, createdAt: true }
            }),
            db_default.entitlement.findUnique({
              where: { userId },
              select: { plan: true, expiresAt: true, source: true }
            })
          ]);
          res.setHeader("Content-Disposition", `attachment; filename="studymind-export-${userId}.json"`);
          res.json({
            exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
            profile: user,
            entitlement: entitlement ?? { plan: "FREE", source: "free" },
            semesters,
            courses,
            topics,
            flashcards,
            quizAttempts,
            purchases
          });
        } catch (error) {
          console.error("Data export error:", error);
          res.status(500).json({ error: "Failed to export data" });
        }
      }
    );
    router.post("/forgot-password", passwordResetRateLimit, async (req, res) => {
      try {
        const { email } = req.body;
        if (!email) {
          return res.status(400).json({ error: "Email is required" });
        }
        const user = await db_default.user.findUnique({ where: { email: email.toLowerCase() } });
        if (!user) {
          return res.json({ message: "If that email is registered, a reset code was sent" });
        }
        const code = String(Math.floor(1e5 + Math.random() * 9e5));
        const tokenHash = await bcrypt.hash(code, 10);
        const expiresAt = new Date(Date.now() + 60 * 60 * 1e3);
        await db_default.passwordResetToken.deleteMany({ where: { email: user.email } });
        await db_default.passwordResetToken.create({
          data: { email: user.email, tokenHash, expiresAt }
        });
        await sendPasswordResetEmail(user.email, code);
        res.json({ message: "If that email is registered, a reset code was sent" });
      } catch (error) {
        console.error("Forgot password error:", error);
        res.status(500).json({ error: "Failed to send reset code" });
      }
    });
    router.post("/reset-password", async (req, res) => {
      try {
        const { email, code, newPassword } = req.body;
        if (!email || !code || !newPassword) {
          return res.status(400).json({ error: "Email, code, and new password are required" });
        }
        if (newPassword.length < 8) {
          return res.status(400).json({ error: "Password must be at least 8 characters" });
        }
        const resetToken = await db_default.passwordResetToken.findFirst({
          where: { email: email.toLowerCase(), usedAt: null },
          orderBy: { createdAt: "desc" }
        });
        const invalid = !resetToken || resetToken.expiresAt < /* @__PURE__ */ new Date() || !await bcrypt.compare(String(code).trim(), resetToken.tokenHash);
        if (invalid) {
          return res.status(400).json({ error: "Invalid or expired reset code" });
        }
        const user = await db_default.user.findUnique({ where: { email: email.toLowerCase() } });
        if (!user) {
          return res.status(400).json({ error: "Invalid or expired reset code" });
        }
        const passwordHash = await bcrypt.hash(newPassword, 10);
        await db_default.$transaction([
          db_default.passwordResetToken.update({
            where: { id: resetToken.id },
            data: { usedAt: /* @__PURE__ */ new Date() }
          }),
          db_default.user.update({
            where: { id: user.id },
            data: { passwordHash }
          })
        ]);
        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "30d" });
        res.json({
          token,
          user: { id: user.id, email: user.email, name: user.name }
        });
      } catch (error) {
        console.error("Reset password error:", error);
        res.status(500).json({ error: "Failed to reset password" });
      }
    });
    auth_default = router;
  }
});

// server/study.ts
var study_exports = {};
__export(study_exports, {
  default: () => study_default,
  ensureAnonymousUserExists: () => ensureAnonymousUserExists
});
import { Router as Router2 } from "express";
function getUserId(req) {
  return req.user?.id || ANONYMOUS_USER_ID;
}
async function ensureAnonymousUserExists() {
  try {
    let existingUser = await db_default.user.findUnique({
      where: { id: ANONYMOUS_USER_ID }
    });
    if (!existingUser) {
      await db_default.user.create({
        data: {
          id: ANONYMOUS_USER_ID,
          email: "guest@studymind.local",
          passwordHash: "guest-no-login",
          name: "Guest User"
        }
      });
      const semester = await db_default.semester.create({
        data: {
          userId: ANONYMOUS_USER_ID,
          name: "My Semester"
        }
      });
      const course = await db_default.course.create({
        data: {
          userId: ANONYMOUS_USER_ID,
          semesterId: semester.id,
          name: "My Course"
        }
      });
      const topic = await db_default.topic.create({
        data: {
          userId: ANONYMOUS_USER_ID,
          courseId: course.id,
          name: "Introduction to Photosynthesis",
          orderIndex: 0,
          transcript: "Today we'll explore photosynthesis, the process by which plants convert sunlight into energy.",
          notes: "# Photosynthesis Overview",
          status: "completed"
        }
      });
      await db_default.flashcard.createMany({
        data: [
          {
            topicId: topic.id,
            front: "What is photosynthesis?",
            back: "Plants converting sunlight into energy.",
            orderIndex: 0
          }
        ]
      });
      console.log("Created anonymous guest demo content");
    }
  } catch (error) {
    console.error("Failed to create anonymous user:", error);
  }
}
var router2, study_default;
var init_study = __esm({
  "server/study.ts"() {
    "use strict";
    init_db();
    init_auth();
    init_constants();
    router2 = Router2();
    router2.get("/guest/demo-data", async (_req, res) => {
      try {
        const topic = await db_default.topic.findFirst({
          where: { userId: ANONYMOUS_USER_ID },
          include: {
            course: {
              include: { semester: true }
            }
          }
        });
        if (!topic) {
          return res.status(404).json({ error: "Demo data not found" });
        }
        res.json({
          topicId: topic.id,
          topicName: topic.name,
          courseId: topic.course.id,
          courseName: topic.course.name,
          semesterId: topic.course.semester.id,
          semesterName: topic.course.semester.name
        });
      } catch (error) {
        console.error("Get guest demo data error:", error);
        res.status(500).json({ error: "Failed to get demo data" });
      }
    });
    router2.get(
      "/semesters",
      guestOrAuthMiddleware,
      async (req, res) => {
        try {
          const semesters = await db_default.semester.findMany({
            where: { userId: getUserId(req) },
            include: {
              courses: {
                include: {
                  topics: true
                }
              }
            },
            orderBy: { createdAt: "desc" }
          });
          res.json({ semesters });
        } catch (error) {
          console.error("Get semesters error:", error);
          res.status(500).json({ error: "Failed to get semesters", details: String(error) });
        }
      }
    );
    router2.post(
      "/semesters",
      guestOrAuthMiddleware,
      async (req, res) => {
        try {
          const { id, name, startDate, endDate } = req.body || {};
          if (!name) {
            return res.status(400).json({ error: "Name is required" });
          }
          const userId = req.user?.id || ANONYMOUS_USER_ID;
          if (id) {
            const existing = await db_default.semester.findFirst({
              where: { id, userId }
            });
            if (existing) {
              return res.json({ semester: existing });
            }
          }
          const semester = await db_default.semester.create({
            data: {
              ...id ? { id } : {},
              userId,
              name,
              startDate: startDate ? new Date(startDate) : null,
              endDate: endDate ? new Date(endDate) : null
            }
          });
          console.log("[Semester created]", semester.id);
          res.json({ semester });
        } catch (error) {
          console.error("Create semester error:", error);
          res.status(500).json({
            error: "Failed to create semester",
            details: String(error)
          });
        }
      }
    );
    router2.get(
      "/courses",
      guestOrAuthMiddleware,
      async (req, res) => {
        try {
          const { semesterId } = req.query;
          const courses = await db_default.course.findMany({
            where: {
              userId: getUserId(req),
              ...semesterId && { semesterId }
            },
            include: {
              topics: true
            }
          });
          res.json({ courses });
        } catch (error) {
          console.error("Get courses error:", error);
          res.status(500).json({ error: "Failed to get courses", details: String(error) });
        }
      }
    );
    router2.post(
      "/courses",
      guestOrAuthMiddleware,
      async (req, res) => {
        try {
          const { id, name, semesterId, color } = req.body || {};
          if (!name || !semesterId) {
            return res.status(400).json({ error: "Name and semesterId are required" });
          }
          const userId = req.user?.id || ANONYMOUS_USER_ID;
          if (id) {
            const existing = await db_default.course.findFirst({ where: { id, userId } });
            if (existing) return res.json({ course: existing });
          }
          const course = await db_default.course.create({
            data: {
              ...id ? { id } : {},
              userId,
              semesterId,
              name,
              color: color || null
            }
          });
          console.log("[Course created]", course.id);
          res.json({ course });
        } catch (error) {
          console.error("Create course error:", error);
          res.status(500).json({ error: "Failed to create course", details: String(error) });
        }
      }
    );
    router2.get(
      "/topics",
      guestOrAuthMiddleware,
      async (req, res) => {
        try {
          const { courseId } = req.query;
          const userId = req.user?.id || ANONYMOUS_USER_ID;
          const topics = await db_default.topic.findMany({
            where: {
              userId,
              ...courseId ? { courseId } : {}
            },
            orderBy: { orderIndex: "asc" }
          });
          res.json({ topics });
        } catch (error) {
          console.error("Get topics error:", error);
          res.status(500).json({ error: "Failed to get topics", details: String(error) });
        }
      }
    );
    router2.post(
      "/topics",
      guestOrAuthMiddleware,
      async (req, res) => {
        try {
          const { id, name, courseId } = req.body || {};
          if (!name || !courseId) {
            return res.status(400).json({ error: "Name and courseId are required" });
          }
          const userId = req.user?.id || ANONYMOUS_USER_ID;
          if (id) {
            const existing = await db_default.topic.findFirst({ where: { id, userId } });
            if (existing) return res.json({ topic: existing });
          }
          const maxOrder = await db_default.topic.findFirst({
            where: { courseId },
            orderBy: { orderIndex: "desc" },
            select: { orderIndex: true }
          });
          const topic = await db_default.topic.create({
            data: {
              ...id ? { id } : {},
              userId,
              courseId,
              name,
              orderIndex: (maxOrder?.orderIndex ?? -1) + 1
            }
          });
          console.log("[Topic created]", topic.id);
          res.json({ topic });
        } catch (error) {
          console.error("Create topic error:", error);
          res.status(500).json({ error: "Failed to create topic", details: String(error) });
        }
      }
    );
    study_default = router2;
  }
});

// server/billing/iosReceiptValidator.ts
async function verifyIosReceipt(receiptData, productId) {
  const allowTestReceipts = process.env.NODE_ENV !== "production";
  if (allowTestReceipts && (receiptData === "TEST_RECEIPT" || receiptData.startsWith("TEST_RECEIPT_"))) {
    const testProductId = productId || "com.studymind.pro.monthly";
    const productConfig = TEST_PRODUCTS[testProductId];
    if (!productConfig) {
      return {
        valid: false,
        productId: null,
        expiresAt: null,
        status: "invalid",
        originalTransactionId: null,
        isSubscription: false,
        error: "Unknown product ID"
      };
    }
    const expiresAt = productConfig.isSubscription ? new Date(
      Date.now() + ("durationDays" in productConfig ? productConfig.durationDays : 30) * 24 * 60 * 60 * 1e3
    ) : null;
    return {
      valid: true,
      productId: testProductId,
      expiresAt,
      status: "active",
      originalTransactionId: `TEST_TXN_${Date.now()}`,
      isSubscription: productConfig.isSubscription
    };
  }
  console.warn(
    "[iOS Validator] Production validation not implemented. Rejecting receipt."
  );
  return {
    valid: false,
    productId: null,
    expiresAt: null,
    status: "invalid",
    originalTransactionId: null,
    isSubscription: false,
    error: "Production validation not configured"
  };
}
function getIosProductPlan(productId) {
  const product = TEST_PRODUCTS[productId];
  return product?.plan || null;
}
var TEST_PRODUCTS;
var init_iosReceiptValidator = __esm({
  "server/billing/iosReceiptValidator.ts"() {
    "use strict";
    TEST_PRODUCTS = {
      // Legacy product, retired when the lifetime plan was removed — kept so
      // existing holders can still restore/verify their past purchase. Mapped to
      // PLUS (not the old, no-longer-real "BASE" plan) since PLUS is the closest
      // current equivalent to what BASE lifetime actually unlocked (mind map,
      // flashcards, notes) — mapping to PRO would over-grant exam mode/adaptive
      // review/export that these purchasers never paid for. "BASE" is not a
      // valid PlanType and would silently downgrade holders to FREE.
      "com.studymind.base.lifetime": {
        isSubscription: false,
        plan: "PLUS"
      },
      "com.studymind.plus.monthly": {
        isSubscription: true,
        plan: "PLUS",
        durationDays: 30
      },
      "com.studymind.plus.yearly": {
        isSubscription: true,
        plan: "PLUS",
        durationDays: 365
      },
      "com.studymind.pro.monthly": {
        isSubscription: true,
        plan: "PRO",
        durationDays: 30
      },
      "com.studymind.pro.yearly": {
        isSubscription: true,
        plan: "PRO",
        durationDays: 365
      }
    };
  }
});

// server/billing/androidPurchaseValidator.ts
import { google } from "googleapis";
function isSubscriptionProduct(productId) {
  const config = PRODUCT_CONFIG[productId];
  if (config) return config.isSubscription;
  return productId.includes(".monthly") || productId.includes(".yearly");
}
function getAuthClient() {
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const credentials = JSON.parse(raw);
    return new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/androidpublisher"]
    });
  } catch (e) {
    console.error(
      "[Android Validator] Failed to parse GOOGLE_PLAY_SERVICE_ACCOUNT_JSON:",
      e.message
    );
    return null;
  }
}
function invalidResult(error) {
  return {
    valid: false,
    productId: null,
    expiresAt: null,
    status: "invalid",
    orderId: null,
    isSubscription: false,
    error
  };
}
async function verifyAndroidPurchase(purchaseToken, productId) {
  const allowTestTokens = process.env.NODE_ENV !== "production";
  if (allowTestTokens && (purchaseToken === "TEST_TOKEN" || purchaseToken.startsWith("TEST_TOKEN_"))) {
    const config = PRODUCT_CONFIG[productId];
    if (!config) return invalidResult("Unknown product ID");
    const expiresAt = config.isSubscription ? new Date(Date.now() + (config.durationDays || 30) * 24 * 60 * 60 * 1e3) : null;
    return {
      valid: true,
      productId,
      expiresAt,
      status: "active",
      orderId: `GPA.TEST_ORDER_${Date.now()}`,
      isSubscription: config.isSubscription
    };
  }
  const packageName = process.env.GOOGLE_PLAY_PACKAGE_NAME;
  const auth = getAuthClient();
  if (!auth || !packageName) {
    console.error(
      "[Android Validator] Missing env: GOOGLE_PLAY_SERVICE_ACCOUNT_JSON or GOOGLE_PLAY_PACKAGE_NAME"
    );
    return invalidResult("Billing not configured");
  }
  const publisher = google.androidpublisher({ version: "v3", auth });
  try {
    if (isSubscriptionProduct(productId)) {
      return await verifySubscription(
        publisher,
        packageName,
        purchaseToken,
        productId
      );
    } else {
      return await verifyOneTimePurchase(
        publisher,
        packageName,
        purchaseToken,
        productId
      );
    }
  } catch (err) {
    const code = err?.code || err?.response?.status;
    const msg = err?.message || String(err);
    console.error(`[Android Validator] Google API error (${code}):`, msg);
    if (code === 404) return invalidResult("Purchase not found on Google Play");
    if (code === 401 || code === 403)
      return invalidResult("Server auth failed with Google Play");
    return invalidResult("Google Play verification failed");
  }
}
async function verifySubscription(publisher, packageName, token, productId) {
  const res = await publisher.purchases.subscriptionsv2.get({
    packageName,
    token
  });
  const sub = res.data;
  const lineItems = sub.lineItems || [];
  const expiryTime = sub.lineItems?.[0]?.expiryTime;
  const expiresAt = expiryTime ? new Date(expiryTime) : null;
  const subState = sub.subscriptionState;
  let status;
  let valid = false;
  switch (subState) {
    case "SUBSCRIPTION_STATE_ACTIVE":
      status = "active";
      valid = true;
      break;
    case "SUBSCRIPTION_STATE_IN_GRACE_PERIOD":
      status = "grace_period";
      valid = true;
      break;
    case "SUBSCRIPTION_STATE_ON_HOLD":
    case "SUBSCRIPTION_STATE_PAUSED":
      status = "pending";
      valid = false;
      break;
    case "SUBSCRIPTION_STATE_CANCELED":
      if (expiresAt && expiresAt.getTime() > Date.now()) {
        status = "active";
        valid = true;
      } else {
        status = "canceled";
        valid = false;
      }
      break;
    case "SUBSCRIPTION_STATE_EXPIRED":
      status = "expired";
      valid = false;
      break;
    default:
      status = "invalid";
      valid = false;
  }
  const matchedProduct = lineItems.some(
    (li) => li.productId === productId || li.offerDetails?.basePlanId
  );
  return {
    valid,
    productId: matchedProduct ? productId : lineItems[0]?.productId || productId,
    expiresAt,
    status,
    orderId: sub.latestOrderId || null,
    isSubscription: true
  };
}
async function verifyOneTimePurchase(publisher, packageName, token, productId) {
  const res = await publisher.purchases.products.get({
    packageName,
    productId,
    token
  });
  const purchase = res.data;
  const purchaseState = purchase.purchaseState;
  const consumptionState = purchase.consumptionState;
  const isPurchased = purchaseState === 0;
  const isRefunded = purchase.orderId?.includes("..") ?? false;
  const valid = isPurchased && !isRefunded;
  return {
    valid,
    productId,
    expiresAt: null,
    status: valid ? "active" : "invalid",
    orderId: purchase.orderId || null,
    isSubscription: false,
    error: !valid ? `purchaseState=${purchaseState}, refunded=${isRefunded}` : void 0
  };
}
function getAndroidProductPlan(productId) {
  return PRODUCT_CONFIG[productId]?.plan || null;
}
var PRODUCT_CONFIG;
var init_androidPurchaseValidator = __esm({
  "server/billing/androidPurchaseValidator.ts"() {
    "use strict";
    PRODUCT_CONFIG = {
      // Legacy product, retired when the lifetime plan was removed — kept so
      // existing holders can still restore/verify their past purchase. Mapped to
      // PLUS (not the old, no-longer-real "BASE" plan) since PLUS is the closest
      // current equivalent to what BASE lifetime actually unlocked (mind map,
      // flashcards, notes) — mapping to PRO would over-grant exam mode/adaptive
      // review/export that these purchasers never paid for. "BASE" is not a
      // valid PlanType and would silently downgrade holders to FREE.
      "com.studymind.base.lifetime": { isSubscription: false, plan: "PLUS" },
      "com.studymind.plus.monthly": {
        isSubscription: true,
        plan: "PLUS",
        durationDays: 30
      },
      "com.studymind.plus.yearly": {
        isSubscription: true,
        plan: "PLUS",
        durationDays: 365
      },
      "com.studymind.pro.monthly": {
        isSubscription: true,
        plan: "PRO",
        durationDays: 30
      },
      "com.studymind.pro.yearly": {
        isSubscription: true,
        plan: "PRO",
        durationDays: 365
      }
    };
  }
});

// server/billing/entitlements.ts
function getPlanLimits(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.FREE;
}
function getProductPlan(productId) {
  const product = PRODUCTS.find((p) => p.id === productId);
  return product?.plan || null;
}
function getCurrentMonthKey() {
  const now = /* @__PURE__ */ new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
var PLAN_LIMITS, PRODUCTS;
var init_entitlements = __esm({
  "server/billing/entitlements.ts"() {
    "use strict";
    PLAN_LIMITS = {
      FREE: {
        maxRecordingsLifetime: 3,
        maxTranscriptionMinutesPerMonth: 45,
        hasFlashcards: true,
        hasNotes: true,
        hasMindMap: false,
        hasQuizzes: false,
        hasAdaptiveReview: false,
        hasExamMode: false,
        hasExport: false
      },
      PLUS: {
        maxRecordingsLifetime: -1,
        maxTranscriptionMinutesPerMonth: 150,
        hasFlashcards: true,
        hasNotes: true,
        hasMindMap: true,
        hasQuizzes: true,
        hasAdaptiveReview: false,
        hasExamMode: false,
        hasExport: false
      },
      PRO: {
        maxRecordingsLifetime: -1,
        maxTranscriptionMinutesPerMonth: 450,
        hasFlashcards: true,
        hasNotes: true,
        hasMindMap: true,
        hasQuizzes: true,
        hasAdaptiveReview: true,
        hasExamMode: true,
        hasExport: true
      }
    };
    PRODUCTS = [
      {
        id: "com.studymind.plus.monthly",
        name: "StudyMind Plus Monthly",
        description: "Unlimited recordings, quizzes, and 150 min/mo transcription",
        plan: "PLUS",
        type: "subscription",
        period: "monthly",
        price: "$9.99/month",
        features: [
          "Unlimited recordings",
          "150 min transcription/month",
          "AI-generated notes",
          "Flashcard generation",
          "Quiz generation"
        ]
      },
      {
        id: "com.studymind.plus.yearly",
        name: "StudyMind Plus Yearly",
        description: "Best value Plus plan - save 50%",
        plan: "PLUS",
        type: "subscription",
        period: "yearly",
        price: "$59.99/year",
        features: [
          "Everything in Plus Monthly",
          "Save 50% vs monthly",
          "Unlimited recordings",
          "150 min transcription/month"
        ]
      },
      {
        id: "com.studymind.pro.monthly",
        name: "StudyMind Pro Monthly",
        description: "Full access - Exam mode, grade analytics, 450 min/mo",
        plan: "PRO",
        type: "subscription",
        period: "monthly",
        price: "$19.99/month",
        features: [
          "Everything in Plus",
          "Exam mode & grade analytics",
          "Adaptive study engine",
          "450 min transcription/month",
          "PDF export & priority AI speed"
        ]
      },
      {
        id: "com.studymind.pro.yearly",
        name: "StudyMind Pro Yearly",
        description: "Best overall value - save 50%",
        plan: "PRO",
        type: "subscription",
        period: "yearly",
        price: "$119.99/year",
        features: [
          "Everything in Pro Monthly",
          "Save 50% vs monthly",
          "Exam mode & grade analytics",
          "Adaptive study engine",
          "450 min transcription/month",
          "PDF export & priority AI speed"
        ]
      }
    ];
  }
});

// server/billing.ts
var billing_exports = {};
__export(billing_exports, {
  PLAN_LIMITS: () => PLAN_LIMITS,
  default: () => billing_default,
  getUsageInfo: () => getUsageInfo,
  getUserPlan: () => getUserPlan,
  incrementUsage: () => incrementUsage
});
import { Router as Router3 } from "express";
async function getEntitlementInfo(userId) {
  const entitlement = await db_default.entitlement.findUnique({
    where: { userId }
  });
  if (!entitlement) {
    return {
      plan: "FREE",
      limits: getPlanLimits("FREE"),
      expiresAt: null,
      source: "free"
    };
  }
  if (entitlement.expiresAt && new Date(entitlement.expiresAt) < /* @__PURE__ */ new Date()) {
    return {
      plan: "FREE",
      limits: getPlanLimits("FREE"),
      expiresAt: null,
      source: "free"
    };
  }
  const plan = entitlement.plan;
  return {
    plan,
    limits: getPlanLimits(plan),
    expiresAt: entitlement.expiresAt,
    source: entitlement.source
  };
}
async function getUsageInfo(userId) {
  const monthKey = getCurrentMonthKey();
  let usage = await db_default.usage.findUnique({
    where: { userId_monthKey: { userId, monthKey } }
  });
  if (!usage) {
    usage = await db_default.usage.create({
      data: {
        userId,
        monthKey,
        recordingsCount: 0,
        transcriptionMinutesUsed: 0,
        storageBytesUsed: 0
      }
    });
  }
  const lifetimeRecordings = await db_default.usage.aggregate({
    where: { userId },
    _sum: { recordingsCount: true }
  });
  return {
    recordingsCount: lifetimeRecordings._sum.recordingsCount || 0,
    transcriptionMinutesUsed: usage.transcriptionMinutesUsed,
    storageBytesUsed: usage.storageBytesUsed,
    monthKey
  };
}
async function getUserPlan(userId) {
  const entitlement = await getEntitlementInfo(userId);
  return entitlement.plan;
}
async function incrementUsage(userId, type, amount) {
  const monthKey = getCurrentMonthKey();
  if (type === "recording") {
    await db_default.usage.upsert({
      where: { userId_monthKey: { userId, monthKey } },
      create: {
        userId,
        monthKey,
        recordingsCount: amount,
        transcriptionMinutesUsed: 0,
        storageBytesUsed: 0
      },
      update: {
        recordingsCount: { increment: amount }
      }
    });
  } else if (type === "transcription") {
    await db_default.usage.upsert({
      where: { userId_monthKey: { userId, monthKey } },
      create: {
        userId,
        monthKey,
        recordingsCount: 0,
        transcriptionMinutesUsed: amount,
        storageBytesUsed: 0
      },
      update: {
        transcriptionMinutesUsed: { increment: amount }
      }
    });
  } else {
    await db_default.usage.upsert({
      where: { userId_monthKey: { userId, monthKey } },
      create: {
        userId,
        monthKey,
        recordingsCount: 0,
        transcriptionMinutesUsed: 0,
        storageBytesUsed: amount
      },
      update: {
        storageBytesUsed: { increment: amount }
      }
    });
  }
}
function classifyBillingError(error) {
  const msg = (error?.message || "").toLowerCase();
  const code = error?.code || "";
  if (msg.includes("can't reach database") || msg.includes("connection refused") || msg.includes("econnrefused") || msg.includes("database") && msg.includes("does not exist") || code === "P1001" || code === "P1002" || code === "P1003") {
    return "DB_CONNECT_FAILED";
  }
  if (msg.includes("unique constraint") || code === "P2002") {
    return "DB_CONSTRAINT_VIOLATION";
  }
  if (msg.includes("timeout") || code === "P1008") {
    return "DB_TIMEOUT";
  }
  if (msg.includes("receipt") || msg.includes("validation") || msg.includes("verify")) {
    return "VALIDATOR_FAILED";
  }
  return "INTERNAL_ERROR";
}
function sanitizeError(error) {
  const msg = error?.message || String(error);
  return msg.replace(/postgres:\/\/[^\s]+/gi, "postgres://***").replace(/Bearer\s+\S+/gi, "Bearer ***").replace(/token[=:]\s*\S+/gi, "token=***");
}
var router3, INTERNAL_API_SECRET, VALID_PLANS, billing_default;
var init_billing = __esm({
  "server/billing.ts"() {
    "use strict";
    init_db();
    init_auth();
    init_iosReceiptValidator();
    init_androidPurchaseValidator();
    init_entitlements();
    router3 = Router3();
    router3.get("/products", async (_req, res) => {
      try {
        res.json({
          products: PRODUCTS.map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            plan: p.plan,
            type: p.type,
            period: "period" in p ? p.period : void 0,
            price: p.price,
            features: p.features
          }))
        });
      } catch (error) {
        console.error("Error fetching products:", error);
        res.status(500).json({ error: "Failed to fetch products" });
      }
    });
    router3.get("/plans", async (_req, res) => {
      try {
        res.json({
          plans: [
            {
              id: "FREE",
              name: "Free",
              price: 0,
              description: "Get started with basic features",
              features: [
                "3 recordings total",
                "45 minutes transcription",
                "AI notes & flashcards"
              ],
              limits: PLAN_LIMITS.FREE
            },
            {
              id: "PLUS",
              name: "StudyMind Plus",
              price: 9.99,
              type: "subscription",
              period: "monthly",
              description: "Unlimited recordings, quizzes, and 150 min/mo transcription",
              features: [
                "Unlimited recordings",
                "150 min transcription/month",
                "Quiz generation",
                "Full web + mobile access"
              ],
              limits: PLAN_LIMITS.PLUS,
              productId: "com.studymind.plus.monthly"
            },
            {
              id: "PRO",
              name: "StudyMind Pro",
              price: 19.99,
              type: "subscription",
              period: "monthly",
              description: "Full access - Exam mode, adaptive study engine, 450 min/mo",
              features: [
                "Everything in Plus",
                "Exam mode & grade analytics",
                "Adaptive study engine",
                "450 min transcription/month",
                "PDF export & priority AI speed"
              ],
              limits: PLAN_LIMITS.PRO,
              productId: "com.studymind.pro.monthly"
            }
          ]
        });
      } catch (error) {
        console.error("Get plans error:", error);
        res.status(500).json({ error: "Failed to get plans" });
      }
    });
    router3.post(
      "/verify",
      guestOrAuthMiddleware,
      async (req, res) => {
        const IS_DEV = process.env.NODE_ENV !== "production";
        try {
          const userId = req.user.id;
          const { platform, productId, purchaseToken, transactionId, receiptData } = req.body;
          if (!platform || !productId) {
            res.status(400).json({ error: "Missing required fields: platform, productId" });
            return;
          }
          if (platform !== "ios" && platform !== "android") {
            res.status(400).json({ error: 'Invalid platform. Must be "ios" or "android"' });
            return;
          }
          const isDevTestToken = IS_DEV && (purchaseToken === "TEST_TOKEN" || transactionId === "TEST_RECEIPT" || receiptData === "TEST_RECEIPT");
          let validationResult;
          let plan;
          let tokenOrTxnId;
          if (isDevTestToken) {
            tokenOrTxnId = purchaseToken || transactionId || receiptData || "TEST_TOKEN";
            plan = getProductPlan(productId);
            validationResult = {
              valid: true,
              status: "active",
              expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1e3)
            };
          } else if (platform === "ios") {
            if (!receiptData && !transactionId) {
              res.status(400).json({ error: "iOS requires receiptData or transactionId" });
              return;
            }
            tokenOrTxnId = transactionId || receiptData;
            validationResult = await verifyIosReceipt(
              receiptData || "TEST_RECEIPT",
              productId
            );
            plan = getIosProductPlan(productId);
          } else {
            if (!purchaseToken) {
              res.status(400).json({ error: "Android requires purchaseToken" });
              return;
            }
            tokenOrTxnId = purchaseToken;
            validationResult = await verifyAndroidPurchase(
              purchaseToken,
              productId
            );
            plan = getAndroidProductPlan(productId);
          }
          if (!validationResult.valid) {
            if (validationResult.error === "Billing not configured") {
              res.status(400).json({
                error: "Billing not configured",
                code: "BILLING_NOT_CONFIGURED"
              });
              return;
            }
            res.status(400).json({
              error: "Receipt validation failed",
              details: validationResult.error
            });
            return;
          }
          if (!plan) {
            res.status(400).json({ error: "Unknown product ID" });
            return;
          }
          const existingPurchase = await db_default.purchase.findUnique({
            where: { purchaseTokenOrTransactionId: tokenOrTxnId }
          });
          if (existingPurchase && existingPurchase.userId !== userId) {
            console.warn(
              `[Billing] Purchase token ${tokenOrTxnId} already claimed by user ${existingPurchase.userId}; rejecting re-submission from ${userId}`
            );
            res.status(409).json({
              error: "This purchase is already associated with a different account"
            });
            return;
          }
          await db_default.user.upsert({
            where: { id: userId },
            create: {
              id: userId,
              email: `${userId}@device.local`,
              passwordHash: ""
            },
            update: {}
          });
          await db_default.purchase.upsert({
            where: { purchaseTokenOrTransactionId: tokenOrTxnId },
            create: {
              userId,
              platform,
              productId,
              purchaseTokenOrTransactionId: tokenOrTxnId,
              rawReceiptJson: JSON.stringify(req.body),
              verifiedAt: /* @__PURE__ */ new Date()
            },
            update: {
              verifiedAt: /* @__PURE__ */ new Date()
            }
          });
          await db_default.subscriptionStatus.upsert({
            where: { userId },
            create: {
              userId,
              platform,
              status: validationResult.status,
              productId,
              currentPeriodEnd: validationResult.expiresAt
            },
            update: {
              platform,
              status: validationResult.status,
              productId,
              currentPeriodEnd: validationResult.expiresAt
            }
          });
          await db_default.entitlement.upsert({
            where: { userId },
            create: {
              userId,
              plan,
              expiresAt: validationResult.expiresAt,
              source: "iap"
            },
            update: {
              plan,
              expiresAt: validationResult.expiresAt,
              source: "iap"
            }
          });
          const entitlement = await getEntitlementInfo(userId);
          const usage = await getUsageInfo(userId);
          res.json({
            success: true,
            entitlement,
            usage,
            limits: getPlanLimits(entitlement.plan)
          });
        } catch (error) {
          const errorCode = classifyBillingError(error);
          console.error(`[billing/verify] ${errorCode}:`, sanitizeError(error));
          if (errorCode === "DB_CONNECT_FAILED") {
            res.status(503).json({
              error: "Billing temporarily unavailable",
              code: "BILLING_UNAVAILABLE"
            });
          } else {
            res.status(500).json({ error: "Failed to verify purchase", code: errorCode });
          }
        }
      }
    );
    router3.get(
      "/entitlements",
      guestOrAuthMiddleware,
      async (req, res) => {
        try {
          const userId = req.user.id;
          const entitlement = await getEntitlementInfo(userId);
          const usage = await getUsageInfo(userId);
          const limits = getPlanLimits(entitlement.plan);
          res.json({
            entitlement,
            usage,
            limits
          });
        } catch (error) {
          const errorCode = classifyBillingError(error);
          console.error(
            `[billing/entitlements] ${errorCode}:`,
            sanitizeError(error)
          );
          if (errorCode === "DB_CONNECT_FAILED") {
            res.status(503).json({
              error: "Billing temporarily unavailable",
              code: "BILLING_UNAVAILABLE"
            });
          } else {
            res.status(500).json({ error: "Failed to fetch entitlements", code: errorCode });
          }
        }
      }
    );
    router3.get(
      "/usage",
      guestOrAuthMiddleware,
      async (req, res) => {
        try {
          const userId = req.user.id;
          const entitlement = await getEntitlementInfo(userId);
          const usage = await getUsageInfo(userId);
          const limits = getPlanLimits(entitlement.plan);
          res.json({
            usage: {
              recordingsCount: usage.recordingsCount,
              transcriptionMinutesUsed: usage.transcriptionMinutesUsed,
              storageBytesUsed: usage.storageBytesUsed,
              monthKey: usage.monthKey
            },
            limits: {
              maxRecordingsLifetime: limits.maxRecordingsLifetime,
              maxTranscriptionMinutesPerMonth: limits.maxTranscriptionMinutesPerMonth
            },
            plan: entitlement.plan
          });
        } catch (error) {
          console.error("Get usage error:", error);
          res.status(500).json({ error: "Failed to get usage" });
        }
      }
    );
    INTERNAL_API_SECRET = (() => {
      const secret = process.env.INTERNAL_API_SECRET;
      if (!secret) {
        if (process.env.NODE_ENV === "production") {
          throw new Error(
            `[Billing] INTERNAL_API_SECRET env var must be set in production. Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
          );
        }
        console.warn(
          "[Billing] INTERNAL_API_SECRET not set \u2014 using insecure default for development only."
        );
        return "studymind-dev-only-not-for-production";
      }
      return secret;
    })();
    VALID_PLANS = ["FREE", "PLUS", "PRO"];
    router3.post("/stripe-webhook", async (req, res) => {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        res.status(401).json({ error: "Missing or invalid authorization header" });
        return;
      }
      const token = authHeader.substring(7);
      if (token !== INTERNAL_API_SECRET) {
        res.status(403).json({ error: "Forbidden: Invalid API secret" });
        return;
      }
      try {
        const { email, plan, expiresAt, subscriptionId, priceId, status } = req.body;
        if (!email || !plan || !subscriptionId) {
          res.status(400).json({ error: "Missing required fields: email, plan, subscriptionId" });
          return;
        }
        if (!VALID_PLANS.includes(plan)) {
          res.status(400).json({ error: `Invalid plan: ${plan}` });
          return;
        }
        const lowerEmail = email.toLowerCase();
        let user = await db_default.user.findUnique({
          where: { email: lowerEmail }
        });
        if (!user) {
          console.log(`[Stripe Sync] Creating placeholder account for new user: ${lowerEmail}`);
          user = await db_default.user.create({
            data: {
              email: lowerEmail,
              passwordHash: ""
              // Placeholder - will complete registration via signup endpoint
            }
          });
        }
        const parsedExpiresAt = expiresAt ? new Date(expiresAt) : null;
        await db_default.entitlement.upsert({
          where: { userId: user.id },
          create: {
            userId: user.id,
            plan,
            expiresAt: parsedExpiresAt,
            source: "stripe"
          },
          update: {
            plan,
            expiresAt: parsedExpiresAt,
            source: "stripe"
          }
        });
        await db_default.subscriptionStatus.upsert({
          where: { userId: user.id },
          create: {
            userId: user.id,
            platform: "stripe",
            status,
            productId: priceId,
            currentPeriodEnd: parsedExpiresAt
          },
          update: {
            platform: "stripe",
            status,
            productId: priceId,
            currentPeriodEnd: parsedExpiresAt
          }
        });
        await db_default.purchase.upsert({
          where: { purchaseTokenOrTransactionId: subscriptionId },
          create: {
            userId: user.id,
            platform: "stripe",
            productId: priceId,
            purchaseTokenOrTransactionId: subscriptionId,
            rawReceiptJson: JSON.stringify({ email, plan, status, priceId }),
            verifiedAt: /* @__PURE__ */ new Date()
          },
          update: {
            verifiedAt: /* @__PURE__ */ new Date()
          }
        });
        console.log(`[Stripe Sync] Successfully updated plan to ${plan} for ${lowerEmail} (Status: ${status})`);
        res.json({
          success: true,
          userId: user.id,
          plan,
          status
        });
      } catch (error) {
        console.error("[Stripe Sync] Error updating subscription:", error);
        res.status(500).json({ error: "Failed to update subscription in backend database" });
      }
    });
    billing_default = router3;
  }
});

// server/middleware.ts
var checkUsageLimits, incrementUsage2;
var init_middleware = __esm({
  "server/middleware.ts"() {
    "use strict";
    init_db();
    init_billing();
    init_constants();
    checkUsageLimits = (feature) => {
      return async (req, res, next) => {
        if (!req.user) {
          return res.status(401).json({ error: "Authentication required" });
        }
        if (req.user.id === ANONYMOUS_USER_ID) {
          return next();
        }
        try {
          const entitlement = await db_default.entitlement.findUnique({
            where: { userId: req.user.id }
          });
          const plan = entitlement?.plan || "FREE";
          const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.FREE;
          switch (feature) {
            case "recording": {
              if (limits.maxRecordingsLifetime === -1) break;
              const usage = await getUsageInfo(req.user.id);
              if (usage.recordingsCount >= limits.maxRecordingsLifetime) {
                return res.status(403).json({
                  type: "PAYWALL_REQUIRED",
                  error: "Recording limit reached",
                  upgradeRequired: true,
                  message: `You've reached the limit of ${limits.maxRecordingsLifetime} recordings. Upgrade to continue.`
                });
              }
              break;
            }
            case "transcription": {
              if (limits.maxTranscriptionMinutesPerMonth === -1) break;
              const usage = await getUsageInfo(req.user.id);
              if (usage.transcriptionMinutesUsed >= limits.maxTranscriptionMinutesPerMonth) {
                return res.status(403).json({
                  type: "PAYWALL_REQUIRED",
                  error: "Transcription limit reached",
                  upgradeRequired: true,
                  message: `You've used all ${limits.maxTranscriptionMinutesPerMonth} transcription minutes this month. Upgrade for more.`
                });
              }
              break;
            }
            case "quiz":
              if (!limits.hasQuizzes) {
                return res.status(403).json({
                  error: "Feature not available",
                  upgradeRequired: true,
                  message: "Quiz generation is a PRO feature. Upgrade to access it!"
                });
              }
              break;
            case "adaptive":
              if (!limits.hasAdaptiveReview) {
                return res.status(403).json({
                  error: "Feature not available",
                  upgradeRequired: true,
                  message: "Adaptive study is a PRO feature. Upgrade to access it!"
                });
              }
              break;
            case "exam":
              if (!limits.hasExamMode) {
                return res.status(403).json({
                  error: "Feature not available",
                  upgradeRequired: true,
                  message: "Exam mode is a PRO feature. Upgrade to access it!"
                });
              }
              break;
            case "export":
              if (!limits.hasExport) {
                return res.status(403).json({
                  error: "Feature not available",
                  upgradeRequired: true,
                  message: "Export is a PRO feature. Upgrade to access it!"
                });
              }
              break;
          }
          next();
        } catch (error) {
          console.error("Usage limit check error:", error);
          next();
        }
      };
    };
    incrementUsage2 = async (userId, type, amount = 1) => {
      try {
        if (userId === ANONYMOUS_USER_ID) return;
        const monthKey = (/* @__PURE__ */ new Date()).toISOString().slice(0, 7);
        const existing = await db_default.usage.findFirst({
          where: { userId, monthKey }
        });
        if (existing) {
          if (type === "recording") {
            await db_default.usage.update({
              where: { id: existing.id },
              data: { recordingsCount: { increment: amount } }
            });
          } else if (type === "transcription") {
            await db_default.usage.update({
              where: { id: existing.id },
              data: { transcriptionMinutesUsed: { increment: amount } }
            });
          }
        } else {
          await db_default.usage.create({
            data: {
              userId,
              monthKey,
              recordingsCount: type === "recording" ? amount : 0,
              transcriptionMinutesUsed: type === "transcription" ? amount : 0
            }
          });
        }
      } catch (error) {
        console.error("Increment usage error:", error);
      }
    };
  }
});

// server/adaptive.ts
var adaptive_exports = {};
__export(adaptive_exports, {
  default: () => adaptive_default
});
import { Router as Router4 } from "express";
var router4, adaptive_default;
var init_adaptive = __esm({
  "server/adaptive.ts"() {
    "use strict";
    init_db();
    init_auth();
    init_middleware();
    router4 = Router4();
    router4.post(
      "/flashcards/:id/answer",
      authMiddleware,
      async (req, res) => {
        try {
          const id = req.params.id;
          const { correct } = req.body;
          let stat = await db_default.flashcardStat.findUnique({
            where: {
              userId_flashcardId: {
                userId: req.user.id,
                flashcardId: id
              }
            }
          });
          if (!stat) {
            stat = await db_default.flashcardStat.create({
              data: {
                userId: req.user.id,
                flashcardId: id,
                timesCorrect: 0,
                timesWrong: 0,
                easeFactor: 2.5,
                interval: 1
              }
            });
          }
          let newEaseFactor = stat.easeFactor;
          let newInterval = stat.interval;
          if (correct) {
            newEaseFactor = Math.max(1.3, stat.easeFactor + 0.1);
            newInterval = Math.round(stat.interval * stat.easeFactor);
          } else {
            newEaseFactor = Math.max(1.3, stat.easeFactor - 0.2);
            newInterval = 1;
          }
          const nextReview = /* @__PURE__ */ new Date();
          nextReview.setDate(nextReview.getDate() + newInterval);
          const updatedStat = await db_default.flashcardStat.update({
            where: { id: stat.id },
            data: {
              timesCorrect: correct ? stat.timesCorrect + 1 : stat.timesCorrect,
              timesWrong: correct ? stat.timesWrong : stat.timesWrong + 1,
              lastReviewed: /* @__PURE__ */ new Date(),
              nextReview,
              easeFactor: newEaseFactor,
              interval: newInterval
            }
          });
          res.json({ stat: updatedStat });
        } catch (error) {
          console.error("Answer flashcard error:", error);
          res.status(500).json({ error: "Failed to record answer" });
        }
      }
    );
    router4.get(
      "/study-today",
      authMiddleware,
      checkUsageLimits("adaptive"),
      async (req, res) => {
        try {
          const now = /* @__PURE__ */ new Date();
          const dueFlashcards = await db_default.flashcardStat.findMany({
            where: {
              userId: req.user.id,
              nextReview: { lte: now }
            },
            include: {
              flashcard: {
                include: {
                  topic: true
                }
              }
            },
            orderBy: { nextReview: "asc" },
            take: 20
          });
          const weakFlashcards = await db_default.flashcardStat.findMany({
            where: {
              userId: req.user.id,
              timesWrong: { gt: 0 }
            },
            include: {
              flashcard: {
                include: {
                  topic: true
                }
              }
            },
            orderBy: { timesWrong: "desc" },
            take: 10
          });
          const quizAttempts = await db_default.quizAttempt.findMany({
            where: { userId: req.user.id },
            include: {
              quiz: {
                include: {
                  topic: true
                }
              }
            },
            orderBy: { completedAt: "desc" }
          });
          const topicScores = {};
          for (const attempt of quizAttempts) {
            const topicId = attempt.quiz.topicId;
            if (!topicScores[topicId]) {
              topicScores[topicId] = {
                correct: 0,
                total: 0,
                topic: attempt.quiz.topic
              };
            }
            topicScores[topicId].correct += attempt.score;
            topicScores[topicId].total += attempt.totalQuestions;
          }
          const weakTopics = Object.entries(topicScores).map(([topicId, data]) => ({
            topicId,
            topic: data.topic,
            accuracy: data.total > 0 ? data.correct / data.total * 100 : 0,
            totalQuestions: data.total
          })).filter((t) => t.accuracy < 70).sort((a, b) => a.accuracy - b.accuracy).slice(0, 5);
          res.json({
            dueFlashcards: dueFlashcards.map((s) => ({
              ...s.flashcard,
              stat: {
                timesCorrect: s.timesCorrect,
                timesWrong: s.timesWrong,
                nextReview: s.nextReview
              }
            })),
            weakFlashcards: weakFlashcards.map((s) => ({
              ...s.flashcard,
              stat: {
                timesCorrect: s.timesCorrect,
                timesWrong: s.timesWrong,
                successRate: s.timesCorrect + s.timesWrong > 0 ? s.timesCorrect / (s.timesCorrect + s.timesWrong) * 100 : 0
              }
            })),
            weakTopics,
            studyStats: {
              totalFlashcardsDue: dueFlashcards.length,
              totalWeakCards: weakFlashcards.length,
              totalWeakTopics: weakTopics.length
            }
          });
        } catch (error) {
          console.error("Get study today error:", error);
          res.status(500).json({ error: "Failed to get study recommendations" });
        }
      }
    );
    router4.get(
      "/stats",
      authMiddleware,
      async (req, res) => {
        try {
          const flashcardStats = await db_default.flashcardStat.findMany({
            where: { userId: req.user.id }
          });
          const quizAttempts = await db_default.quizAttempt.findMany({
            where: { userId: req.user.id },
            orderBy: { completedAt: "desc" }
          });
          const totalFlashcardsStudied = flashcardStats.length;
          const totalCorrect = flashcardStats.reduce(
            (sum, s) => sum + s.timesCorrect,
            0
          );
          const totalWrong = flashcardStats.reduce(
            (sum, s) => sum + s.timesWrong,
            0
          );
          const flashcardAccuracy = totalCorrect + totalWrong > 0 ? totalCorrect / (totalCorrect + totalWrong) * 100 : 0;
          const totalQuizzesTaken = quizAttempts.length;
          const totalQuizScore = quizAttempts.reduce((sum, a) => sum + a.score, 0);
          const totalQuizQuestions = quizAttempts.reduce(
            (sum, a) => sum + a.totalQuestions,
            0
          );
          const quizAccuracy = totalQuizQuestions > 0 ? totalQuizScore / totalQuizQuestions * 100 : 0;
          const last7Days = /* @__PURE__ */ new Date();
          last7Days.setDate(last7Days.getDate() - 7);
          const recentActivity = await db_default.flashcardStat.count({
            where: {
              userId: req.user.id,
              lastReviewed: { gte: last7Days }
            }
          });
          res.json({
            flashcards: {
              total: totalFlashcardsStudied,
              correct: totalCorrect,
              wrong: totalWrong,
              accuracy: flashcardAccuracy
            },
            quizzes: {
              total: totalQuizzesTaken,
              averageScore: quizAccuracy,
              recentAttempts: quizAttempts.slice(0, 5)
            },
            activity: {
              last7Days: recentActivity
            }
          });
        } catch (error) {
          console.error("Get stats error:", error);
          res.status(500).json({ error: "Failed to get stats" });
        }
      }
    );
    adaptive_default = router4;
  }
});

// server/exam.ts
var exam_exports = {};
__export(exam_exports, {
  default: () => exam_default
});
import { Router as Router5 } from "express";
function generateStudyPlan(topics, daysUntil) {
  const plan = [];
  const totalTopics = topics.length;
  if (daysUntil <= 0 || totalTopics === 0) {
    return plan;
  }
  const topicsPerDay = Math.ceil(totalTopics / Math.max(1, daysUntil - 1));
  let topicIndex = 0;
  for (let day = 1; day <= Math.min(daysUntil, 14); day++) {
    const dayPlan = {
      day,
      date: new Date(Date.now() + day * 24 * 60 * 60 * 1e3).toISOString().split("T")[0],
      tasks: []
    };
    if (day === daysUntil) {
      dayPlan.tasks.push({
        type: "review",
        description: "Final review - go through all weak areas",
        priority: "high"
      });
      dayPlan.tasks.push({
        type: "mock-quiz",
        description: "Take a mock quiz to test your knowledge",
        priority: "high"
      });
    } else {
      for (let i = 0; i < topicsPerDay && topicIndex < topics.length; i++) {
        const topic = topics[topicIndex];
        dayPlan.tasks.push({
          type: "study",
          topicId: topic.id,
          topicName: topic.name,
          description: `Study: ${topic.name}`,
          hasFlashcards: topic.flashcards?.length > 0,
          hasQuiz: topic.quizzes?.length > 0,
          priority: "medium"
        });
        topicIndex++;
      }
      if (day % 3 === 0) {
        dayPlan.tasks.push({
          type: "review",
          description: "Review flashcards from previous days",
          priority: "medium"
        });
      }
    }
    plan.push(dayPlan);
  }
  return plan;
}
var router5, exam_default;
var init_exam = __esm({
  "server/exam.ts"() {
    "use strict";
    init_db();
    init_auth();
    init_middleware();
    router5 = Router5();
    router5.get(
      "/",
      authMiddleware,
      checkUsageLimits("exam"),
      async (req, res) => {
        try {
          const exams = await db_default.exam.findMany({
            where: { userId: req.user.id },
            orderBy: { examDate: "asc" }
          });
          const examsWithDetails = await Promise.all(
            exams.map(async (exam) => {
              const topicIds = JSON.parse(exam.topicIds);
              const topics = await db_default.topic.findMany({
                where: { id: { in: topicIds } },
                include: { course: true }
              });
              const daysUntil = Math.ceil(
                (exam.examDate.getTime() - Date.now()) / (1e3 * 60 * 60 * 24)
              );
              return {
                ...exam,
                topics,
                daysUntil,
                studyPlan: exam.studyPlan ? JSON.parse(exam.studyPlan) : null
              };
            })
          );
          res.json({ exams: examsWithDetails });
        } catch (error) {
          console.error("Get exams error:", error);
          res.status(500).json({ error: "Failed to get exams" });
        }
      }
    );
    router5.post(
      "/",
      authMiddleware,
      checkUsageLimits("exam"),
      async (req, res) => {
        try {
          const { name, examDate, topicIds } = req.body;
          if (!name || !examDate || !topicIds || !Array.isArray(topicIds)) {
            return res.status(400).json({ error: "Name, examDate, and topicIds are required" });
          }
          const daysUntil = Math.ceil(
            (new Date(examDate).getTime() - Date.now()) / (1e3 * 60 * 60 * 24)
          );
          const topics = await db_default.topic.findMany({
            where: { id: { in: topicIds } },
            include: {
              flashcards: true,
              quizzes: true
            }
          });
          const studyPlan = generateStudyPlan(topics, daysUntil);
          const exam = await db_default.exam.create({
            data: {
              userId: req.user.id,
              name,
              examDate: new Date(examDate),
              topicIds: JSON.stringify(topicIds),
              studyPlan: JSON.stringify(studyPlan)
            }
          });
          res.json({
            exam: {
              ...exam,
              topics,
              daysUntil,
              studyPlan
            }
          });
        } catch (error) {
          console.error("Create exam error:", error);
          res.status(500).json({ error: "Failed to create exam" });
        }
      }
    );
    router5.get(
      "/:id",
      authMiddleware,
      checkUsageLimits("exam"),
      async (req, res) => {
        try {
          const id = req.params.id;
          const exam = await db_default.exam.findFirst({
            where: { id, userId: req.user.id }
          });
          if (!exam) {
            return res.status(404).json({ error: "Exam not found" });
          }
          const topicIds = JSON.parse(exam.topicIds);
          const topics = await db_default.topic.findMany({
            where: { id: { in: topicIds } },
            include: {
              course: true,
              flashcards: true,
              quizzes: {
                include: { questions: true }
              }
            }
          });
          const daysUntil = Math.ceil(
            (exam.examDate.getTime() - Date.now()) / (1e3 * 60 * 60 * 24)
          );
          res.json({
            exam: {
              ...exam,
              topics,
              daysUntil,
              studyPlan: exam.studyPlan ? JSON.parse(exam.studyPlan) : null
            }
          });
        } catch (error) {
          console.error("Get exam error:", error);
          res.status(500).json({ error: "Failed to get exam" });
        }
      }
    );
    router5.delete(
      "/:id",
      authMiddleware,
      async (req, res) => {
        try {
          const id = req.params.id;
          await db_default.exam.delete({
            where: { id, userId: req.user.id }
          });
          res.json({ success: true });
        } catch (error) {
          console.error("Delete exam error:", error);
          res.status(500).json({ error: "Failed to delete exam" });
        }
      }
    );
    router5.get(
      "/:id/mock-quiz",
      authMiddleware,
      checkUsageLimits("exam"),
      async (req, res) => {
        try {
          const id = req.params.id;
          const exam = await db_default.exam.findFirst({
            where: { id, userId: req.user.id }
          });
          if (!exam) {
            return res.status(404).json({ error: "Exam not found" });
          }
          const topicIds = JSON.parse(exam.topicIds);
          const questions = await db_default.quizQuestion.findMany({
            where: {
              quiz: {
                topicId: { in: topicIds }
              }
            },
            include: {
              quiz: {
                include: {
                  topic: true
                }
              }
            }
          });
          const shuffled = questions.sort(() => Math.random() - 0.5).slice(0, 20);
          res.json({
            mockQuiz: {
              examId: id,
              examName: exam.name,
              questions: shuffled.map((q) => ({
                id: q.id,
                question: q.question,
                options: JSON.parse(q.options),
                topicName: q.quiz.topic.name
              })),
              totalQuestions: shuffled.length
            }
          });
        } catch (error) {
          console.error("Get mock quiz error:", error);
          res.status(500).json({ error: "Failed to generate mock quiz" });
        }
      }
    );
    exam_default = router5;
  }
});

// server/lib/errors.ts
function sendError(res, statusCode, code, message, details) {
  const body = {
    error: {
      code,
      message,
      ...details !== void 0 ? { details } : {}
    }
  };
  res.status(statusCode).json(body);
}
function badRequest(res, message, details) {
  sendError(res, 400, "BAD_REQUEST", message, details);
}
var init_errors = __esm({
  "server/lib/errors.ts"() {
    "use strict";
  }
});

// server/lib/validate.ts
function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const details = result.error.errors.map((e) => ({
        field: e.path.join("."),
        message: e.message
      }));
      return badRequest(res, "Validation failed", details);
    }
    req.body = result.data;
    next();
  };
}
function validateParams(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      const details = result.error.errors.map((e) => ({
        field: e.path.join("."),
        message: e.message
      }));
      return badRequest(res, "Invalid route parameters", details);
    }
    next();
  };
}
var init_validate = __esm({
  "server/lib/validate.ts"() {
    "use strict";
    init_errors();
  }
});

// server/lib/validation-schemas.ts
import { z } from "zod";
var topicIdParams, quizIdParams, jobIdParams, ocrExtractBody, summarizeBody, notesToFlashcardsBody, notesToQuizBody, quizSubmitBody, videoExtractBody, videoUrlBody, createSemesterBody, createCourseBody, createTopicBody;
var init_validation_schemas = __esm({
  "server/lib/validation-schemas.ts"() {
    "use strict";
    topicIdParams = z.object({
      topicId: z.string().min(1, "topicId is required")
    });
    quizIdParams = z.object({
      quizId: z.string().min(1, "quizId is required")
    });
    jobIdParams = z.object({
      jobId: z.string().min(1, "jobId is required")
    });
    ocrExtractBody = z.object({
      imageBase64: z.string().min(1, "imageBase64 is required"),
      topicId: z.string().optional(),
      fileType: z.string().optional()
    });
    summarizeBody = z.object({
      text: z.string().min(1, "Text is required").max(5e4, "Text too long")
    });
    notesToFlashcardsBody = z.object({
      text: z.string().min(1, "Text is required").max(5e4, "Text too long"),
      topicId: z.string().optional()
    });
    notesToQuizBody = z.object({
      text: z.string().min(1, "Text is required").max(5e4, "Text too long"),
      topicId: z.string().optional()
    });
    quizSubmitBody = z.object({
      answers: z.record(z.string(), z.number())
    });
    videoExtractBody = z.object({
      videoBase64: z.string().min(1, "videoBase64 is required"),
      topicId: z.string().optional()
    });
    videoUrlBody = z.object({
      videoUrl: z.string().url("A valid URL is required"),
      topicId: z.string().optional()
    });
    createSemesterBody = z.object({
      name: z.string().min(1, "Semester name is required").max(200, "Name too long"),
      startDate: z.string().optional(),
      endDate: z.string().optional()
    });
    createCourseBody = z.object({
      semesterId: z.string().min(1, "Semester ID is required"),
      name: z.string().min(1, "Course name is required").max(200, "Name too long"),
      color: z.string().optional()
    });
    createTopicBody = z.object({
      courseId: z.string().min(1, "Course ID is required"),
      name: z.string().min(1, "Topic name is required").max(200, "Name too long")
    });
  }
});

// server/replit_integrations/audio/client.ts
import OpenAI, { toFile } from "openai";
import { spawn } from "child_process";
import { writeFile, unlink, readFile } from "fs/promises";
import { randomUUID } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
function detectAudioFormat(buffer) {
  if (buffer.length < 12) return "unknown";
  if (buffer[0] === 82 && buffer[1] === 73 && buffer[2] === 70 && buffer[3] === 70) {
    return "wav";
  }
  if (buffer[0] === 26 && buffer[1] === 69 && buffer[2] === 223 && buffer[3] === 163) {
    return "webm";
  }
  if (buffer[0] === 255 && (buffer[1] === 251 || buffer[1] === 250 || buffer[1] === 243) || buffer[0] === 73 && buffer[1] === 68 && buffer[2] === 51) {
    return "mp3";
  }
  if (buffer[4] === 102 && buffer[5] === 116 && buffer[6] === 121 && buffer[7] === 112) {
    return "mp4";
  }
  if (buffer[0] === 79 && buffer[1] === 103 && buffer[2] === 103 && buffer[3] === 83) {
    return "ogg";
  }
  return "unknown";
}
async function convertToWav(audioBuffer) {
  const inputPath = join(tmpdir(), `input-${randomUUID()}`);
  const outputPath = join(tmpdir(), `output-${randomUUID()}.wav`);
  try {
    await writeFile(inputPath, audioBuffer);
    await new Promise((resolve2, reject) => {
      const ffmpeg = spawn("ffmpeg", [
        "-i",
        inputPath,
        "-vn",
        // Extract audio only (ignore video track)
        "-f",
        "wav",
        "-ar",
        "16000",
        // 16kHz sample rate (good for speech)
        "-ac",
        "1",
        // Mono
        "-acodec",
        "pcm_s16le",
        "-y",
        // Overwrite output
        outputPath
      ]);
      ffmpeg.stderr.on("data", () => {
      });
      ffmpeg.on("close", (code) => {
        if (code === 0) resolve2();
        else reject(new Error(`ffmpeg exited with code ${code}`));
      });
      ffmpeg.on("error", reject);
    });
    return await readFile(outputPath);
  } finally {
    await unlink(inputPath).catch(() => {
    });
    await unlink(outputPath).catch(() => {
    });
  }
}
async function ensureCompatibleFormat(audioBuffer) {
  const detected = detectAudioFormat(audioBuffer);
  if (detected === "wav") return { buffer: audioBuffer, format: "wav" };
  if (detected === "mp3") return { buffer: audioBuffer, format: "mp3" };
  const wavBuffer = await convertToWav(audioBuffer);
  return { buffer: wavBuffer, format: "wav" };
}
async function speechToText(audioBuffer, format = "wav") {
  const file = await toFile(audioBuffer, `audio.${format}`);
  const response = await openai.audio.transcriptions.create({
    file,
    model: "gpt-4o-mini-transcribe"
  });
  return response.text;
}
var openai;
var init_client = __esm({
  "server/replit_integrations/audio/client.ts"() {
    "use strict";
    openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
    });
  }
});

// server/video-processor.ts
var video_processor_exports = {};
__export(video_processor_exports, {
  isProcessingError: () => isProcessingError,
  processVideoUrl: () => processVideoUrl
});
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
function isProcessingError(result) {
  return "status" in result;
}
function resolveYtdlpBinary() {
  const localBin = path.resolve(process.cwd(), ".pythonlibs/bin/yt-dlp");
  if (fs.existsSync(localBin)) return localBin;
  return "yt-dlp";
}
function isYtdlpAvailable(bin) {
  try {
    const { execFileSync } = __require("child_process");
    execFileSync(bin, ["--version"], { timeout: 1e4 });
    return true;
  } catch {
    return false;
  }
}
async function downloadAudio(url, outputDir, filePrefix) {
  const ytdlpBin = resolveYtdlpBinary();
  if (!isYtdlpAvailable(ytdlpBin)) {
    return {
      status: 503,
      message: "Video URL processing is not available. The required tool (yt-dlp) is not installed."
    };
  }
  const outputTemplate = path.join(outputDir, `${filePrefix}.%(ext)s`);
  const expectedWavPath = path.join(outputDir, `${filePrefix}.wav`);
  console.log(`${LOG_PREFIX} Downloading audio from URL (using ${ytdlpBin})`);
  try {
    const { stdout, stderr } = await execFileAsync(
      ytdlpBin,
      [
        "--no-playlist",
        "--extract-audio",
        "--audio-format",
        "wav",
        "--audio-quality",
        "0",
        "--no-check-certificates",
        "-o",
        outputTemplate,
        url
      ],
      {
        timeout: MAX_DOWNLOAD_TIMEOUT_MS,
        maxBuffer: 50 * 1024 * 1024
      }
    );
    const combinedOutput = `${stdout}
${stderr}`;
    console.log(
      `${LOG_PREFIX} yt-dlp completed: ${combinedOutput.slice(-300)}`
    );
  } catch (err) {
    const errOutput = err?.stdout || err?.stderr || err?.message || "";
    console.error(`${LOG_PREFIX} yt-dlp failed: ${errOutput.slice(-800)}`);
    return classifyDownloadError(errOutput);
  }
  if (!fs.existsSync(expectedWavPath)) {
    const converted = await convertToWav2(
      outputDir,
      filePrefix,
      expectedWavPath
    );
    if (!converted) {
      return {
        status: 400,
        message: "Failed to download audio. Make sure the URL is correct and the video is publicly accessible."
      };
    }
  }
  return expectedWavPath;
}
function classifyDownloadError(output) {
  if (output.includes("is not a valid URL") || output.includes("Unsupported URL")) {
    return {
      status: 400,
      message: "This URL is not supported. Please provide a YouTube or other supported video link."
    };
  }
  if (output.includes("Video unavailable") || output.includes("Private video") || output.includes("removed")) {
    return {
      status: 400,
      message: "This video is unavailable, private, or has been removed."
    };
  }
  if (output.includes("Sign in to confirm") || output.includes("age-restricted") || output.includes("age gate")) {
    return {
      status: 400,
      message: "This video requires sign-in or age verification and cannot be processed."
    };
  }
  if (output.includes("timed out") || output.includes("Timeout")) {
    return {
      status: 408,
      message: "Video download timed out. Try a shorter video."
    };
  }
  return {
    status: 400,
    message: "Failed to process the video URL. Make sure it's a valid, publicly accessible video link."
  };
}
async function convertToWav2(dir, filePrefix, targetPath) {
  const candidates = fs.readdirSync(dir).filter((f) => f.startsWith(filePrefix));
  if (candidates.length === 0) return false;
  const srcPath = path.join(dir, candidates[0]);
  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-i",
        srcPath,
        "-vn",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "16000",
        "-ac",
        "1",
        targetPath,
        "-y"
      ],
      { timeout: MAX_FFMPEG_TIMEOUT_MS }
    );
    return true;
  } catch {
    try {
      fs.renameSync(srcPath, targetPath);
      return true;
    } catch {
      return false;
    }
  }
}
async function trimIfOversized(audioPath) {
  const stats = fs.statSync(audioPath);
  const sizeMB = stats.size / (1024 * 1024);
  console.log(`${LOG_PREFIX} Audio size: ${sizeMB.toFixed(1)}MB`);
  if (sizeMB <= MAX_AUDIO_SIZE_MB) return;
  const trimmedPath = `${audioPath}.trimmed.wav`;
  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-i",
        audioPath,
        "-t",
        String(MAX_AUDIO_DURATION_SECONDS),
        "-vn",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "16000",
        "-ac",
        "1",
        trimmedPath,
        "-y"
      ],
      { timeout: MAX_FFMPEG_TIMEOUT_MS }
    );
    fs.unlinkSync(audioPath);
    fs.renameSync(trimmedPath, audioPath);
    console.log(
      `${LOG_PREFIX} Audio trimmed to ${MAX_AUDIO_DURATION_SECONDS / 60} minutes`
    );
  } catch {
    console.warn(
      `${LOG_PREFIX} Could not trim audio, proceeding with original`
    );
    try {
      fs.unlinkSync(trimmedPath);
    } catch {
    }
  }
}
async function transcribeAudio(audioPath, openai4) {
  const audioBuffer = fs.readFileSync(audioPath);
  const audioFile = new File([audioBuffer], "audio.wav", { type: "audio/wav" });
  console.log(`${LOG_PREFIX} Starting transcription...`);
  try {
    const transcription = await openai4.audio.transcriptions.create({
      model: "whisper-1",
      file: audioFile
    });
    const text = transcription.text || "";
    console.log(`${LOG_PREFIX} Transcription complete: ${text.length} chars`);
    return text;
  } catch (err) {
    console.error(`${LOG_PREFIX} Transcription failed:`, err?.message);
    return {
      status: 503,
      message: "AI transcription service is temporarily unavailable. The video was downloaded successfully but could not be transcribed. Please try again in a few minutes."
    };
  }
}
async function summarizeTranscript(transcript, openai4) {
  try {
    const response = await openai4.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Summarize this video transcription into clear, well-organized study notes. Include:\n1. A brief overview\n2. Key points and main ideas (with bullet points)\n3. Important details and examples\n4. Main takeaways\n\nFormat with markdown headers and bullet points for easy reading."
        },
        { role: "user", content: transcript }
      ],
      max_tokens: 2e3
    });
    const summary = response.choices[0]?.message?.content || "";
    return `## Video Summary

${summary}

---

## Full Transcript

${transcript}`;
  } catch (err) {
    console.error(`${LOG_PREFIX} Summarization failed:`, err?.message);
    return `## Full Transcript

${transcript}`;
  }
}
function cleanupTempFiles(dir, filePrefix) {
  try {
    const files = fs.readdirSync(dir).filter((f) => f.startsWith(filePrefix));
    for (const f of files) {
      try {
        fs.unlinkSync(path.join(dir, f));
      } catch {
      }
    }
  } catch {
  }
}
async function processVideoUrl(videoUrl, openai4) {
  const filePrefix = `url_audio_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const tmpDir = "/tmp";
  try {
    const downloadResult = await downloadAudio(videoUrl, tmpDir, filePrefix);
    if (typeof downloadResult !== "string") return downloadResult;
    const audioPath = downloadResult;
    await trimIfOversized(audioPath);
    if (!openai4) {
      return { status: 503, message: "AI service is not configured." };
    }
    const transcription = await transcribeAudio(audioPath, openai4);
    if (typeof transcription !== "string") return transcription;
    if (!transcription.trim()) {
      return {
        status: 422,
        message: "Could not extract any content from the video. The video may not have audio or speech."
      };
    }
    const finalText = await summarizeTranscript(transcription, openai4);
    return { text: finalText };
  } finally {
    cleanupTempFiles(tmpDir, filePrefix);
  }
}
var execFileAsync, MAX_DOWNLOAD_TIMEOUT_MS, MAX_FFMPEG_TIMEOUT_MS, MAX_AUDIO_SIZE_MB, MAX_AUDIO_DURATION_SECONDS, LOG_PREFIX;
var init_video_processor = __esm({
  "server/video-processor.ts"() {
    "use strict";
    execFileAsync = promisify(execFile);
    MAX_DOWNLOAD_TIMEOUT_MS = 12e4;
    MAX_FFMPEG_TIMEOUT_MS = 6e4;
    MAX_AUDIO_SIZE_MB = 25;
    MAX_AUDIO_DURATION_SECONDS = 1800;
    LOG_PREFIX = "[VideoProcessor]";
  }
});

// server/ai-providers.ts
var ai_providers_exports = {};
__export(ai_providers_exports, {
  default: () => ai_providers_default
});
import { Router as Router6 } from "express";
import OpenAI2 from "openai";
function requireAI(req, res, next) {
  if (!USE_REAL_AI && IS_PRODUCTION) {
    res.status(503).json(AI_UNAVAILABLE_RESPONSE);
    return;
  }
  next();
}
async function generateNotesWithAI(transcript) {
  if (!openai2) return generateMockNotes(transcript);
  try {
    const response = await openai2.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are an expert academic note-taker. Create comprehensive, well-structured lecture notes from the provided transcript. Include:
- Main headings and subheadings
- Key concepts with clear explanations
- Important definitions and terms
- Summary of main points
- Review questions for self-study
Use Markdown formatting.`
        },
        {
          role: "user",
          content: `Create detailed study notes from this lecture transcript:

${transcript}`
        }
      ],
      max_tokens: 2e3,
      temperature: 0.7
    });
    return response.choices[0]?.message?.content || generateMockNotes(transcript);
  } catch (error) {
    console.error("AI notes generation failed:", error);
    if (IS_PRODUCTION) throw error;
    return generateMockNotes(transcript);
  }
}
async function generateFlashcardsWithAI(transcript) {
  if (!openai2) return generateMockFlashcards(transcript);
  try {
    const response = await openai2.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are an expert educational content creator. Create flashcards from the lecture transcript.
Each flashcard should:
- Have a clear, focused question on the front
- Have a concise, accurate answer on the back
- Cover key concepts, definitions, and important facts
- Be suitable for spaced repetition study

Return a JSON array of objects with "front" and "back" properties.
Example: [{"front": "What is...?", "back": "It is..."}]
Return ONLY valid JSON, no markdown or explanation.`
        },
        {
          role: "user",
          content: `Create 8-12 flashcards from this lecture:

${transcript}`
        }
      ],
      max_tokens: 1500,
      temperature: 0.7
    });
    const content = response.choices[0]?.message?.content || "[]";
    const cleanContent = content.replace(/```json\n?|\n?```/g, "").trim();
    const flashcards = JSON.parse(cleanContent);
    return Array.isArray(flashcards) ? flashcards : generateMockFlashcards(transcript);
  } catch (error) {
    console.error("AI flashcard generation failed:", error);
    if (IS_PRODUCTION) throw error;
    return generateMockFlashcards(transcript);
  }
}
async function generateQuizWithAI(transcript) {
  if (!openai2) return generateMockQuiz(transcript);
  try {
    const response = await openai2.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are an expert educational assessment creator. Create a multiple-choice quiz from the lecture transcript.
Each question should:
- Test understanding of key concepts
- Have 4 answer options
- Have one clearly correct answer
- Include an explanation for the correct answer

Return a JSON array of objects with:
- "question": the question text
- "options": array of 4 answer choices
- "correctAnswer": index of correct answer (0-3)
- "explanation": why this answer is correct

Return ONLY valid JSON, no markdown or explanation.`
        },
        {
          role: "user",
          content: `Create a 5-7 question quiz from this lecture:

${transcript}`
        }
      ],
      max_tokens: 2e3,
      temperature: 0.7
    });
    const content = response.choices[0]?.message?.content || "[]";
    const cleanContent = content.replace(/```json\n?|\n?```/g, "").trim();
    const quiz = JSON.parse(cleanContent);
    return Array.isArray(quiz) ? quiz : generateMockQuiz(transcript);
  } catch (error) {
    console.error("AI quiz generation failed:", error);
    if (IS_PRODUCTION) throw error;
    return generateMockQuiz(transcript);
  }
}
var router6, aiRateLimit, transcriptionRateLimit, IS_PRODUCTION, USE_REAL_AI, openai2, AI_UNAVAILABLE_RESPONSE, MOCK_TRANSCRIPTIONS, generateMockNotes, generateMockFlashcards, generateMockQuiz, ai_providers_default;
var init_ai_providers = __esm({
  "server/ai-providers.ts"() {
    "use strict";
    init_db();
    init_auth();
    init_middleware();
    init_rate_limit();
    init_validate();
    init_validation_schemas();
    init_constants();
    init_client();
    router6 = Router6();
    aiRateLimit = rateLimit("ai-general", AI_RATE_LIMIT);
    transcriptionRateLimit = rateLimit(
      "ai-transcription",
      TRANSCRIPTION_RATE_LIMIT
    );
    IS_PRODUCTION = process.env.NODE_ENV === "production";
    USE_REAL_AI = !!(process.env.AI_INTEGRATIONS_OPENAI_API_KEY && process.env.AI_INTEGRATIONS_OPENAI_BASE_URL);
    console.log(
      `[AI Providers] USE_REAL_AI = ${USE_REAL_AI}, IS_PRODUCTION = ${IS_PRODUCTION}`
    );
    if (USE_REAL_AI) {
      console.log("[AI Providers] Real AI transcription and generation enabled");
    } else if (IS_PRODUCTION) {
      console.error(
        "[AI Providers] WARNING: Production mode without AI keys \u2014 AI endpoints will return 503"
      );
    } else {
      console.log("[AI Providers] Running in mock mode (dev only)");
    }
    openai2 = USE_REAL_AI ? new OpenAI2({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
    }) : null;
    AI_UNAVAILABLE_RESPONSE = {
      error: "AI temporarily unavailable",
      code: "AI_UNAVAILABLE"
    };
    MOCK_TRANSCRIPTIONS = [
      "Today we're going to discuss the fundamental principles of cellular biology. The cell is the basic unit of life, and understanding its structure is crucial for biology students. Let's start with the cell membrane, which is a phospholipid bilayer that controls what enters and exits the cell.",
      "In this lecture, we'll explore the French Revolution and its impact on modern democracy. The revolution began in 1789 with the storming of the Bastille. Key figures include Robespierre, Danton, and Napoleon Bonaparte.",
      "Welcome to Introduction to Calculus. Today we'll cover derivatives and their applications. The derivative represents the rate of change of a function. Remember, the derivative of x^n is nx^(n-1).",
      "This session focuses on organic chemistry reactions. We'll study nucleophilic substitution reactions, specifically SN1 and SN2 mechanisms. Understanding the difference between these mechanisms is essential for predicting reaction outcomes.",
      "Today's topic is macroeconomics and GDP calculation. Gross Domestic Product measures the total value of goods and services produced in a country. We use the formula GDP = C + I + G + (X-M)."
    ];
    generateMockNotes = (transcript) => {
      const lines = transcript.split(". ");
      const keyPoints = lines.slice(0, 5).map((line, i) => `${i + 1}. ${line.trim()}`);
      return `# Lecture Notes

## Key Concepts
${keyPoints.join("\n")}

## Summary
This lecture covered important topics related to the subject matter. The main takeaways include understanding fundamental concepts and their practical applications.

## Important Terms
- Term 1: Definition based on lecture content
- Term 2: Another key concept explained
- Term 3: Additional terminology covered

## Review Questions
1. What are the main concepts discussed in this lecture?
2. How do these concepts relate to previous material?
3. What are the practical applications?
`;
    };
    generateMockFlashcards = (transcript) => {
      return [
        {
          front: "What is the main topic of this lecture?",
          back: "The lecture covers fundamental concepts and their applications in the field."
        },
        {
          front: "Define the primary concept discussed",
          back: "The primary concept refers to the foundational principle that underlies the subject matter."
        },
        {
          front: "What are the key components?",
          back: "The key components include structure, function, and interaction between elements."
        },
        {
          front: "How does this relate to previous topics?",
          back: "This builds upon earlier material by extending concepts and introducing new applications."
        },
        {
          front: "What is the practical application?",
          back: "These concepts are applied in real-world scenarios to solve problems and make decisions."
        }
      ];
    };
    generateMockQuiz = (transcript) => {
      return [
        {
          question: "What is the main focus of this lecture?",
          options: [
            "Historical events",
            "Scientific principles",
            "Mathematical concepts",
            "All of the above"
          ],
          correctAnswer: 3,
          explanation: "The lecture covers various aspects including historical context, scientific principles, and mathematical foundations."
        },
        {
          question: "Which of the following best describes the core concept?",
          options: [
            "A simple definition",
            "A complex theory",
            "A practical application",
            "A fundamental principle"
          ],
          correctAnswer: 3,
          explanation: "The core concept is a fundamental principle that forms the basis for understanding the subject."
        },
        {
          question: "How are these concepts typically applied?",
          options: [
            "In theoretical research only",
            "In practical scenarios",
            "Never applied",
            "Only in exams"
          ],
          correctAnswer: 1,
          explanation: "These concepts have practical applications in real-world scenarios."
        },
        {
          question: "What prerequisite knowledge is helpful?",
          options: [
            "None required",
            "Basic understanding of the field",
            "Advanced expertise",
            "Professional experience"
          ],
          correctAnswer: 1,
          explanation: "A basic understanding of the field helps in grasping these concepts more effectively."
        }
      ];
    };
    router6.post(
      "/transcription/request",
      guestOrAuthMiddleware,
      requireAI,
      transcriptionRateLimit,
      checkUsageLimits("recording"),
      checkUsageLimits("transcription"),
      async (req, res) => {
        try {
          const { topicId, durationMinutes = 5, audioBase64 } = req.body;
          if (!topicId) {
            return res.status(400).json({ error: "topicId is required" });
          }
          const topic = await db_default.topic.findFirst({
            where: { id: topicId, userId: req.user?.id ?? ANONYMOUS_USER_ID }
          });
          if (!topic) {
            return res.status(404).json({ error: "Topic not found" });
          }
          const job = await db_default.job.create({
            data: {
              type: "transcription",
              status: "processing",
              input: JSON.stringify({ topicId, durationMinutes })
            }
          });
          (async () => {
            try {
              let transcript;
              if (audioBase64 && USE_REAL_AI) {
                const rawBuffer = Buffer.from(audioBase64, "base64");
                const { buffer: audioBuffer, format } = await ensureCompatibleFormat(rawBuffer);
                transcript = await speechToText(audioBuffer, format);
              } else {
                await new Promise((resolve2) => setTimeout(resolve2, 2e3));
                transcript = MOCK_TRANSCRIPTIONS[Math.floor(Math.random() * MOCK_TRANSCRIPTIONS.length)];
              }
              await db_default.topic.update({
                where: { id: topicId },
                data: { transcript }
              });
              await db_default.job.update({
                where: { id: job.id },
                data: {
                  status: "completed",
                  output: JSON.stringify({ transcript })
                }
              });
              await incrementUsage2(
                req.user?.id ?? ANONYMOUS_USER_ID,
                "transcription",
                durationMinutes
              );
              await incrementUsage2(
                req.user?.id ?? ANONYMOUS_USER_ID,
                "recording",
                1
              );
            } catch (error) {
              console.error("Transcription processing error:", error);
              await db_default.job.update({
                where: { id: job.id },
                data: {
                  status: "failed",
                  error: error instanceof Error ? error.message : "Transcription failed"
                }
              });
            }
          })();
          res.json({
            jobId: job.id,
            status: "processing",
            message: USE_REAL_AI ? "Transcription started" : "Transcription started (mock)"
          });
        } catch (error) {
          console.error("Transcription request error:", error);
          res.status(500).json({ error: "Failed to start transcription" });
        }
      }
    );
    router6.post(
      "/transcription/upload",
      guestOrAuthMiddleware,
      requireAI,
      transcriptionRateLimit,
      checkUsageLimits("recording"),
      checkUsageLimits("transcription"),
      async (req, res) => {
        try {
          const { audioBase64, durationMinutes = 5 } = req.body || {};
          if (!audioBase64) {
            return res.status(400).json({ error: "audioBase64 is required" });
          }
          const userId = req.user?.id ?? ANONYMOUS_USER_ID;
          const job = await db_default.job.create({
            data: {
              userId,
              type: "transcription",
              status: "processing",
              input: JSON.stringify({ durationMinutes })
            }
          });
          (async () => {
            try {
              let transcript;
              if (USE_REAL_AI) {
                const rawBuffer = Buffer.from(audioBase64, "base64");
                const { buffer: audioBuffer, format } = await ensureCompatibleFormat(rawBuffer);
                transcript = await speechToText(audioBuffer, format);
              } else {
                await new Promise((resolve2) => setTimeout(resolve2, 2e3));
                transcript = MOCK_TRANSCRIPTIONS[Math.floor(Math.random() * MOCK_TRANSCRIPTIONS.length)];
              }
              await db_default.job.update({
                where: { id: job.id },
                data: {
                  status: "completed",
                  output: JSON.stringify({ transcript })
                }
              });
              await incrementUsage2(userId, "transcription", durationMinutes);
              await incrementUsage2(userId, "recording", 1);
            } catch (error) {
              console.error("Transcription upload processing error:", error);
              await db_default.job.update({
                where: { id: job.id },
                data: {
                  status: "failed",
                  error: error instanceof Error ? error.message : "Transcription failed"
                }
              });
            }
          })();
          res.json({
            jobId: job.id,
            status: "processing",
            message: USE_REAL_AI ? "Transcription started" : "Transcription started (mock)"
          });
        } catch (error) {
          console.error("Transcription upload error:", error);
          const details = error instanceof Error ? error.message : String(error);
          res.status(500).json({
            error: "Failed to start transcription",
            details
          });
        }
      }
    );
    router6.post(
      "/transcription/attach",
      guestOrAuthMiddleware,
      async (req, res) => {
        try {
          const { jobId, topicId } = req.body || {};
          if (!jobId || !topicId) {
            return res.status(400).json({ error: "jobId and topicId are required" });
          }
          const userId = req.user?.id ?? ANONYMOUS_USER_ID;
          const job = await db_default.job.findFirst({
            where: { id: jobId, userId }
          });
          if (!job) {
            return res.status(404).json({ error: "Job not found" });
          }
          if (job.status !== "completed") {
            return res.status(400).json({ error: "Job not completed yet", status: job.status });
          }
          const topic = await db_default.topic.findFirst({
            where: { id: topicId, userId }
          });
          if (!topic) {
            return res.status(404).json({ error: "Topic not found" });
          }
          let transcript = "";
          try {
            const output = JSON.parse(job.output || "{}");
            transcript = output.transcript || "";
          } catch {
          }
          if (!transcript) {
            return res.status(400).json({ error: "Job has no transcript output" });
          }
          await db_default.topic.update({
            where: { id: topicId },
            data: { transcript, status: "completed" }
          });
          res.json({ success: true, topicId, transcript });
        } catch (error) {
          console.error("Transcription attach error:", error);
          res.status(500).json({
            error: "Failed to attach transcription"
          });
        }
      }
    );
    router6.post(
      "/topics/:topicId/notes/generate",
      guestOrAuthMiddleware,
      requireAI,
      aiRateLimit,
      validateParams(topicIdParams),
      async (req, res) => {
        try {
          const topicId = req.params.topicId;
          const topic = await db_default.topic.findFirst({
            where: { id: topicId, userId: req.user?.id ?? ANONYMOUS_USER_ID }
          });
          if (!topic) {
            return res.status(404).json({ error: "Topic not found" });
          }
          const transcript = topic.transcript || "Default lecture content for note generation.";
          const notes = await generateNotesWithAI(transcript);
          await db_default.topic.update({
            where: { id: topicId },
            data: { notes }
          });
          res.json({
            notes,
            message: USE_REAL_AI ? "Notes generated successfully" : "Notes generated successfully (mock)"
          });
        } catch (error) {
          console.error("Generate notes error:", error);
          res.status(500).json({ error: "Failed to generate notes" });
        }
      }
    );
    router6.post(
      "/topics/:topicId/flashcards/generate",
      guestOrAuthMiddleware,
      requireAI,
      aiRateLimit,
      validateParams(topicIdParams),
      async (req, res) => {
        try {
          const topicId = req.params.topicId;
          const topic = await db_default.topic.findFirst({
            where: { id: topicId, userId: req.user?.id ?? ANONYMOUS_USER_ID }
          });
          if (!topic) {
            return res.status(404).json({ error: "Topic not found" });
          }
          const transcript = topic.transcript || "Default content";
          const aiFlashcards = await generateFlashcardsWithAI(transcript);
          const flashcards = await Promise.all(
            aiFlashcards.map(
              (fc, index) => db_default.flashcard.create({
                data: {
                  topicId,
                  front: fc.front,
                  back: fc.back,
                  orderIndex: index
                }
              })
            )
          );
          res.json({
            flashcards,
            message: USE_REAL_AI ? "Flashcards generated successfully" : "Flashcards generated successfully (mock)"
          });
        } catch (error) {
          console.error("Generate flashcards error:", error);
          res.status(500).json({ error: "Failed to generate flashcards" });
        }
      }
    );
    router6.post(
      "/topics/:topicId/quizzes/generate",
      guestOrAuthMiddleware,
      requireAI,
      aiRateLimit,
      validateParams(topicIdParams),
      checkUsageLimits("quiz"),
      async (req, res) => {
        try {
          const topicId = req.params.topicId;
          const topic = await db_default.topic.findFirst({
            where: { id: topicId, userId: req.user?.id ?? ANONYMOUS_USER_ID }
          });
          if (!topic) {
            return res.status(404).json({ error: "Topic not found" });
          }
          const transcript = topic.transcript || "Default content";
          const aiQuestions = await generateQuizWithAI(transcript);
          const quiz = await db_default.quiz.create({
            data: {
              topicId,
              title: `Quiz: ${topic.name}`
            }
          });
          const questions = await Promise.all(
            aiQuestions.map(
              (q, index) => db_default.quizQuestion.create({
                data: {
                  quizId: quiz.id,
                  question: q.question,
                  options: JSON.stringify(q.options),
                  correctAnswer: q.correctAnswer,
                  explanation: q.explanation,
                  orderIndex: index
                }
              })
            )
          );
          res.json({
            quiz: { ...quiz, questions },
            message: USE_REAL_AI ? "Quiz generated successfully" : "Quiz generated successfully (mock)"
          });
        } catch (error) {
          console.error("Generate quiz error:", error);
          res.status(500).json({ error: "Failed to generate quiz" });
        }
      }
    );
    router6.post(
      "/quizzes/:quizId/submit",
      guestOrAuthMiddleware,
      validateParams(quizIdParams),
      validateBody(quizSubmitBody),
      async (req, res) => {
        try {
          const quizId = req.params.quizId;
          const { answers } = req.body;
          const quiz = await db_default.quiz.findFirst({
            where: { id: quizId },
            include: { questions: true }
          });
          if (!quiz) {
            return res.status(404).json({ error: "Quiz not found" });
          }
          let score = 0;
          const results = quiz.questions.map((q) => {
            const userAnswer = answers[q.id];
            const isCorrect = userAnswer === q.correctAnswer;
            if (isCorrect) score++;
            return {
              questionId: q.id,
              userAnswer,
              correctAnswer: q.correctAnswer,
              isCorrect,
              explanation: q.explanation
            };
          });
          const attempt = await db_default.quizAttempt.create({
            data: {
              userId: req.user?.id ?? ANONYMOUS_USER_ID,
              quizId,
              score,
              totalQuestions: quiz.questions.length,
              answers: JSON.stringify(answers)
            }
          });
          res.json({
            attempt,
            score,
            totalQuestions: quiz.questions.length,
            percentage: score / quiz.questions.length * 100,
            results
          });
        } catch (error) {
          console.error("Submit quiz error:", error);
          res.status(500).json({ error: "Failed to submit quiz" });
        }
      }
    );
    router6.get(
      "/jobs/:jobId",
      guestOrAuthMiddleware,
      validateParams(jobIdParams),
      async (req, res) => {
        try {
          const jobId = req.params.jobId;
          const userId = req.user?.id ?? ANONYMOUS_USER_ID;
          const job = await db_default.job.findFirst({
            where: { id: jobId, userId }
          });
          if (!job) {
            return res.status(404).json({ error: "Job not found" });
          }
          res.json({
            job: {
              id: job.id,
              type: job.type,
              status: job.status,
              output: job.output ? JSON.parse(job.output) : null,
              error: job.error,
              createdAt: job.createdAt
            }
          });
        } catch (error) {
          console.error("Get job error:", error);
          res.status(500).json({ error: "Failed to get job status" });
        }
      }
    );
    router6.post(
      "/ocr/extract",
      guestOrAuthMiddleware,
      requireAI,
      aiRateLimit,
      validateBody(ocrExtractBody),
      async (req, res) => {
        try {
          const { imageBase64, topicId, fileType } = req.body;
          if (!imageBase64) {
            return res.status(400).json({ error: "imageBase64 is required" });
          }
          const base64SizeMB = imageBase64.length * 3 / 4 / 1024 / 1024;
          if (base64SizeMB > 40) {
            return res.status(400).json({
              error: "File is too large. Please use a smaller file (under 40MB)."
            });
          }
          let extractedText = "";
          if (openai2) {
            try {
              if (fileType === "pdf") {
                const pdfText = Buffer.from(imageBase64, "base64").toString(
                  "utf-8"
                );
                const cleanText = pdfText.replace(/[^\x20-\x7E\n\r\t]/g, " ").replace(/\s{3,}/g, "\n").trim();
                if (cleanText.length > 50) {
                  const response = await openai2.chat.completions.create({
                    model: "gpt-4o-mini",
                    messages: [
                      {
                        role: "system",
                        content: "You are a study assistant. Extract and organize the meaningful text content from the following document. Format it clearly with proper structure, headings, and bullet points where appropriate."
                      },
                      {
                        role: "user",
                        content: cleanText.substring(0, 1e4)
                      }
                    ],
                    max_tokens: 2e3
                  });
                  extractedText = response.choices[0]?.message?.content || cleanText.substring(0, 2e3);
                } else {
                  extractedText = cleanText || "Could not extract readable text from this PDF.";
                }
              } else {
                const response = await openai2.chat.completions.create({
                  model: "gpt-4o-mini",
                  messages: [
                    {
                      role: "user",
                      content: [
                        {
                          type: "text",
                          text: "Extract all text visible in this image. If it's a whiteboard or handwritten notes, transcribe everything you can read. Format the output clearly with proper structure."
                        },
                        {
                          type: "image_url",
                          image_url: {
                            url: `data:image/jpeg;base64,${imageBase64}`,
                            detail: "auto"
                          }
                        }
                      ]
                    }
                  ],
                  max_tokens: 2e3
                });
                extractedText = response.choices[0]?.message?.content || "";
              }
            } catch (error) {
              console.error(
                "OCR extraction failed:",
                error?.status,
                error?.message
              );
              if (error?.status === 413) {
                return res.status(400).json({
                  error: "Image is too large for processing. Please use a smaller or lower-resolution image."
                });
              }
            }
          }
          if (!extractedText) {
            extractedText = "Could not extract text. Please ensure AI services are available and try again.";
          }
          if (topicId) {
            try {
              await db_default.whiteboardImage.create({
                data: {
                  topicId,
                  filename: `whiteboard_${Date.now()}.jpg`,
                  filepath: `/uploads/whiteboards/${Date.now()}.jpg`,
                  ocrText: extractedText
                }
              });
            } catch (dbError) {
              console.log(
                "Skipping DB save for whiteboard image (topic may be local-only):",
                dbError?.code
              );
            }
          }
          res.json({
            text: extractedText,
            message: USE_REAL_AI ? "OCR extraction completed" : "OCR extraction completed (mock)"
          });
        } catch (error) {
          console.error("OCR extraction error:", error);
          res.status(500).json({ error: "Failed to extract text from image" });
        }
      }
    );
    router6.post(
      "/summarize",
      guestOrAuthMiddleware,
      requireAI,
      aiRateLimit,
      validateBody(summarizeBody),
      async (req, res) => {
        try {
          const { text } = req.body;
          if (!text || typeof text !== "string") {
            return res.status(400).json({ error: "Text is required" });
          }
          let summary = "";
          if (openai2) {
            try {
              const response = await openai2.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                  {
                    role: "system",
                    content: `You are a study assistant. Summarize the following notes or textbook content into a clear, concise summary that captures the key concepts. Format with:
              
1. A brief overview paragraph
2. Key concepts as bullet points
3. Important terms and definitions
4. Main takeaways

Keep the summary focused and student-friendly.`
                  },
                  {
                    role: "user",
                    content: text
                  }
                ],
                max_tokens: 1e3
              });
              summary = response.choices[0]?.message?.content || "";
            } catch (error) {
              console.error("Summarization failed:", error);
            }
          }
          if (!summary) {
            const words = text.split(/\s+/);
            const keyPhrases = words.slice(0, Math.min(50, words.length)).join(" ");
            summary = `## Summary

**Overview:** ${keyPhrases}...

**Key Concepts:**
- Main concept from the notes
- Supporting ideas and details
- Important relationships between topics

**Important Terms:**
- **Term 1:** Definition based on the content
- **Term 2:** Another key term explained

**Takeaways:**
This content covers essential material for understanding the subject. Focus on the key concepts and their applications.`;
          }
          res.json({ summary });
        } catch (error) {
          console.error("Summarization error:", error);
          res.status(500).json({ error: "Failed to summarize text" });
        }
      }
    );
    router6.post(
      "/notes-to-flashcards",
      guestOrAuthMiddleware,
      requireAI,
      aiRateLimit,
      validateBody(notesToFlashcardsBody),
      async (req, res) => {
        try {
          const { text, topicId } = req.body;
          if (!text || typeof text !== "string") {
            return res.status(400).json({ error: "Text is required" });
          }
          let flashcards = [];
          if (openai2) {
            try {
              const response = await openai2.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                  {
                    role: "system",
                    content: `You are a study assistant creating flashcards from notes. Generate 5-10 flashcards that cover the key concepts. Return as JSON array with "front" (question) and "back" (answer) fields. Focus on:
- Key definitions and terms
- Important concepts and their explanations  
- Cause and effect relationships
- Comparisons between concepts

Return ONLY valid JSON array, no markdown.`
                  },
                  {
                    role: "user",
                    content: text
                  }
                ],
                max_tokens: 1500
              });
              const content = response.choices[0]?.message?.content || "[]";
              const cleaned = content.replace(/```json\n?|\n?```/g, "").trim();
              flashcards = JSON.parse(cleaned);
            } catch (error) {
              console.error("Flashcard generation failed:", error);
            }
          }
          if (flashcards.length === 0) {
            flashcards = generateMockFlashcards(text);
          }
          if (topicId) {
            try {
              for (const card of flashcards) {
                await db_default.flashcard.create({
                  data: {
                    topicId,
                    front: card.front,
                    back: card.back
                  }
                });
              }
            } catch (dbError) {
              console.log(
                "Skipping DB save for flashcards (topic may be local-only):",
                dbError?.code
              );
            }
          }
          res.json({
            flashcards,
            count: flashcards.length,
            message: USE_REAL_AI ? "Flashcards generated from notes" : "Flashcards generated (mock)"
          });
        } catch (error) {
          console.error("Notes to flashcards error:", error);
          res.status(500).json({ error: "Failed to generate flashcards from notes" });
        }
      }
    );
    router6.post(
      "/notes-to-quiz",
      guestOrAuthMiddleware,
      requireAI,
      aiRateLimit,
      validateBody(notesToQuizBody),
      async (req, res) => {
        try {
          const { text, topicId } = req.body;
          if (!text || typeof text !== "string") {
            return res.status(400).json({ error: "Text is required" });
          }
          let questions = [];
          if (openai2) {
            try {
              const response = await openai2.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                  {
                    role: "system",
                    content: `You are a study assistant creating quiz questions from notes. Generate 4-6 multiple choice questions. Return as JSON array with:
- "question": the question text
- "options": array of 4 answer choices
- "correctAnswer": index (0-3) of correct answer
- "explanation": brief explanation of why the answer is correct

Focus on testing comprehension of key concepts. Return ONLY valid JSON array, no markdown.`
                  },
                  {
                    role: "user",
                    content: text
                  }
                ],
                max_tokens: 1500
              });
              const content = response.choices[0]?.message?.content || "[]";
              const cleaned = content.replace(/```json\n?|\n?```/g, "").trim();
              questions = JSON.parse(cleaned);
            } catch (error) {
              console.error("Quiz generation failed:", error);
            }
          }
          if (questions.length === 0) {
            questions = generateMockQuiz(text);
          }
          if (topicId) {
            try {
              const quiz = await db_default.quiz.create({
                data: {
                  topicId,
                  title: "Notes Quiz"
                }
              });
              for (let i = 0; i < questions.length; i++) {
                const q = questions[i];
                await db_default.quizQuestion.create({
                  data: {
                    quizId: quiz.id,
                    question: q.question,
                    options: JSON.stringify(q.options),
                    correctAnswer: q.correctAnswer,
                    explanation: q.explanation,
                    orderIndex: i
                  }
                });
              }
            } catch (dbError) {
              console.log(
                "Skipping DB save for quiz (topic may be local-only):",
                dbError?.code
              );
            }
          }
          res.json({
            questions,
            count: questions.length,
            message: USE_REAL_AI ? "Quiz generated from notes" : "Quiz generated (mock)"
          });
        } catch (error) {
          console.error("Notes to quiz error:", error);
          res.status(500).json({ error: "Failed to generate quiz from notes" });
        }
      }
    );
    router6.post(
      "/video/extract",
      guestOrAuthMiddleware,
      requireAI,
      transcriptionRateLimit,
      validateBody(videoExtractBody),
      async (req, res) => {
        try {
          const { videoBase64, topicId } = req.body;
          if (!videoBase64) {
            return res.status(400).json({ error: "videoBase64 is required" });
          }
          let extractedText = "";
          if (openai2) {
            try {
              const videoBuffer = Buffer.from(videoBase64, "base64");
              const tmpPath = `/tmp/video_${Date.now()}.mp4`;
              const tmpAudioPath = `/tmp/audio_${Date.now()}.wav`;
              const fs3 = await import("fs");
              fs3.writeFileSync(tmpPath, videoBuffer);
              const { execSync: execSync2 } = await import("child_process");
              try {
                execSync2(
                  `ffmpeg -i ${tmpPath} -vn -acodec pcm_s16le -ar 16000 -ac 1 ${tmpAudioPath} -y 2>/dev/null`
                );
                const audioBuffer = fs3.readFileSync(tmpAudioPath);
                const audioFile = new File([audioBuffer], "audio.wav", {
                  type: "audio/wav"
                });
                const transcription = await openai2.audio.transcriptions.create({
                  model: "whisper-1",
                  file: audioFile
                });
                extractedText = transcription.text || "";
                try {
                  fs3.unlinkSync(tmpPath);
                } catch {
                }
                try {
                  fs3.unlinkSync(tmpAudioPath);
                } catch {
                }
              } catch (ffmpegError) {
                console.error(
                  "FFmpeg extraction failed, trying direct transcription:",
                  ffmpegError
                );
                const videoFile = new File([videoBuffer], "video.mp4", {
                  type: "video/mp4"
                });
                const transcription = await openai2.audio.transcriptions.create({
                  model: "whisper-1",
                  file: videoFile
                });
                extractedText = transcription.text || "";
                try {
                  fs3.unlinkSync(tmpPath);
                } catch {
                }
              }
              if (extractedText) {
                const summaryRes = await openai2.chat.completions.create({
                  model: "gpt-4o-mini",
                  messages: [
                    {
                      role: "system",
                      content: "Summarize this video transcription into clear study notes. Include key points, important details, and main takeaways. Format with bullet points and section headers."
                    },
                    { role: "user", content: extractedText }
                  ],
                  max_tokens: 1500
                });
                const summary = summaryRes.choices[0]?.message?.content || "";
                extractedText = `## Video Summary

${summary}

---

## Full Transcript

${extractedText}`;
              }
            } catch (error) {
              console.error("Video extraction failed:", error);
            }
          }
          if (!extractedText) {
            extractedText = "Video processing requires AI integration. The video was received but could not be processed without the AI service.";
          }
          if (topicId) {
            try {
              await db_default.whiteboardImage.create({
                data: {
                  topicId,
                  filename: `video_${Date.now()}.mp4`,
                  filepath: `/uploads/videos/${Date.now()}.mp4`,
                  ocrText: extractedText
                }
              });
            } catch (dbError) {
              console.log(
                "Skipping DB save for video extract (topic may be local-only):",
                dbError?.code
              );
            }
          }
          res.json({
            text: extractedText,
            message: USE_REAL_AI ? "Video processed successfully" : "Video processed (mock)"
          });
        } catch (error) {
          console.error("Video extraction error:", error);
          res.status(500).json({ error: "Failed to process video" });
        }
      }
    );
    router6.post(
      "/video/url-extract",
      guestOrAuthMiddleware,
      requireAI,
      transcriptionRateLimit,
      validateBody(videoUrlBody),
      async (req, res) => {
        try {
          const { videoUrl, topicId } = req.body;
          if (!videoUrl || typeof videoUrl !== "string") {
            return res.status(400).json({ error: "videoUrl is required" });
          }
          const trimmedUrl = videoUrl.trim();
          if (!/^https?:\/\/.+/i.test(trimmedUrl)) {
            return res.status(400).json({
              error: "Please provide a valid URL starting with http:// or https://"
            });
          }
          const { processVideoUrl: processVideoUrl2, isProcessingError: isProcessingError2 } = await Promise.resolve().then(() => (init_video_processor(), video_processor_exports));
          const result = await processVideoUrl2(trimmedUrl, openai2);
          if (isProcessingError2(result)) {
            return res.status(result.status).json({ error: result.message });
          }
          if (topicId) {
            try {
              await db_default.whiteboardImage.create({
                data: {
                  topicId,
                  filename: `video_url_${Date.now()}.txt`,
                  filepath: trimmedUrl,
                  ocrText: result.text
                }
              });
            } catch (dbError) {
              console.log("[VideoURL] Skipping DB save:", dbError?.code);
            }
          }
          res.json({
            text: result.text,
            message: "Video URL processed successfully"
          });
        } catch (error) {
          console.error("[VideoURL] Unexpected error:", error);
          res.status(500).json({
            error: "An unexpected error occurred while processing the video."
          });
        }
      }
    );
    ai_providers_default = router6;
  }
});

// server/notifications.ts
var notifications_exports = {};
__export(notifications_exports, {
  default: () => notifications_default
});
import { Router as Router7 } from "express";
var router7, notifications_default;
var init_notifications = __esm({
  "server/notifications.ts"() {
    "use strict";
    init_db();
    init_auth();
    router7 = Router7();
    router7.post(
      "/register",
      authMiddleware,
      async (req, res) => {
        try {
          const { token } = req.body;
          if (!token || typeof token !== "string") {
            return res.status(400).json({ error: "Push token is required" });
          }
          await db_default.user.update({
            where: { id: req.user.id },
            data: { pushToken: token }
          });
          res.json({ success: true });
        } catch (error) {
          console.error("Failed to register push token:", error);
          res.status(500).json({ error: "Failed to register push token" });
        }
      }
    );
    router7.delete(
      "/register",
      authMiddleware,
      async (req, res) => {
        try {
          await db_default.user.update({
            where: { id: req.user.id },
            data: { pushToken: null }
          });
          res.json({ success: true });
        } catch (error) {
          res.status(500).json({ error: "Failed to unregister push token" });
        }
      }
    );
    notifications_default = router7;
  }
});

// server/writing.ts
var writing_exports = {};
__export(writing_exports, {
  default: () => writing_default
});
import { Router as Router8 } from "express";
import OpenAI3 from "openai";
async function getUserPlan2(userId) {
  try {
    const ent = await db_default.entitlement.findUnique({ where: { userId } });
    if (!ent) return "FREE";
    if (ent.expiresAt && ent.expiresAt.getTime() < Date.now()) return "FREE";
    const p = ent.plan.toUpperCase();
    if (p === "PRO") return "PRO";
    if (p === "PLUS") return "PLUS";
    return "FREE";
  } catch {
    return "FREE";
  }
}
function cleanBuckets(map) {
  const now = Date.now();
  for (const [k, v] of map) {
    if (v.resetAt <= now) map.delete(k);
  }
}
function writingRateLimit() {
  return async (req, res, next) => {
    const uid = req.user.id;
    const now = Date.now();
    let minRec = minuteBuckets.get(uid);
    if (!minRec || minRec.resetAt <= now) {
      minRec = { count: 0, resetAt: now + 6e4 };
      minuteBuckets.set(uid, minRec);
    }
    minRec.count++;
    if (minRec.count > 2) {
      return res.status(429).json({ code: "RATE_LIMIT_MINUTE" });
    }
    const isReviewer = !!REVIEWER_EMAIL && req.user?.email === REVIEWER_EMAIL;
    const plan = isReviewer ? "PRO" : await getUserPlan2(uid);
    const dayMax = plan === "FREE" ? 5 : 50;
    const dayKey = `${uid}:day`;
    let dayRec = dayBuckets.get(dayKey);
    if (!dayRec || dayRec.resetAt <= now) {
      const midnight = /* @__PURE__ */ new Date();
      midnight.setHours(23, 59, 59, 999);
      dayRec = { count: 0, resetAt: midnight.getTime() };
      dayBuckets.set(dayKey, dayRec);
    }
    dayRec.count++;
    if (dayRec.count > dayMax) {
      return res.status(429).json({ code: "RATE_LIMIT_DAY" });
    }
    next();
  };
}
async function callAI(userPrompt) {
  if (!openai3) {
    if (IS_PRODUCTION2) return null;
    return null;
  }
  const resp = await openai3.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt }
    ],
    max_tokens: 3e3,
    temperature: 0.7
  });
  return resp.choices[0]?.message?.content ?? null;
}
function requireAI2(_req, res, next) {
  if (!USE_REAL_AI2 && IS_PRODUCTION2) {
    return res.status(503).json({ code: "AI_UNAVAILABLE" });
  }
  next();
}
var router8, IS_PRODUCTION2, USE_REAL_AI2, openai3, REVIEWER_EMAIL, minuteBuckets, dayBuckets, SYSTEM_PROMPT, writing_default;
var init_writing = __esm({
  "server/writing.ts"() {
    "use strict";
    init_auth();
    init_db();
    router8 = Router8();
    IS_PRODUCTION2 = process.env.NODE_ENV === "production";
    USE_REAL_AI2 = !!(process.env.AI_INTEGRATIONS_OPENAI_API_KEY && process.env.AI_INTEGRATIONS_OPENAI_BASE_URL);
    openai3 = USE_REAL_AI2 ? new OpenAI3({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
    }) : null;
    REVIEWER_EMAIL = process.env.REVIEWER_EMAIL || "";
    minuteBuckets = /* @__PURE__ */ new Map();
    dayBuckets = /* @__PURE__ */ new Map();
    setInterval(() => cleanBuckets(minuteBuckets), 6e4);
    setInterval(() => cleanBuckets(dayBuckets), 3e5);
    SYSTEM_PROMPT = `You are an educational writing tutor. Your purpose is to help students improve their own academic writing skills.

Rules you MUST follow:
- Never write essays, papers, or assignments on the student's behalf that could be submitted as their own work without substantial personal contribution.
- Never fabricate citations, references, or sources. If a source is needed, insert "(Source needed)" as a placeholder.
- Never help students evade plagiarism detection.
- Always encourage original thinking and proper attribution.
- Focus on teaching writing techniques, not producing final submissions.`;
    router8.post(
      "/outline",
      guestOrAuthMiddleware,
      requireAI2,
      writingRateLimit(),
      async (req, res) => {
        try {
          const { thesis, subject, level } = req.body;
          if (!thesis) return res.status(400).json({ error: "thesis is required" });
          const prompt = `Create an academic paper outline for the following thesis:
"${thesis}"
${subject ? `Subject area: ${subject}` : ""}
${level ? `Academic level: ${level}` : ""}

Provide:
1. A refined thesis statement
2. 3-5 main sections with brief descriptions of what each should cover
3. A counterargument section
4. A conclusion section
5. 5 search keywords the student should use to find credible sources

Format as structured text with clear headings.`;
          const result = await callAI(prompt);
          if (!result) {
            if (IS_PRODUCTION2)
              return res.status(503).json({ code: "AI_UNAVAILABLE" });
            return res.json({
              outline: `# Outline for: ${thesis}

## 1. Introduction
Present the thesis: "${thesis}"

## 2. Background & Context
Provide relevant history and definitions.

## 3. Main Argument
Present evidence supporting the thesis.

## 4. Supporting Evidence
Additional data, studies, and examples.

## 5. Counterargument
Address opposing viewpoints and rebut them.

## 6. Conclusion
Summarize findings and restate thesis.

### Search Keywords
1. ${subject || "academic research"}
2. ${thesis.split(" ").slice(0, 3).join(" ")}
3. scholarly analysis
4. peer-reviewed studies
5. literature review`
            });
          }
          res.json({ outline: result });
        } catch (error) {
          console.error("Writing outline error:", error);
          res.status(500).json({ error: "Failed to generate outline" });
        }
      }
    );
    router8.post(
      "/draft",
      guestOrAuthMiddleware,
      requireAI2,
      writingRateLimit(),
      async (req, res) => {
        try {
          const { outlineText, wordCount, tone } = req.body;
          if (!outlineText)
            return res.status(400).json({ error: "outlineText is required" });
          const targetWords = wordCount || 800;
          const low = Math.round(targetWords * 0.9);
          const high = Math.round(targetWords * 1.1);
          const prompt = `Using the following outline, write a draft academic paper. The draft should be ${low}-${high} words.
${tone ? `Tone: ${tone}` : "Tone: academic and formal"}

Outline:
${outlineText}

At the end, add a "What to verify" checklist with items the student should fact-check, sources they need to find, and claims that need citations. Mark any unsupported claims with "(Source needed)".`;
          const result = await callAI(prompt);
          if (!result) {
            if (IS_PRODUCTION2)
              return res.status(503).json({ code: "AI_UNAVAILABLE" });
            return res.json({
              draft: `# Draft

Based on the provided outline, here is a starting draft.

${outlineText}

---

## What to verify
- [ ] Find primary sources for main claims
- [ ] Verify statistical data (Source needed)
- [ ] Add proper citations in required format
- [ ] Check all quotes for accuracy
- [ ] Confirm counterargument sources`
            });
          }
          res.json({ draft: result });
        } catch (error) {
          console.error("Writing draft error:", error);
          res.status(500).json({ error: "Failed to generate draft" });
        }
      }
    );
    router8.post(
      "/revise",
      guestOrAuthMiddleware,
      requireAI2,
      writingRateLimit(),
      async (req, res) => {
        try {
          const { text, instructions } = req.body;
          if (!text) return res.status(400).json({ error: "text is required" });
          const prompt = `Revise the following academic text to improve its quality. ${instructions ? `Special instructions: ${instructions}` : ""}

Original text:
${text}

Provide:
1. The improved version of the full text
2. A bullet-point summary of exactly 5 improvements you made and why

Do NOT add new factual claims. Mark any existing unsupported claims with "(Source needed)".`;
          const result = await callAI(prompt);
          if (!result) {
            if (IS_PRODUCTION2)
              return res.status(503).json({ code: "AI_UNAVAILABLE" });
            return res.json({
              revised: `${text}

---

### Improvements Made
- Improved sentence structure for clarity
- Enhanced transitions between paragraphs
- Strengthened topic sentences
- Refined word choice for academic tone
- Added logical connectors for better flow`
            });
          }
          res.json({ revised: result });
        } catch (error) {
          console.error("Writing revise error:", error);
          res.status(500).json({ error: "Failed to revise text" });
        }
      }
    );
    router8.post(
      "/style-edit",
      guestOrAuthMiddleware,
      requireAI2,
      writingRateLimit(),
      async (req, res) => {
        try {
          const { text, mode } = req.body;
          if (!text) return res.status(400).json({ error: "text is required" });
          const validModes = [
            "clearer",
            "formal",
            "casual",
            "shorten",
            "flow",
            "grammar"
          ];
          const editMode = validModes.includes(mode) ? mode : "clearer";
          const modeInstructions = {
            clearer: "Rewrite for maximum clarity. Simplify complex sentences. Remove ambiguity.",
            formal: "Adjust the tone to be more formal and academic. Use precise vocabulary.",
            casual: "Adjust the tone to be more conversational and accessible while keeping accuracy.",
            shorten: "Condense the text by ~30% while preserving all key information.",
            flow: "Improve the flow and transitions between sentences and paragraphs.",
            grammar: "Fix all grammar, punctuation, and spelling errors. Do not change meaning or style."
          };
          const prompt = `Apply the following style edit to the text. Mode: "${editMode}"
Instructions: ${modeInstructions[editMode]}

IMPORTANT: Do NOT introduce any new facts, claims, or information. Only edit the style/presentation.

Text:
${text}`;
          const result = await callAI(prompt);
          if (!result) {
            if (IS_PRODUCTION2)
              return res.status(503).json({ code: "AI_UNAVAILABLE" });
            return res.json({ edited: text });
          }
          res.json({ edited: result });
        } catch (error) {
          console.error("Writing style-edit error:", error);
          res.status(500).json({ error: "Failed to style-edit text" });
        }
      }
    );
    router8.post(
      "/clean",
      guestOrAuthMiddleware,
      async (req, res) => {
        try {
          const { text } = req.body;
          if (!text || typeof text !== "string") {
            return res.status(400).json({ error: "text is required" });
          }
          const original = text;
          let cleaned = text;
          cleaned = cleaned.replace(/<[^>]*>/g, "");
          cleaned = cleaned.replace(
            /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g,
            ""
          );
          cleaned = cleaned.replace(/[\u2018\u2019]/g, "'");
          cleaned = cleaned.replace(/[\u201C\u201D]/g, '"');
          cleaned = cleaned.replace(/\u2014/g, "\u2014");
          cleaned = cleaned.replace(/\u2013/g, "\u2013");
          cleaned = cleaned.replace(/\u2026/g, "...");
          cleaned = cleaned.replace(/[^\S\n]+/g, " ");
          cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
          cleaned = cleaned.trim();
          const htmlTagsRemoved = (original.match(/<[^>]*>/g) || []).length;
          const zeroWidthRemoved = (original.match(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g) || []).length;
          const smartQuotesFixed = (original.match(/[\u2018\u2019\u201C\u201D]/g) || []).length;
          const charDiff = original.length - cleaned.length;
          res.json({
            cleanedText: cleaned,
            stats: {
              originalLength: original.length,
              cleanedLength: cleaned.length,
              charactersRemoved: charDiff,
              htmlTagsRemoved,
              zeroWidthCharsRemoved: zeroWidthRemoved,
              smartQuotesNormalized: smartQuotesFixed
            }
          });
        } catch (error) {
          console.error("Writing clean error:", error);
          res.status(500).json({ error: "Failed to clean text" });
        }
      }
    );
    writing_default = router8;
  }
});

// server/search.ts
var search_exports = {};
__export(search_exports, {
  default: () => search_default
});
import { Router as Router9 } from "express";
var router9, search_default;
var init_search = __esm({
  "server/search.ts"() {
    "use strict";
    init_db();
    init_auth();
    router9 = Router9();
    router9.get(
      "/search",
      guestOrAuthMiddleware,
      async (req, res) => {
        try {
          const { q, type } = req.query;
          const query = (q || "").trim().toLowerCase();
          if (!query || query.length < 2) {
            return res.json({
              flashcards: [],
              topics: [],
              courses: [],
              total: 0
            });
          }
          const results = {
            flashcards: [],
            topics: [],
            courses: []
          };
          const searchTypes = type ? [type] : ["flashcards", "topics", "courses"];
          if (searchTypes.includes("flashcards")) {
            const flashcards = await db_default.flashcard.findMany({
              where: {
                topic: {
                  userId: req.user.id
                },
                OR: [{ front: { contains: query } }, { back: { contains: query } }]
              },
              include: {
                topic: {
                  include: {
                    course: true
                  }
                }
              },
              take: 20
            });
            results.flashcards = flashcards.map((f) => ({
              id: f.id,
              front: f.front,
              back: f.back,
              type: "flashcard",
              topicId: f.topicId,
              topic: f.topic?.name,
              course: f.topic?.course?.name
            }));
          }
          if (searchTypes.includes("topics")) {
            const topics = await db_default.topic.findMany({
              where: {
                userId: req.user.id,
                name: { contains: query }
              },
              include: {
                course: true,
                flashcards: {
                  select: { id: true }
                },
                quizzes: {
                  select: { id: true }
                }
              },
              take: 10
            });
            results.topics = topics.map((t) => ({
              id: t.id,
              name: t.name,
              type: "topic",
              course: t.course?.name,
              courseId: t.courseId,
              flashcardCount: t.flashcards.length,
              quizCount: t.quizzes.length
            }));
          }
          if (searchTypes.includes("courses")) {
            const courses = await db_default.course.findMany({
              where: {
                userId: req.user.id,
                name: { contains: query }
              },
              include: {
                semester: true,
                topics: {
                  select: { id: true }
                }
              },
              take: 10
            });
            results.courses = courses.map((c) => ({
              id: c.id,
              name: c.name,
              type: "course",
              semester: c.semester?.name,
              topicCount: c.topics.length
            }));
          }
          const total = results.flashcards.length + results.topics.length + results.courses.length;
          res.json({ ...results, total });
        } catch (error) {
          console.error("Search error:", error);
          res.status(500).json({ error: "Search failed" });
        }
      }
    );
    search_default = router9;
  }
});

// server/lib/sync.ts
async function exportUserData(userId, since) {
  const sinceFilter = since ? { updatedAt: { gte: since } } : {};
  const [semesters, courses, topics, flashcards, flashcardStats, quizAttempts, recordings] = await Promise.all([
    // Semesters
    db_default.semester.findMany({
      where: { userId, ...sinceFilter },
      orderBy: { startDate: "desc" }
    }),
    // Courses
    db_default.course.findMany({
      where: { userId, ...sinceFilter },
      orderBy: { createdAt: "desc" }
    }),
    // Topics (with transcript + notes — the core content)
    db_default.topic.findMany({
      where: { userId, ...sinceFilter },
      orderBy: [{ courseId: "asc" }, { orderIndex: "asc" }],
      select: {
        id: true,
        userId: true,
        courseId: true,
        name: true,
        orderIndex: true,
        transcript: true,
        notes: true,
        status: true,
        createdAt: true,
        updatedAt: true
      }
    }),
    // Flashcards
    db_default.flashcard.findMany({
      where: {
        topic: { userId },
        ...since ? { updatedAt: { gte: since } } : {}
      },
      orderBy: [{ topicId: "asc" }, { orderIndex: "asc" }]
    }),
    // Flashcard study stats (for spaced repetition)
    db_default.flashcardStat.findMany({
      where: { userId, ...since ? { updatedAt: { gte: since } } : {} }
    }),
    // Quiz attempts
    db_default.quizAttempt.findMany({
      where: { userId, ...since ? { completedAt: { gte: since } } : {} },
      orderBy: { completedAt: "desc" },
      take: 200
    }),
    // Recordings metadata (not the audio file — just the record)
    db_default.recording.findMany({
      where: { userId, ...since ? { createdAt: { gte: since } } : {} },
      select: {
        id: true,
        topicId: true,
        filename: true,
        durationSeconds: true,
        transcriptStatus: true,
        createdAt: true
      }
    })
  ]);
  return {
    exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
    incremental: !!since,
    since: since?.toISOString() ?? null,
    data: {
      semesters,
      courses,
      topics,
      flashcards,
      flashcardStats,
      quizAttempts,
      recordings
    },
    counts: {
      semesters: semesters.length,
      courses: courses.length,
      topics: topics.length,
      flashcards: flashcards.length,
      recordings: recordings.length
    }
  };
}
async function exportTopic(topicId, userId) {
  const topic = await db_default.topic.findFirst({
    where: { id: topicId, userId },
    include: {
      flashcards: {
        include: { stats: { where: { userId } } },
        orderBy: { orderIndex: "asc" }
      },
      quizzes: {
        include: { questions: true }
      },
      recordings: {
        select: {
          id: true,
          filename: true,
          durationSeconds: true,
          transcriptStatus: true,
          createdAt: true
        }
      },
      whiteboardImages: true
    }
  });
  if (!topic) return null;
  return {
    ...topic,
    flashcards: topic.flashcards.map((fc) => ({
      ...fc,
      myStats: fc.stats[0] ?? null
    }))
  };
}
var init_sync = __esm({
  "server/lib/sync.ts"() {
    "use strict";
    init_db();
  }
});

// server/sync.ts
var sync_exports = {};
__export(sync_exports, {
  default: () => sync_default
});
import { Router as Router10 } from "express";
var router10, sync_default;
var init_sync2 = __esm({
  "server/sync.ts"() {
    "use strict";
    init_auth();
    init_sync();
    router10 = Router10();
    router10.get("/export", authMiddleware, async (req, res) => {
      try {
        const userId = req.user.id;
        const sinceParam = req.query.since;
        const since = sinceParam ? new Date(sinceParam) : void 0;
        if (sinceParam && isNaN(since.getTime())) {
          return res.status(400).json({ error: "Invalid 'since' timestamp. Use ISO 8601 format." });
        }
        const data = await exportUserData(userId, since);
        res.json(data);
      } catch (err) {
        console.error("[sync/export] error:", err);
        res.status(500).json({ error: "Failed to export study data" });
      }
    });
    router10.get("/topic/:id", authMiddleware, async (req, res) => {
      try {
        const userId = req.user.id;
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
    router10.get("/status", authMiddleware, async (req, res) => {
      try {
        const userId = req.user.id;
        const data = await exportUserData(userId);
        res.json({
          ok: true,
          counts: data.counts,
          exportedAt: data.exportedAt
        });
      } catch (err) {
        res.status(500).json({ error: "Sync status check failed" });
      }
    });
    sync_default = router10;
  }
});

// server/index.ts
import express from "express";

// server/routes.ts
import { createServer } from "node:http";
function safeMount(app2, path3, router11, label) {
  try {
    app2.use(path3, router11);
    console.log(`  \u2713 Mounted ${label} at ${path3}`);
  } catch (err) {
    console.warn(`  \u2717 Failed to mount ${label} at ${path3}:`, err);
  }
}
async function registerRoutes(app2) {
  console.log("Registering routes...");
  try {
    const { ensureAnonymousUserExists: ensureAnonymousUserExists2, default: studyRoutes } = await Promise.resolve().then(() => (init_study(), study_exports));
    await ensureAnonymousUserExists2();
    safeMount(app2, "/api", studyRoutes, "study");
  } catch (err) {
    console.warn("Failed to load study routes:", err);
  }
  try {
    const authRoutes = (await Promise.resolve().then(() => (init_auth(), auth_exports))).default;
    safeMount(app2, "/api/auth", authRoutes, "auth");
  } catch (err) {
    console.warn("Failed to load auth routes:", err);
  }
  try {
    const billingRoutes = (await Promise.resolve().then(() => (init_billing(), billing_exports))).default;
    safeMount(app2, "/api/billing", billingRoutes, "billing");
  } catch (err) {
    console.warn("Failed to load billing routes:", err);
    app2.use("/api/billing", (_req, res) => {
      res.status(503).json({
        error: "Billing temporarily unavailable",
        code: "BILLING_UNAVAILABLE"
      });
    });
  }
  try {
    const adaptiveRoutes = (await Promise.resolve().then(() => (init_adaptive(), adaptive_exports))).default;
    safeMount(app2, "/api/adaptive", adaptiveRoutes, "adaptive");
  } catch (err) {
    console.warn("Failed to load adaptive routes:", err);
  }
  try {
    const examRoutes = (await Promise.resolve().then(() => (init_exam(), exam_exports))).default;
    safeMount(app2, "/api/exams", examRoutes, "exams");
  } catch (err) {
    console.warn("Failed to load exam routes:", err);
  }
  try {
    const aiRoutes = (await Promise.resolve().then(() => (init_ai_providers(), ai_providers_exports))).default;
    safeMount(app2, "/api/ai", aiRoutes, "ai");
  } catch (err) {
    console.warn("Failed to load AI routes:", err);
    app2.use("/api/ai", (_req, res) => {
      res.status(503).json({
        error: "AI services temporarily unavailable",
        code: "AI_UNAVAILABLE"
      });
    });
  }
  try {
    const notificationsRoutes = (await Promise.resolve().then(() => (init_notifications(), notifications_exports))).default;
    safeMount(app2, "/api/notifications", notificationsRoutes, "notifications");
  } catch (err) {
    console.warn("Failed to load notifications routes:", err);
  }
  try {
    const writingRoutes = (await Promise.resolve().then(() => (init_writing(), writing_exports))).default;
    safeMount(app2, "/api/writing", writingRoutes, "writing");
  } catch (err) {
    console.warn("Failed to load writing routes:", err);
  }
  try {
    const searchRoutes = (await Promise.resolve().then(() => (init_search(), search_exports))).default;
    safeMount(app2, "/api", searchRoutes, "search");
  } catch (err) {
    console.warn("Failed to load search routes:", err);
  }
  try {
    const syncRoutes = (await Promise.resolve().then(() => (init_sync2(), sync_exports))).default;
    safeMount(app2, "/api/sync", syncRoutes, "sync");
  } catch (err) {
    console.warn("Failed to load sync routes:", err);
  }
  console.log("Route registration complete.");
  const httpServer = createServer(app2);
  return httpServer;
}

// server/index.ts
import * as fs2 from "fs";
import * as path2 from "path";
import { createServer as createServer2 } from "node:http";
import { execSync } from "node:child_process";
var app = express();
var log = console.log;
var IS_PRODUCTION3 = process.env.NODE_ENV === "production";
function listenWithRetry(server, port, host, maxRetries = 5, delayMs = 1e3) {
  return new Promise((resolve2, reject) => {
    let attempt = 0;
    function tryListen() {
      attempt++;
      server.listen({ port, host }, () => {
        log(`express server serving on port ${port}`);
        resolve2();
      });
      server.once("error", (err) => {
        server.removeAllListeners("listening");
        if (err.code === "EADDRINUSE" && attempt < maxRetries) {
          log(`Port ${port} in use, retrying in ${delayMs}ms (attempt ${attempt}/${maxRetries})...`);
          setTimeout(tryListen, delayMs);
        } else {
          reject(err);
        }
      });
    }
    tryListen();
  });
}
function setupCors(app2) {
  app2.use((req, res, next) => {
    const origins = /* @__PURE__ */ new Set();
    if (process.env.REPLIT_DEV_DOMAIN) {
      origins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
    }
    if (process.env.REPLIT_DOMAINS) {
      process.env.REPLIT_DOMAINS.split(",").forEach((d) => {
        origins.add(`https://${d.trim()}`);
      });
    }
    const origin = req.header("origin");
    const isLocalhost = origin?.startsWith("http://localhost:") || origin?.startsWith("http://127.0.0.1:");
    if (origin && (origins.has(origin) || isLocalhost)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS"
      );
      res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.header("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });
}
function setupSecurityHeaders(app2) {
  if (IS_PRODUCTION3) {
    app2.set("trust proxy", true);
  }
  app2.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.removeHeader("X-Powered-By");
    if (IS_PRODUCTION3) {
      res.setHeader(
        "Strict-Transport-Security",
        "max-age=63072000; includeSubDomains; preload"
      );
    }
    next();
  });
}
function setupBodyParsing(app2) {
  app2.use(
    express.json({
      limit: "50mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      }
    })
  );
  app2.use(express.urlencoded({ extended: false, limit: "50mb" }));
}
function generateCorrelationId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
var SENSITIVE_LOG_KEYS = /* @__PURE__ */ new Set([
  "token",
  "password",
  "passwordHash",
  "newPassword",
  "code",
  "receiptData",
  "purchaseToken",
  "transactionId",
  "rawReceiptJson",
  "tokenHash"
]);
function redactSensitiveJson(replacerKey, value) {
  if (SENSITIVE_LOG_KEYS.has(replacerKey)) return "[REDACTED]";
  return value;
}
function setupRequestLogging(app2) {
  app2.use((req, res, next) => {
    const correlationId = req.headers["x-correlation-id"] || generateCorrelationId();
    res.setHeader("x-correlation-id", correlationId);
    req.correlationId = correlationId;
    const start = Date.now();
    const requestPath = req.path;
    let capturedJsonResponse = void 0;
    const originalResJson = res.json;
    res.json = function(bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };
    res.on("finish", () => {
      if (!requestPath.startsWith("/api")) return;
      const duration = Date.now() - start;
      let logLine = `[${correlationId}] ${req.method} ${requestPath} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse, redactSensitiveJson)}`;
      }
      if (logLine.length > 120) {
        logLine = logLine.slice(0, 119) + "\u2026";
      }
      log(logLine);
    });
    next();
  });
}
function getAppName() {
  try {
    const appJsonPath = path2.resolve(process.cwd(), "app.json");
    const appJsonContent = fs2.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}
function serveExpoManifest(platform, res) {
  const manifestPath = path2.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json"
  );
  if (!fs2.existsSync(manifestPath)) {
    return res.status(404).json({ error: `Manifest not found for platform: ${platform}` });
  }
  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");
  const manifest = fs2.readFileSync(manifestPath, "utf-8");
  res.send(manifest);
}
function serveLandingPage({
  req,
  res,
  landingPageTemplate,
  appName
}) {
  const forwardedProto = req.header("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol || "https";
  const forwardedHost = req.header("x-forwarded-host");
  const host = forwardedHost || req.get("host");
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;
  const html = landingPageTemplate.replace(/BASE_URL_PLACEHOLDER/g, baseUrl).replace(/EXPS_URL_PLACEHOLDER/g, expsUrl).replace(/APP_NAME_PLACEHOLDER/g, appName);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}
var FALLBACK_HTML = "<!DOCTYPE html><html><head><title>Study Mind</title></head><body><h1>Study Mind</h1></body></html>";
function loadTemplate(filePath) {
  try {
    return fs2.readFileSync(filePath, "utf-8");
  } catch (err) {
    log(`WARNING: Template not found at ${filePath}: ${err}`);
    return FALLBACK_HTML;
  }
}
function configureExpoAndLanding(app2) {
  const landingPageTemplate = loadTemplate(
    path2.resolve(process.cwd(), "server", "templates", "landing-page.html")
  );
  const privacyPolicyTemplate = loadTemplate(
    path2.resolve(process.cwd(), "server", "templates", "privacy-policy.html")
  );
  const termsOfServiceTemplate = loadTemplate(
    path2.resolve(process.cwd(), "server", "templates", "terms-of-service.html")
  );
  const helpSupportTemplate = loadTemplate(
    path2.resolve(process.cwd(), "server", "templates", "help-support.html")
  );
  const appName = getAppName();
  const distDir = path2.resolve(process.cwd(), "dist");
  const hasWebBuild = fs2.existsSync(path2.join(distDir, "index.html"));
  log(
    hasWebBuild ? "Serving static web build from dist/" : "No web build found in dist/"
  );
  log("Expo Go manifests served from static-build/ (if available)");
  app2.use((req, res, next) => {
    if (req.path.startsWith("/api")) {
      return next();
    }
    const platform = req.header("expo-platform");
    if (platform && (platform === "ios" || platform === "android")) {
      if (req.path === "/" || req.path === "/manifest") {
        const manifestPath = path2.resolve(
          process.cwd(),
          "static-build",
          platform,
          "manifest.json"
        );
        if (fs2.existsSync(manifestPath)) {
          return serveExpoManifest(platform, res);
        }
        return res.status(404).json({
          error: "Expo Go manifests not available in this deployment. Use a native build instead."
        });
      }
    }
    if (req.path === "/privacy" || req.path === "/privacy-policy") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      return res.status(200).send(privacyPolicyTemplate);
    }
    if (req.path === "/terms" || req.path === "/terms-of-service") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      return res.status(200).send(termsOfServiceTemplate);
    }
    if (req.path === "/help" || req.path === "/support") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      return res.status(200).send(helpSupportTemplate);
    }
    if (req.path === "/robots.txt") {
      const forwardedProto = req.header("x-forwarded-proto") || req.protocol || "https";
      const host = req.header("x-forwarded-host") || req.get("host") || "localhost";
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.type("text/plain").send(`User-agent: *
Allow: /
Sitemap: ${forwardedProto}://${host}/sitemap.xml
`);
    }
    if (req.path === "/sitemap.xml") {
      const forwardedProto = req.header("x-forwarded-proto") || req.protocol || "https";
      const host = req.header("x-forwarded-host") || req.get("host") || "localhost";
      const baseUrl = `${forwardedProto}://${host}`;
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${baseUrl}/dashboard</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${baseUrl}/privacy</loc>
    <changefreq>monthly</changefreq>
    <priority>0.3</priority>
  </url>
  <url>
    <loc>${baseUrl}/terms</loc>
    <changefreq>monthly</changefreq>
    <priority>0.3</priority>
  </url>
  <url>
    <loc>${baseUrl}/help</loc>
    <changefreq>monthly</changefreq>
    <priority>0.3</priority>
  </url>
</urlset>`;
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.status(200).send(xml);
    }
    next();
  });
  const longCacheOpts = { maxAge: "1y", immutable: true };
  const noCacheOpts = { maxAge: 0, etag: true };
  app2.use(
    "/assets",
    express.static(path2.resolve(process.cwd(), "assets"), longCacheOpts)
  );
  app2.use(
    express.static(path2.resolve(process.cwd(), "static-build"), longCacheOpts)
  );
  if (hasWebBuild) {
    app2.use(
      "/_expo/static",
      express.static(path2.join(distDir, "_expo", "static"), longCacheOpts)
    );
    app2.use(
      "/assets",
      express.static(path2.join(distDir, "assets"), longCacheOpts)
    );
    app2.use(express.static(distDir, noCacheOpts));
    app2.use((req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      if (req.header("expo-platform")) return next();
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path2.join(distDir, "index.html"), (err) => {
        if (err) {
          if (res.headersSent) return;
          serveLandingPage({ req, res, landingPageTemplate, appName });
        }
      });
    });
  } else {
    app2.get("/", (req, res) => {
      serveLandingPage({ req, res, landingPageTemplate, appName });
    });
  }
}
function setupErrorHandler(app2) {
  app2.use((err, _req, res, next) => {
    const error = err;
    const status = error.status || error.statusCode || 500;
    const message = error.message || "Internal Server Error";
    console.error("Internal Server Error:", err);
    if (res.headersSent) {
      return next(err);
    }
    return res.status(status).json({ message });
  });
}
function setupGracefulShutdown(server) {
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${signal} received, shutting down gracefully...`);
    server.close(() => {
      log("Server closed.");
      process.exit(0);
    });
    setTimeout(() => {
      log("Forceful shutdown after timeout.");
      process.exit(1);
    }, 1e4).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
(async () => {
  if (!process.env.DATABASE_URL) {
    console.log("[Startup] DATABASE_URL missing");
  }
  if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    console.error(
      "[Startup] WARNING: AI_INTEGRATIONS_OPENAI_API_KEY is not set. All AI features (transcription, notes, flashcards, quizzes) will return 503."
    );
  }
  if (!process.env.RESEND_API_KEY) {
    console.warn(
      "[Startup] RESEND_API_KEY is not set. Password reset codes will be logged to console instead of emailed."
    );
  }
  try {
    log("[Startup] Syncing database schema...");
    execSync("npx prisma generate && npx prisma db push --accept-data-loss", {
      stdio: "inherit",
      timeout: 6e4,
      env: { ...process.env }
    });
    log("[Startup] Database schema sync complete");
  } catch (err) {
    console.error("[Startup] prisma db push failed, continuing:", err);
  }
  const port = parseInt(process.env.PORT || "5000", 10);
  try {
    setupSecurityHeaders(app);
    setupCors(app);
    setupBodyParsing(app);
    setupRequestLogging(app);
    configureExpoAndLanding(app);
    app.get("/api/version", (_req, res) => {
      res.json({ version: "2026-02-07T1900-resilient-startup" });
    });
    app.get("/api/health", (_req, res) => {
      res.json({ status: "ok", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
    });
    try {
      const server = await registerRoutes(app);
      setupErrorHandler(app);
      await listenWithRetry(server, port, "0.0.0.0");
      setupGracefulShutdown(server);
    } catch (routeErr) {
      log(
        `WARNING: Route registration failed, starting minimal server: ${routeErr}`
      );
      setupErrorHandler(app);
      const fallbackServer = createServer2(app);
      await listenWithRetry(fallbackServer, port, "0.0.0.0");
      setupGracefulShutdown(fallbackServer);
    }
  } catch (fatalErr) {
    console.error("FATAL: Server startup failed:", fatalErr);
    const emergencyApp = express();
    emergencyApp.use((_req, res) => {
      res.status(503).json({ error: "Server starting up", code: "STARTUP_FAILURE" });
    });
    const emergencyServer = createServer2(emergencyApp);
    listenWithRetry(emergencyServer, port, "0.0.0.0").catch((e) => {
      console.error("Emergency server also failed to start:", e);
      process.exit(1);
    });
  }
})();
