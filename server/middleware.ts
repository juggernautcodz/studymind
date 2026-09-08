import { Response, NextFunction } from "express";
import prisma from "./db";
import { AuthRequest } from "./auth";
import { PLAN_LIMITS, getUsageInfo, incrementUsage as incrementUsageAtomic } from "./billing";
import { ANONYMOUS_USER_ID } from "./constants";

export const checkUsageLimits = (
  feature:
    | "recording"
    | "transcription"
    | "quiz"
    | "adaptive"
    | "exam"
    | "export",
) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (req.user.id === ANONYMOUS_USER_ID) {
      return next();
    }

    try {
      const entitlement = await prisma.entitlement.findUnique({
        where: { userId: req.user.id },
      });

      const plan = entitlement?.plan || "FREE";
      const limits =
        PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS] || PLAN_LIMITS.FREE;

      switch (feature) {
        case "recording": {
          if (limits.maxRecordingsLifetime === -1) break;
          const usage = await getUsageInfo(req.user.id);
          if (usage.recordingsCount >= limits.maxRecordingsLifetime) {
            return res.status(403).json({
              type: "PAYWALL_REQUIRED",
              error: "Recording limit reached",
              upgradeRequired: true,
              message: `You've reached the limit of ${limits.maxRecordingsLifetime} recordings. Upgrade to continue.`,
            });
          }
          break;
        }

        case "transcription": {
          if (limits.maxTranscriptionMinutesPerMonth === -1) break;
          const usage = await getUsageInfo(req.user.id);
          if (
            usage.transcriptionMinutesUsed >=
            limits.maxTranscriptionMinutesPerMonth
          ) {
            return res.status(403).json({
              type: "PAYWALL_REQUIRED",
              error: "Transcription limit reached",
              upgradeRequired: true,
              message: `You've used all ${limits.maxTranscriptionMinutesPerMonth} transcription minutes this month. Upgrade for more.`,
            });
          }
          break;
        }

        case "quiz":
          if (!limits.hasQuizzes) {
            return res.status(403).json({
              error: "Feature not available",
              upgradeRequired: true,
              message:
                "Quiz generation is a PRO feature. Upgrade to access it!",
            });
          }
          break;

        case "adaptive":
          if (!limits.hasAdaptiveReview) {
            return res.status(403).json({
              error: "Feature not available",
              upgradeRequired: true,
              message: "Adaptive study is a PRO feature. Upgrade to access it!",
            });
          }
          break;

        case "exam":
          if (!limits.hasExamMode) {
            return res.status(403).json({
              error: "Feature not available",
              upgradeRequired: true,
              message: "Exam mode is a PRO feature. Upgrade to access it!",
            });
          }
          break;

        case "export":
          if (!limits.hasExport) {
            return res.status(403).json({
              error: "Feature not available",
              upgradeRequired: true,
              message: "Export is a PRO feature. Upgrade to access it!",
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

// Delegates to billing.ts's atomic upsert (keyed on the Usage table's
// @@unique([userId, monthKey])) instead of a findFirst-then-create/update
// check-then-act pattern. The old pattern raced when two increments for
// the same user/month landed close together (e.g. two lectures finishing
// transcription back-to-back): both requests could see no existing row,
// both would try to create one, and the second create failed on the
// unique constraint — silently dropping that increment.
export const incrementUsage = async (
  userId: string,
  type: "recording" | "transcription",
  amount: number = 1,
) => {
  try {
    if (userId === ANONYMOUS_USER_ID) return;
    await incrementUsageAtomic(userId, type, amount);
  } catch (error) {
    console.error("Increment usage error:", error);
  }
};
