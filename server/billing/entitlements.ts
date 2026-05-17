/**
 * Entitlements & Plan Limits
 *
 * Defines what each plan tier unlocks and usage limits.
 */

export type PlanType = "FREE" | "BASE" | "PLUS" | "PRO";

export interface PlanLimits {
  maxRecordingsLifetime: number;
  maxTranscriptionMinutesPerMonth: number;
  hasFlashcards: boolean;
  hasNotes: boolean;
  hasMindMap: boolean;
  hasQuizzes: boolean;
  hasAdaptiveReview: boolean;
  hasExamMode: boolean;
  hasExport: boolean;
}

export interface EntitlementInfo {
  plan: PlanType;
  limits: PlanLimits;
  expiresAt: Date | null;
  source: "free" | "iap" | "stripe";
}

export interface UsageInfo {
  recordingsCount: number;
  transcriptionMinutesUsed: number;
  storageBytesUsed: number;
  monthKey: string;
}

export interface PaywallError {
  type: "PAYWALL_REQUIRED";
  planRequired: PlanType;
  upgradeOptions: string[];
  currentUsage: UsageInfo;
  limit: number;
  feature: string;
  message: string;
}

export const PLAN_LIMITS: Record<PlanType, PlanLimits> = {
  FREE: {
    maxRecordingsLifetime: 2,
    maxTranscriptionMinutesPerMonth: 30,
    hasFlashcards: false,
    hasNotes: true,
    hasMindMap: false,
    hasQuizzes: false,
    hasAdaptiveReview: false,
    hasExamMode: false,
    hasExport: false,
  },
  BASE: {
    maxRecordingsLifetime: -1,
    maxTranscriptionMinutesPerMonth: 60,
    hasFlashcards: true,
    hasNotes: true,
    hasMindMap: true,
    hasQuizzes: false,
    hasAdaptiveReview: false,
    hasExamMode: false,
    hasExport: false,
  },
  PLUS: {
    maxRecordingsLifetime: -1,
    maxTranscriptionMinutesPerMonth: 120,
    hasFlashcards: true,
    hasNotes: true,
    hasMindMap: true,
    hasQuizzes: true,
    hasAdaptiveReview: false,
    hasExamMode: false,
    hasExport: false,
  },
  PRO: {
    maxRecordingsLifetime: -1,
    maxTranscriptionMinutesPerMonth: 300,
    hasFlashcards: true,
    hasNotes: true,
    hasMindMap: true,
    hasQuizzes: true,
    hasAdaptiveReview: true,
    hasExamMode: true,
    hasExport: true,
  },
};

export const PRODUCTS = [
  {
    id: "com.studymind.base.lifetime",
    name: "StudyMind Base",
    description: "Lifetime unlock - Mind maps, flashcards, and notes",
    plan: "BASE" as PlanType,
    type: "non-consumable" as const,
    price: "$9.99",
    features: [
      "Mind map visualization",
      "Flashcard generation",
      "AI-generated notes",
      "60 min transcription/month",
    ],
  },
  {
    id: "com.studymind.pro.monthly",
    name: "StudyMind Pro Monthly",
    description: "Full access - Quizzes, exam mode, and more",
    plan: "PRO" as PlanType,
    type: "subscription" as const,
    period: "monthly",
    price: "$4.99/month",
    features: [
      "Everything in Base",
      "Quiz generation",
      "Adaptive study engine",
      "Exam mode",
      "300 min transcription/month",
      "PDF export",
    ],
  },
  {
    id: "com.studymind.pro.yearly",
    name: "StudyMind Pro Yearly",
    description: "Full access - Best value at 2 months free",
    plan: "PRO" as PlanType,
    type: "subscription" as const,
    period: "yearly",
    price: "$49.99/year",
    features: [
      "Everything in Base",
      "Quiz generation",
      "Adaptive study engine",
      "Exam mode",
      "300 min transcription/month",
      "PDF export",
      "2 months free vs monthly",
    ],
  },
];

export function getPlanLimits(plan: PlanType): PlanLimits {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.FREE;
}

export function getProductPlan(productId: string): PlanType | null {
  const product = PRODUCTS.find((p) => p.id === productId);
  return product?.plan || null;
}

export function getCurrentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function isFeatureAvailable(
  plan: PlanType,
  feature: keyof PlanLimits,
): boolean {
  const limits = getPlanLimits(plan);
  const value = limits[feature];
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return false;
}

export function checkRecordingLimit(
  plan: PlanType,
  totalRecordingsCount: number,
): { allowed: boolean; error?: PaywallError } {
  const limits = getPlanLimits(plan);

  if (limits.maxRecordingsLifetime === -1) {
    return { allowed: true };
  }

  if (totalRecordingsCount >= limits.maxRecordingsLifetime) {
    return {
      allowed: false,
      error: {
        type: "PAYWALL_REQUIRED",
        planRequired: "BASE",
        upgradeOptions: [
          "com.studymind.base.lifetime",
          "com.studymind.pro.monthly",
        ],
        currentUsage: {
          recordingsCount: totalRecordingsCount,
          transcriptionMinutesUsed: 0,
          storageBytesUsed: 0,
          monthKey: getCurrentMonthKey(),
        },
        limit: limits.maxRecordingsLifetime,
        feature: "recordings",
        message: `You've reached the limit of ${limits.maxRecordingsLifetime} recordings. Upgrade to continue recording.`,
      },
    };
  }

  return { allowed: true };
}

export function checkTranscriptionLimit(
  plan: PlanType,
  minutesUsedThisMonth: number,
  additionalMinutes: number,
): { allowed: boolean; error?: PaywallError } {
  const limits = getPlanLimits(plan);

  if (limits.maxTranscriptionMinutesPerMonth === -1) {
    return { allowed: true };
  }

  const totalMinutes = minutesUsedThisMonth + additionalMinutes;

  if (totalMinutes > limits.maxTranscriptionMinutesPerMonth) {
    return {
      allowed: false,
      error: {
        type: "PAYWALL_REQUIRED",
        planRequired: plan === "FREE" ? "BASE" : "PRO",
        upgradeOptions:
          plan === "FREE"
            ? ["com.studymind.base.lifetime", "com.studymind.pro.monthly"]
            : ["com.studymind.pro.monthly"],
        currentUsage: {
          recordingsCount: 0,
          transcriptionMinutesUsed: minutesUsedThisMonth,
          storageBytesUsed: 0,
          monthKey: getCurrentMonthKey(),
        },
        limit: limits.maxTranscriptionMinutesPerMonth,
        feature: "transcription",
        message: `You've used ${minutesUsedThisMonth.toFixed(1)} of ${limits.maxTranscriptionMinutesPerMonth} transcription minutes this month. Upgrade for more.`,
      },
    };
  }

  return { allowed: true };
}
