import { Router, Request, Response } from "express";
import prisma from "./db";
import { guestOrAuthMiddleware, AuthRequest } from "./auth";
import {
  verifyIosReceipt,
  getIosProductPlan,
} from "./billing/iosReceiptValidator";
import {
  verifyAndroidPurchase,
  getAndroidProductPlan,
} from "./billing/androidPurchaseValidator";
import {
  PRODUCTS,
  PLAN_LIMITS,
  getPlanLimits,
  getCurrentMonthKey,
  getProductPlan,
  PlanType,
} from "./billing/entitlements";

const router = Router();

export { PLAN_LIMITS };

router.get("/products", async (_req: Request, res: Response) => {
  try {
    res.json({
      products: PRODUCTS.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        plan: p.plan,
        type: p.type,
        period: "period" in p ? p.period : undefined,
        price: p.price,
        features: p.features,
      })),
    });
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

router.get("/plans", async (_req: Request, res: Response) => {
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
            "AI notes & flashcards",
          ],
          limits: PLAN_LIMITS.FREE,
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
            "Full web + mobile access",
          ],
          limits: PLAN_LIMITS.PLUS,
          productId: "com.studymind.plus.monthly",
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
            "PDF export & priority AI speed",
          ],
          limits: PLAN_LIMITS.PRO,
          productId: "com.studymind.pro.monthly",
        },
      ],
    });
  } catch (error) {
    console.error("Get plans error:", error);
    res.status(500).json({ error: "Failed to get plans" });
  }
});

router.post(
  "/verify",
  guestOrAuthMiddleware,
  async (req: AuthRequest, res: Response) => {
    const IS_DEV = process.env.NODE_ENV !== "production";
    try {
      const userId = req.user!.id;
      const { platform, productId, purchaseToken, transactionId, receiptData } =
        req.body;

      if (!platform || !productId) {
        res
          .status(400)
          .json({ error: "Missing required fields: platform, productId" });
        return;
      }

      if (platform !== "ios" && platform !== "android") {
        res
          .status(400)
          .json({ error: 'Invalid platform. Must be "ios" or "android"' });
        return;
      }

      const isDevTestToken =
        IS_DEV &&
        (purchaseToken === "TEST_TOKEN" ||
          transactionId === "TEST_RECEIPT" ||
          receiptData === "TEST_RECEIPT");

      let validationResult: {
        valid: boolean;
        status: string;
        expiresAt: Date | null;
        error?: string;
      };
      let plan: PlanType | null;
      let tokenOrTxnId: string;

      if (isDevTestToken) {
        tokenOrTxnId =
          purchaseToken || transactionId || receiptData || "TEST_TOKEN";
        plan = getProductPlan(productId);
        validationResult = {
          valid: true,
          status: "active",
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        };
      } else if (platform === "ios") {
        if (!receiptData && !transactionId) {
          res
            .status(400)
            .json({ error: "iOS requires receiptData or transactionId" });
          return;
        }
        tokenOrTxnId = transactionId || receiptData;
        validationResult = await verifyIosReceipt(
          receiptData || "TEST_RECEIPT",
          productId,
        );
        plan = getIosProductPlan(productId) as PlanType | null;
      } else {
        if (!purchaseToken) {
          res.status(400).json({ error: "Android requires purchaseToken" });
          return;
        }
        tokenOrTxnId = purchaseToken;
        validationResult = await verifyAndroidPurchase(
          purchaseToken,
          productId,
        );
        plan = getAndroidProductPlan(productId) as PlanType | null;
      }

      if (!validationResult.valid) {
        if (validationResult.error === "Billing not configured") {
          res.status(400).json({
            error: "Billing not configured",
            code: "BILLING_NOT_CONFIGURED",
          });
          return;
        }
        res.status(400).json({
          error: "Receipt validation failed",
          details: validationResult.error,
        });
        return;
      }

      if (!plan) {
        res.status(400).json({ error: "Unknown product ID" });
        return;
      }

      await prisma.user.upsert({
        where: { id: userId },
        create: {
          id: userId,
          email: `${userId}@device.local`,
          passwordHash: "",
        },
        update: {},
      });

      await prisma.purchase.upsert({
        where: { purchaseTokenOrTransactionId: tokenOrTxnId },
        create: {
          userId,
          platform,
          productId,
          purchaseTokenOrTransactionId: tokenOrTxnId,
          rawReceiptJson: JSON.stringify(req.body),
          verifiedAt: new Date(),
        },
        update: {
          verifiedAt: new Date(),
        },
      });

      await prisma.subscriptionStatus.upsert({
        where: { userId },
        create: {
          userId,
          platform,
          status: validationResult.status,
          productId,
          currentPeriodEnd: validationResult.expiresAt,
        },
        update: {
          platform,
          status: validationResult.status,
          productId,
          currentPeriodEnd: validationResult.expiresAt,
        },
      });

      await prisma.entitlement.upsert({
        where: { userId },
        create: {
          userId,
          plan,
          expiresAt: validationResult.expiresAt,
          source: "iap",
        },
        update: {
          plan,
          expiresAt: validationResult.expiresAt,
          source: "iap",
        },
      });

      const entitlement = await getEntitlementInfo(userId);
      const usage = await getUsageInfo(userId);

      res.json({
        success: true,
        entitlement,
        usage,
        limits: getPlanLimits(entitlement.plan),
      });
    } catch (error: any) {
      const errorCode = classifyBillingError(error);
      console.error(`[billing/verify] ${errorCode}:`, sanitizeError(error));
      if (errorCode === "DB_CONNECT_FAILED") {
        res.status(503).json({
          error: "Billing temporarily unavailable",
          code: "BILLING_UNAVAILABLE",
        });
      } else {
        res
          .status(500)
          .json({ error: "Failed to verify purchase", code: errorCode });
      }
    }
  },
);

router.get(
  "/entitlements",
  guestOrAuthMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const entitlement = await getEntitlementInfo(userId);
      const usage = await getUsageInfo(userId);
      const limits = getPlanLimits(entitlement.plan);

      res.json({
        entitlement,
        usage,
        limits,
      });
    } catch (error: any) {
      const errorCode = classifyBillingError(error);
      console.error(
        `[billing/entitlements] ${errorCode}:`,
        sanitizeError(error),
      );
      if (errorCode === "DB_CONNECT_FAILED") {
        res.status(503).json({
          error: "Billing temporarily unavailable",
          code: "BILLING_UNAVAILABLE",
        });
      } else {
        res
          .status(500)
          .json({ error: "Failed to fetch entitlements", code: errorCode });
      }
    }
  },
);

router.get(
  "/usage",
  guestOrAuthMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const entitlement = await getEntitlementInfo(userId);
      const usage = await getUsageInfo(userId);
      const limits = getPlanLimits(entitlement.plan);

      res.json({
        usage: {
          recordingsCount: usage.recordingsCount,
          transcriptionMinutesUsed: usage.transcriptionMinutesUsed,
          storageBytesUsed: usage.storageBytesUsed,
          monthKey: usage.monthKey,
        },
        limits: {
          maxRecordingsLifetime: limits.maxRecordingsLifetime,
          maxTranscriptionMinutesPerMonth:
            limits.maxTranscriptionMinutesPerMonth,
        },
        plan: entitlement.plan,
      });
    } catch (error) {
      console.error("Get usage error:", error);
      res.status(500).json({ error: "Failed to get usage" });
    }
  },
);

async function getEntitlementInfo(userId: string) {
  const entitlement = await prisma.entitlement.findUnique({
    where: { userId },
  });

  if (!entitlement) {
    return {
      plan: "FREE" as PlanType,
      limits: getPlanLimits("FREE"),
      expiresAt: null,
      source: "free",
    };
  }

  if (entitlement.expiresAt && new Date(entitlement.expiresAt) < new Date()) {
    return {
      plan: "FREE" as PlanType,
      limits: getPlanLimits("FREE"),
      expiresAt: null,
      source: "free",
    };
  }

  const plan = entitlement.plan as PlanType;
  return {
    plan,
    limits: getPlanLimits(plan),
    expiresAt: entitlement.expiresAt,
    source: entitlement.source,
  };
}

async function getUsageInfo(userId: string) {
  const monthKey = getCurrentMonthKey();

  let usage = await prisma.usage.findUnique({
    where: { userId_monthKey: { userId, monthKey } },
  });

  if (!usage) {
    usage = await prisma.usage.create({
      data: {
        userId,
        monthKey,
        recordingsCount: 0,
        transcriptionMinutesUsed: 0,
        storageBytesUsed: 0,
      },
    });
  }

  const totalRecordings = await prisma.recording.count({
    where: { userId },
  });

  return {
    recordingsCount: totalRecordings,
    transcriptionMinutesUsed: usage.transcriptionMinutesUsed,
    storageBytesUsed: usage.storageBytesUsed,
    monthKey,
  };
}

export async function getUserPlan(userId: string): Promise<PlanType> {
  const entitlement = await getEntitlementInfo(userId);
  return entitlement.plan;
}

export async function incrementUsage(
  userId: string,
  type: "recording" | "transcription" | "storage",
  amount: number,
): Promise<void> {
  const monthKey = getCurrentMonthKey();

  if (type === "recording") {
    await prisma.usage.upsert({
      where: { userId_monthKey: { userId, monthKey } },
      create: {
        userId,
        monthKey,
        recordingsCount: amount,
        transcriptionMinutesUsed: 0,
        storageBytesUsed: 0,
      },
      update: {
        recordingsCount: { increment: amount },
      },
    });
  } else if (type === "transcription") {
    await prisma.usage.upsert({
      where: { userId_monthKey: { userId, monthKey } },
      create: {
        userId,
        monthKey,
        recordingsCount: 0,
        transcriptionMinutesUsed: amount,
        storageBytesUsed: 0,
      },
      update: {
        transcriptionMinutesUsed: { increment: amount },
      },
    });
  } else {
    await prisma.usage.upsert({
      where: { userId_monthKey: { userId, monthKey } },
      create: {
        userId,
        monthKey,
        recordingsCount: 0,
        transcriptionMinutesUsed: 0,
        storageBytesUsed: amount,
      },
      update: {
        storageBytesUsed: { increment: amount },
      },
    });
  }
}

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || "studymind-stripe-webhook-secret-2026-default";

router.post("/stripe-webhook", async (req: Request, res: Response) => {
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
    const { email, plan, expiresAt, subscriptionId, priceId, status } = req.body as {
      email: string;
      plan: "FREE" | "PLUS" | "PRO";
      expiresAt: string | null;
      subscriptionId: string;
      priceId: string;
      status: string;
    };

    if (!email || !plan || !subscriptionId) {
      res.status(400).json({ error: "Missing required fields: email, plan, subscriptionId" });
      return;
    }

    const lowerEmail = email.toLowerCase();

    // 1. Find or create the user (supports web-checkout before mobile-signup)
    let user = await prisma.user.findUnique({
      where: { email: lowerEmail },
    });

    if (!user) {
      console.log(`[Stripe Sync] Creating placeholder account for new user: ${lowerEmail}`);
      user = await prisma.user.create({
        data: {
          email: lowerEmail,
          passwordHash: "", // Placeholder - will complete registration via signup endpoint
        },
      });
    }

    const parsedExpiresAt = expiresAt ? new Date(expiresAt) : null;

    // 2. Update entitlement
    await prisma.entitlement.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        plan,
        expiresAt: parsedExpiresAt,
        source: "stripe",
      },
      update: {
        plan,
        expiresAt: parsedExpiresAt,
        source: "stripe",
      },
    });

    // 3. Update subscription status
    await prisma.subscriptionStatus.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        platform: "stripe",
        status,
        productId: priceId,
        currentPeriodEnd: parsedExpiresAt,
      },
      update: {
        platform: "stripe",
        status,
        productId: priceId,
        currentPeriodEnd: parsedExpiresAt,
      },
    });

    // 4. Record purchase transaction
    await prisma.purchase.upsert({
      where: { purchaseTokenOrTransactionId: subscriptionId },
      create: {
        userId: user.id,
        platform: "stripe",
        productId: priceId,
        purchaseTokenOrTransactionId: subscriptionId,
        rawReceiptJson: JSON.stringify({ email, plan, status, priceId }),
        verifiedAt: new Date(),
      },
      update: {
        verifiedAt: new Date(),
      },
    });

    console.log(`[Stripe Sync] Successfully updated plan to ${plan} for ${lowerEmail} (Status: ${status})`);

    res.json({
      success: true,
      userId: user.id,
      plan,
      status,
    });
  } catch (error) {
    console.error("[Stripe Sync] Error updating subscription:", error);
    res.status(500).json({ error: "Failed to update subscription in backend database" });
  }
});

function classifyBillingError(error: any): string {
  const msg = (error?.message || "").toLowerCase();
  const code = error?.code || "";

  if (
    msg.includes("can't reach database") ||
    msg.includes("connection refused") ||
    msg.includes("econnrefused") ||
    (msg.includes("database") && msg.includes("does not exist")) ||
    code === "P1001" ||
    code === "P1002" ||
    code === "P1003"
  ) {
    return "DB_CONNECT_FAILED";
  }

  if (msg.includes("unique constraint") || code === "P2002") {
    return "DB_CONSTRAINT_VIOLATION";
  }

  if (msg.includes("timeout") || code === "P1008") {
    return "DB_TIMEOUT";
  }

  if (
    msg.includes("receipt") ||
    msg.includes("validation") ||
    msg.includes("verify")
  ) {
    return "VALIDATOR_FAILED";
  }

  return "INTERNAL_ERROR";
}

function sanitizeError(error: any): string {
  const msg = error?.message || String(error);
  return msg
    .replace(/postgres:\/\/[^\s]+/gi, "postgres://***")
    .replace(/Bearer\s+\S+/gi, "Bearer ***")
    .replace(/token[=:]\s*\S+/gi, "token=***");
}

export default router;
