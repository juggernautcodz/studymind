import type { Express } from "express";
import { createServer, type Server } from "node:http";

function safeMount(app: Express, path: string, router: any, label: string) {
  try {
    app.use(path, router);
    console.log(`  ✓ Mounted ${label} at ${path}`);
  } catch (err) {
    console.warn(`  ✗ Failed to mount ${label} at ${path}:`, err);
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  console.log("Registering routes...");

  try {
    const { ensureAnonymousUserExists, default: studyRoutes } = await import(
      "./study"
    );
    await ensureAnonymousUserExists();
    safeMount(app, "/api", studyRoutes, "study");
  } catch (err) {
    console.warn("Failed to load study routes:", err);
  }

  try {
    const courseBrainRoutes = (await import("./course-brain")).default;
    safeMount(app, "/api/courses", courseBrainRoutes, "course brain");
  } catch (err) {
    console.warn("Failed to load course brain routes:", err);
  }

  try {
    const sourceLockRoutes = (await import("./source-lock")).default;
    safeMount(app, "/api", sourceLockRoutes, "SourceLock");
  } catch (err) {
    console.warn("Failed to load SourceLock routes:", err);
  }

  try {
    const authRoutes = (await import("./auth")).default;
    safeMount(app, "/api/auth", authRoutes, "auth");
  } catch (err) {
    console.warn("Failed to load auth routes:", err);
  }

  try {
    const billingRoutes = (await import("./billing")).default;
    safeMount(app, "/api/billing", billingRoutes, "billing");
  } catch (err) {
    console.warn("Failed to load billing routes:", err);
    app.use("/api/billing", (_req, res) => {
      res.status(503).json({
        error: "Billing temporarily unavailable",
        code: "BILLING_UNAVAILABLE",
      });
    });
  }

  try {
    const adaptiveRoutes = (await import("./adaptive")).default;
    safeMount(app, "/api/adaptive", adaptiveRoutes, "adaptive");
  } catch (err) {
    console.warn("Failed to load adaptive routes:", err);
  }

  try {
    const examRoutes = (await import("./exam")).default;
    safeMount(app, "/api/exams", examRoutes, "exams");
  } catch (err) {
    console.warn("Failed to load exam routes:", err);
  }

  try {
    const aiRoutes = (await import("./ai-providers")).default;
    safeMount(app, "/api/ai", aiRoutes, "ai");
  } catch (err) {
    console.warn("Failed to load AI routes:", err);
    app.use("/api/ai", (_req, res) => {
      res.status(503).json({
        error: "AI services temporarily unavailable",
        code: "AI_UNAVAILABLE",
      });
    });
  }

  try {
    const notificationsRoutes = (await import("./notifications")).default;
    safeMount(app, "/api/notifications", notificationsRoutes, "notifications");
  } catch (err) {
    console.warn("Failed to load notifications routes:", err);
  }

  try {
    const writingRoutes = (await import("./writing")).default;
    safeMount(app, "/api/writing", writingRoutes, "writing");
  } catch (err) {
    console.warn("Failed to load writing routes:", err);
  }

  try {
    const searchRoutes = (await import("./search")).default;
    safeMount(app, "/api", searchRoutes, "search");
  } catch (err) {
    console.warn("Failed to load search routes:", err);
  }

  // StudyMind Web PC companion — sync API
  try {
    const syncRoutes = (await import("./sync")).default;
    safeMount(app, "/api/sync", syncRoutes, "sync");
  } catch (err) {
    console.warn("Failed to load sync routes:", err);
  }

  console.log("Route registration complete.");

  const httpServer = createServer(app);
  return httpServer;
}
