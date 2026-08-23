/**
 * iOS Receipt Validator
 *
 * This module provides receipt validation for iOS In-App Purchases.
 * Currently implements a stub for local development that accepts TEST_RECEIPT.
 *
 * TO IMPLEMENT FOR PRODUCTION:
 * 1. Use Apple's App Store Server API (recommended) or verifyReceipt endpoint
 * 2. For App Store Server API:
 *    - Generate API key in App Store Connect
 *    - Use @apple/app-store-server-library npm package
 *    - Call getTransactionHistory() or verifyAndDecodeTransaction()
 * 3. For legacy verifyReceipt (deprecated but still works):
 *    - POST to https://buy.itunes.apple.com/verifyReceipt (production)
 *    - POST to https://sandbox.itunes.apple.com/verifyReceipt (sandbox)
 *    - Include 'receipt-data' (base64) and 'password' (shared secret)
 *
 * IMPORTANT: Always validate on your server, never trust client-side validation
 */

export interface IosReceiptValidationResult {
  valid: boolean;
  productId: string | null;
  expiresAt: Date | null;
  status: "active" | "expired" | "canceled" | "grace_period" | "invalid";
  originalTransactionId: string | null;
  isSubscription: boolean;
  error?: string;
}

const TEST_PRODUCTS = {
  // Legacy product, retired when the lifetime plan was removed — kept so
  // existing holders can still restore/verify their past purchase.
  "com.studymind.base.lifetime": {
    isSubscription: false,
    plan: "BASE",
  },
  "com.studymind.plus.monthly": {
    isSubscription: true,
    plan: "PLUS",
    durationDays: 30,
  },
  "com.studymind.plus.yearly": {
    isSubscription: true,
    plan: "PLUS",
    durationDays: 365,
  },
  "com.studymind.pro.monthly": {
    isSubscription: true,
    plan: "PRO",
    durationDays: 30,
  },
  "com.studymind.pro.yearly": {
    isSubscription: true,
    plan: "PRO",
    durationDays: 365,
  },
};

export async function verifyIosReceipt(
  receiptData: string,
  productId?: string,
): Promise<IosReceiptValidationResult> {
  const allowTestReceipts = process.env.NODE_ENV !== "production";
  if (
    allowTestReceipts &&
    (receiptData === "TEST_RECEIPT" || receiptData.startsWith("TEST_RECEIPT_"))
  ) {
    const testProductId = productId || "com.studymind.pro.monthly";
    const productConfig =
      TEST_PRODUCTS[testProductId as keyof typeof TEST_PRODUCTS];

    if (!productConfig) {
      return {
        valid: false,
        productId: null,
        expiresAt: null,
        status: "invalid",
        originalTransactionId: null,
        isSubscription: false,
        error: "Unknown product ID",
      };
    }

    const expiresAt = productConfig.isSubscription
      ? new Date(
          Date.now() +
            ("durationDays" in productConfig
              ? productConfig.durationDays
              : 30) *
              24 *
              60 *
              60 *
              1000,
        )
      : null;

    return {
      valid: true,
      productId: testProductId,
      expiresAt,
      status: "active",
      originalTransactionId: `TEST_TXN_${Date.now()}`,
      isSubscription: productConfig.isSubscription,
    };
  }

  /**
   * PRODUCTION IMPLEMENTATION:
   *
   * import { AppStoreServerAPIClient, Environment } from '@apple/app-store-server-library';
   *
   * const client = new AppStoreServerAPIClient(
   *   signingKey,     // Private key from App Store Connect
   *   keyId,          // Key ID from App Store Connect
   *   issuerId,       // Issuer ID from App Store Connect
   *   bundleId,       // Your app's bundle ID
   *   Environment.Production // or Environment.Sandbox
   * );
   *
   * try {
   *   const transactionInfo = await client.getTransactionInfo(transactionId);
   *   // Parse and validate transactionInfo
   *   // Check expiresDate, productId, etc.
   *   return { valid: true, ... };
   * } catch (error) {
   *   return { valid: false, error: error.message, ... };
   * }
   */

  console.warn(
    "[iOS Validator] Production validation not implemented. Rejecting receipt.",
  );
  return {
    valid: false,
    productId: null,
    expiresAt: null,
    status: "invalid",
    originalTransactionId: null,
    isSubscription: false,
    error: "Production validation not configured",
  };
}

export function getIosProductIds(): string[] {
  return Object.keys(TEST_PRODUCTS);
}

export function getIosProductPlan(productId: string): string | null {
  const product = TEST_PRODUCTS[productId as keyof typeof TEST_PRODUCTS];
  return product?.plan || null;
}
