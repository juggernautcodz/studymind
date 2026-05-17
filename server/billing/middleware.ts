import { Request, Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import {
  getPlanLimits,
  getCurrentMonthKey,
  PlanType,
  PaywallError,
} from "./entitlements";

const prisma = new PrismaClient();

interface AuthenticatedRequest extends Request {
  userId?: string;
  userPlan?: PlanType;
}

type Feature =
  | "flashcards"
  | "notes"
  | "mindmap"
  | "quizzes"
  | "adaptive_review"
  | "exam_mode"
  | "export"
  | "recording"
  | "transcription";

const FEATURE_TO_LIMIT_KEY: Record<
  Feature,
  keyof ReturnType<typeof getPlanLimits>
> = {
  flashcards: "hasFlashcards",
  notes: "hasNotes",
  mindmap: "hasMindMap",
  quizzes: "hasQuizzes",
  adaptive_review: "hasAdaptiveReview",
  exam_mode: "hasExamMode",
  export: "hasExport",
  recording: "maxRecordingsLifetime",
  transcription: "maxTranscriptionMinutesPerMonth",
};

const FEATURE_TO_REQUIRED_PLAN: Record<Feature, PlanType> = {
  flashcards: "BASE",
  notes: "FREE",
  mindmap: "BASE",
  quizzes: "PRO",
  adaptive_review: "PRO",
  exam_mode: "PRO",
  export: "PRO",
  recording: "FREE",
  transcription: "FREE",
};

async function getUserEntitlement(
  userId: string,
): Promise<{ plan: PlanType; expiresAt: Date | null }> {
  const entitlement = await prisma.entitlement.findUnique({
    where: { userId },
  });

  if (!entitlement) {
    return { plan: "FREE", expiresAt: null };
  }

  if (entitlement.expiresAt && new Date(entitlement.expiresAt) < new Date()) {
    return { plan: "FREE", expiresAt: null };
  }

  return {
    plan: entitlement.plan as PlanType,
    expiresAt: entitlement.expiresAt,
  };
}

async function getUsage(userId: string) {
  const monthKey = getCurrentMonthKey();

  const usage = await prisma.usage.findUnique({
    where: { userId_monthKey: { userId, monthKey } },
  });

  const totalRecordings = await prisma.recording.count({
    where: { userId },
  });

  return {
    recordingsCount: totalRecordings,
    transcriptionMinutesUsed: usage?.transcriptionMinutesUsed || 0,
    storageBytesUsed: usage?.storageBytesUsed || 0,
    monthKey,
  };
}

function getUpgradeOptions(
  currentPlan: PlanType,
  requiredPlan: PlanType,
): string[] {
  if (requiredPlan === "PRO") {
    return ["com.studymind.pro.monthly", "com.studymind.pro.yearly"];
  }
  if (requiredPlan === "BASE" && currentPlan === "FREE") {
    return [
      "com.studymind.base.lifetime",
      "com.studymind.pro.monthly",
      "com.studymind.pro.yearly",
    ];
  }
  return [];
}

export function requireEntitlement(feature: Feature) {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const { plan } = await getUserEntitlement(userId);
      req.userPlan = plan;
      const limits = getPlanLimits(plan);
      const limitKey = FEATURE_TO_LIMIT_KEY[feature];
      const limitValue = limits[limitKey];

      if (typeof limitValue === "boolean" && !limitValue) {
        const requiredPlan = FEATURE_TO_REQUIRED_PLAN[feature];
        const usage = await getUsage(userId);

        const paywallError: PaywallError = {
          type: "PAYWALL_REQUIRED",
          planRequired: requiredPlan,
          upgradeOptions: getUpgradeOptions(plan, requiredPlan),
          currentUsage: usage,
          limit: 0,
          feature,
          message: `${feature.replace("_", " ")} requires ${requiredPlan} plan or higher`,
        };

        res.status(403).json(paywallError);
        return;
      }

      if (feature === "recording") {
        const usage = await getUsage(userId);
        const maxRecordings = limits.maxRecordingsLifetime;

        if (maxRecordings !== -1 && usage.recordingsCount >= maxRecordings) {
          const paywallError: PaywallError = {
            type: "PAYWALL_REQUIRED",
            planRequired: "BASE",
            upgradeOptions: getUpgradeOptions(plan, "BASE"),
            currentUsage: usage,
            limit: maxRecordings,
            feature: "recording",
            message: `You've reached the limit of ${maxRecordings} recordings. Upgrade to continue.`,
          };

          res.status(403).json(paywallError);
          return;
        }
      }

      if (feature === "transcription") {
        const usage = await getUsage(userId);
        const maxMinutes = limits.maxTranscriptionMinutesPerMonth;

        if (maxMinutes !== -1 && usage.transcriptionMinutesUsed >= maxMinutes) {
          const paywallError: PaywallError = {
            type: "PAYWALL_REQUIRED",
            planRequired: plan === "FREE" ? "BASE" : "PRO",
            upgradeOptions: getUpgradeOptions(
              plan,
              plan === "FREE" ? "BASE" : "PRO",
            ),
            currentUsage: usage,
            limit: maxMinutes,
            feature: "transcription",
            message: `You've used all ${maxMinutes} transcription minutes this month. Upgrade for more.`,
          };

          res.status(403).json(paywallError);
          return;
        }
      }

      next();
    } catch (error) {
      console.error("Error checking entitlement:", error);
      res.status(500).json({ error: "Failed to check entitlement" });
    }
  };
}

export function attachUserPlan() {
  return async (
    req: AuthenticatedRequest,
    _res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.userId;
      if (userId) {
        const { plan } = await getUserEntitlement(userId);
        req.userPlan = plan;
      }
      next();
    } catch (error) {
      next();
    }
  };
}
