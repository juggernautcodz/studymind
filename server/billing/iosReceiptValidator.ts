/**
 * iOS Receipt Validator
 *
 * Verifies iOS In-App Purchase transactions server-side using Apple's App
 * Store Server API (@apple/app-store-server-library), not the deprecated
 * verifyReceipt endpoint.
 *
 * IMPORTANT: Always validate on your server, never trust client-side validation
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import {
  AppStoreServerAPIClient,
  APIException,
  APIError,
  Environment,
  SignedDataVerifier,
} from "@apple/app-store-server-library";

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
  // existing holders can still restore/verify their past purchase. Mapped to
  // PLUS (not the old, no-longer-real "BASE" plan) since PLUS is the closest
  // current equivalent to what BASE lifetime actually unlocked (mind map,
  // flashcards, notes) — mapping to PRO would over-grant exam mode/adaptive
  // review/export that these purchasers never paid for. "BASE" is not a
  // valid PlanType and would silently downgrade holders to FREE.
  "com.studymind.base.lifetime": {
    isSubscription: false,
    plan: "PLUS",
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

const BUNDLE_ID = "com.shanethetester.studymind";
const APPLE_ROOT_CA_PATH = resolve(
  process.cwd(),
  "server",
  "billing",
  "certs",
  "AppleRootCA-G3.cer",
);

function isSubscriptionProduct(productId: string): boolean {
  const config = TEST_PRODUCTS[productId as keyof typeof TEST_PRODUCTS];
  if (config) return config.isSubscription;
  return productId.includes(".monthly") || productId.includes(".yearly");
}

function invalidResult(error: string): IosReceiptValidationResult {
  return {
    valid: false,
    productId: null,
    expiresAt: null,
    status: "invalid",
    originalTransactionId: null,
    isSubscription: false,
    error,
  };
}

let cachedRootCA: Buffer | null = null;
function getRootCA(): Buffer {
  if (!cachedRootCA) {
    cachedRootCA = readFileSync(APPLE_ROOT_CA_PATH);
  }
  return cachedRootCA;
}

function getSigningKey(): string {
  return process.env.APPLE_IAP_SIGNING_KEY || "";
}

function getKeyId(): string {
  return process.env.APPLE_IAP_KEY_ID || "";
}

function getIssuerId(): string {
  return process.env.APPLE_IAP_ISSUER_ID || "";
}

function getAppleAppId(): number | undefined {
  const raw = process.env.APPLE_APP_ID;
  return raw ? Number(raw) : undefined;
}

function makeClient(environment: Environment): AppStoreServerAPIClient {
  return new AppStoreServerAPIClient(
    getSigningKey(),
    getKeyId(),
    getIssuerId(),
    BUNDLE_ID,
    environment,
  );
}

function makeVerifier(environment: Environment): SignedDataVerifier {
  return new SignedDataVerifier(
    [getRootCA()],
    true, // enableOnlineChecks
    environment,
    BUNDLE_ID,
    // Required by the library for Production (throws otherwise); Sandbox
    // verification doesn't check it, so omitting there is fine.
    environment === Environment.PRODUCTION ? getAppleAppId() : undefined,
  );
}

/**
 * Fetches signed transaction info from Apple, trying Production first and
 * falling back to Sandbox — a TestFlight/sandbox purchase verified against
 * our (production) server returns ORIGINAL_TRANSACTION_ID_NOT_FOUND when
 * queried against Production, per Apple's documented pattern for handling
 * this ambiguity server-side.
 */
async function fetchSignedTransaction(transactionId: string): Promise<{
  signedTransactionInfo: string;
  environment: Environment;
}> {
  try {
    const prodClient = makeClient(Environment.PRODUCTION);
    const response = await prodClient.getTransactionInfo(transactionId);
    if (!response.signedTransactionInfo) {
      throw new Error("Empty signedTransactionInfo from Production");
    }
    return {
      signedTransactionInfo: response.signedTransactionInfo,
      environment: Environment.PRODUCTION,
    };
  } catch (err) {
    const isNotFound =
      err instanceof APIException &&
      (err.apiError === APIError.ORIGINAL_TRANSACTION_ID_NOT_FOUND ||
        err.httpStatusCode === 404);
    if (!isNotFound) throw err;

    const sandboxClient = makeClient(Environment.SANDBOX);
    const response = await sandboxClient.getTransactionInfo(transactionId);
    if (!response.signedTransactionInfo) {
      throw new Error("Empty signedTransactionInfo from Sandbox");
    }
    return {
      signedTransactionInfo: response.signedTransactionInfo,
      environment: Environment.SANDBOX,
    };
  }
}

export async function verifyIosReceipt(
  transactionId: string,
  productId?: string,
): Promise<IosReceiptValidationResult> {
  const allowTestReceipts = process.env.NODE_ENV !== "production";
  if (
    allowTestReceipts &&
    (transactionId === "TEST_RECEIPT" ||
      transactionId.startsWith("TEST_RECEIPT_"))
  ) {
    const testProductId = productId || "com.studymind.pro.monthly";
    const productConfig =
      TEST_PRODUCTS[testProductId as keyof typeof TEST_PRODUCTS];

    if (!productConfig) {
      return invalidResult("Unknown product ID");
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

  if (
    !getSigningKey() ||
    !getKeyId() ||
    !getIssuerId() ||
    getAppleAppId() === undefined
  ) {
    console.error(
      "[iOS Validator] Missing env: APPLE_IAP_SIGNING_KEY, APPLE_IAP_KEY_ID, APPLE_IAP_ISSUER_ID, or APPLE_APP_ID",
    );
    return invalidResult("Billing not configured");
  }

  try {
    const { signedTransactionInfo, environment } = await fetchSignedTransaction(
      transactionId,
    );

    const verifier = makeVerifier(environment);
    const decoded = await verifier.verifyAndDecodeTransaction(
      signedTransactionInfo,
    );

    const resolvedProductId = decoded.productId || productId || null;
    const isSubscription = resolvedProductId
      ? isSubscriptionProduct(resolvedProductId)
      : false;
    const expiresAt = decoded.expiresDate ? new Date(decoded.expiresDate) : null;

    let status: IosReceiptValidationResult["status"];
    let valid: boolean;

    if (decoded.revocationDate) {
      status = "canceled";
      valid = false;
    } else if (isSubscription && expiresAt) {
      valid = expiresAt.getTime() > Date.now();
      status = valid ? "active" : "expired";
    } else {
      // Non-subscription (e.g. legacy lifetime purchase) — presence of a
      // decoded, unrevoked transaction is sufficient.
      valid = true;
      status = "active";
    }

    return {
      valid,
      productId: resolvedProductId,
      expiresAt,
      status,
      originalTransactionId: decoded.originalTransactionId || null,
      isSubscription,
    };
  } catch (err: any) {
    if (err instanceof APIException) {
      console.error(
        `[iOS Validator] App Store Server API error (${err.httpStatusCode}, ${err.apiError}):`,
        err.errorMessage,
      );
      return invalidResult("Apple verification failed");
    }
    console.error("[iOS Validator] Verification error:", err?.message || err);
    return invalidResult("Apple verification failed");
  }
}

export function getIosProductIds(): string[] {
  return Object.keys(TEST_PRODUCTS);
}

export function getIosProductPlan(productId: string): string | null {
  const product = TEST_PRODUCTS[productId as keyof typeof TEST_PRODUCTS];
  return product?.plan || null;
}
