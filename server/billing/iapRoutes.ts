import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { verifyIosReceipt, getIosProductPlan } from "./iosReceiptValidator";
import {
  verifyAndroidPurchase,
  getAndroidProductPlan,
} from "./androidPurchaseValidator";
import {
  PRODUCTS,
  getPlanLimits,
  getCurrentMonthKey,
  PlanType,
  EntitlementInfo,
  UsageInfo,
} from "./entitlements";
import { guestOrAuthMiddleware, AuthRequest } from "../auth";

const prisma = new PrismaClient();

export const iapRouter = Router();

type AuthenticatedRequest = AuthRequest & { userId?: string };

iapRouter.get("/products", async (_req: Request, res: Response) => {
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

iapRouter.post(
  "/verify",
  guestOrAuthMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.id || req.userId;
      if (!userId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

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

      let validationResult;
      let plan: PlanType | null;
      let tokenOrTxnId: string;

      if (platform === "ios") {
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
    } catch (error) {
      console.error("Error verifying purchase:", error);
      res.status(500).json({ error: "Failed to verify purchase" });
    }
  },
);

iapRouter.get(
  "/entitlements",
  guestOrAuthMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.id || req.userId;
      if (!userId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const entitlement = await getEntitlementInfo(userId);
      const usage = await getUsageInfo(userId);
      const limits = getPlanLimits(entitlement.plan);

      res.json({
        entitlement,
        usage,
        limits,
      });
    } catch (error) {
      console.error("Error fetching entitlements:", error);
      res.status(500).json({ error: "Failed to fetch entitlements" });
    }
  },
);

async function getEntitlementInfo(userId: string): Promise<EntitlementInfo> {
  const entitlement = await prisma.entitlement.findUnique({
    where: { userId },
  });

  if (!entitlement) {
    return {
      plan: "FREE",
      limits: getPlanLimits("FREE"),
      expiresAt: null,
      source: "free",
    };
  }

  if (entitlement.expiresAt && new Date(entitlement.expiresAt) < new Date()) {
    return {
      plan: "FREE",
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
    source: entitlement.source as "free" | "iap",
  };
}

async function getUsageInfo(userId: string): Promise<UsageInfo> {
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

  await prisma.usage.upsert({
    where: { userId_monthKey: { userId, monthKey } },
    create: {
      userId,
      monthKey,
      recordingsCount: type === "recording" ? amount : 0,
      transcriptionMinutesUsed: type === "transcription" ? amount : 0,
      storageBytesUsed: type === "storage" ? amount : 0,
    },
    update: {
      recordingsCount: type === "recording" ? { increment: amount } : undefined,
      transcriptionMinutesUsed:
        type === "transcription" ? { increment: amount } : undefined,
      storageBytesUsed: type === "storage" ? { increment: amount } : undefined,
    },
  });
}
