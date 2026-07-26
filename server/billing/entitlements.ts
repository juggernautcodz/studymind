/**
 * Entitlements & Plan Limits
 *
 * Defines what each plan tier unlocks and usage limits.
 */

export type PlanType = "FREE" | "PLUS" | "PRO";

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
    maxRecordingsLifetime: 3,
    maxTranscriptionMinutesPerMonth: 45,
    hasFlashcards: true,
    hasNotes: true,
    hasMindMap: false,
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
    id: "com.studymind.plus.monthly",
    name: "StudyMind Plus Monthly",
    description: "Unlimited recordings, quizzes, and 120 min/mo transcription",
    plan: "PLUS" as PlanType,
    type: "subscription" as const,
    period: "monthly",
    price: "$3.99/month",
    features: [
      "Unlimited recordings",
      "120 min transcription/month",
      "AI-generated notes",
      "Flashcard generation",
      "Quiz generation",
    ],
  },
  {
    id: "com.studymind.plus.yearly",
    name: "StudyMind Plus Yearly",
    description: "Best value Plus plan - save 37%",
    plan: "PLUS" as PlanType,
    type: "subscription" as const,
    period: "yearly",
    price: "$29.99/year",
    features: [
      "Everything in Plus Monthly",
      "Save 37% vs monthly",
      "Unlimited recordings",
      "120 min transcription/month",
    ],
  },
  {
    id: "com.studymind.pro.monthly",
    name: "StudyMind Pro Monthly",
    description: "Full access - Exam mode, adaptive study engine, and 300 min/mo",
    plan: "PRO" as PlanType,
    type: "subscription" as const,
    period: "monthly",
    price: "$7.99/month",
    features: [
      "Everything in Plus",
      "Exam mode & grade analytics",
      "Adaptive study engine",
      "300 min transcription/month",
      "PDF export & priority support",
    ],
  },
  {
    id: "com.studymind.pro.yearly",
    name: "StudyMind Pro Yearly",
    description: "Best overall value - 2 months free",
    plan: "PRO" as PlanType,
    type: "subscription" as const,
    period: "yearly",
    price: "$59.99/year",
    features: [
      "Everything in Pro Monthly",
      "2 months free vs monthly",
      "Exam mode & grade analytics",
      "Adaptive study engine",
      "300 min transcription/month",
      "PDF export & priority support",
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
        planRequired: "PLUS",
        upgradeOptions: [
          "com.studymind.plus.monthly",
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
        message: `You've reached the limit of ${limits.maxRecordingsLifetime} free recordings. Upgrade to Plus or Pro to continue.`,
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
        planRequired: plan === "FREE" ? "PLUS" : "PRO",
        upgradeOptions:
          plan === "FREE"
            ? ["com.studymind.plus.monthly", "com.studymind.pro.monthly"]
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
