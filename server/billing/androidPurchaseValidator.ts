import { google } from "googleapis";

export interface AndroidPurchaseValidationResult {
  valid: boolean;
  productId: string | null;
  expiresAt: Date | null;
  status:
    | "active"
    | "expired"
    | "canceled"
    | "grace_period"
    | "pending"
    | "invalid";
  orderId: string | null;
  isSubscription: boolean;
  error?: string;
}

const PRODUCT_CONFIG: Record<
  string,
  { isSubscription: boolean; plan: string; durationDays?: number }
> = {
  // Legacy product, retired when the lifetime plan was removed — kept so
  // existing holders can still restore/verify their past purchase.
  "com.studymind.base.lifetime": { isSubscription: false, plan: "BASE" },
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

function isSubscriptionProduct(productId: string): boolean {
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
      scopes: ["https://www.googleapis.com/auth/androidpublisher"],
    });
  } catch (e: any) {
    console.error(
      "[Android Validator] Failed to parse GOOGLE_PLAY_SERVICE_ACCOUNT_JSON:",
      e.message,
    );
    return null;
  }
}

function invalidResult(error: string): AndroidPurchaseValidationResult {
  return {
    valid: false,
    productId: null,
    expiresAt: null,
    status: "invalid",
    orderId: null,
    isSubscription: false,
    error,
  };
}

export async function verifyAndroidPurchase(
  purchaseToken: string,
  productId: string,
): Promise<AndroidPurchaseValidationResult> {
  const allowTestTokens = process.env.NODE_ENV !== "production";
  if (
    allowTestTokens &&
    (purchaseToken === "TEST_TOKEN" || purchaseToken.startsWith("TEST_TOKEN_"))
  ) {
    const config = PRODUCT_CONFIG[productId];
    if (!config) return invalidResult("Unknown product ID");
    const expiresAt = config.isSubscription
      ? new Date(Date.now() + (config.durationDays || 30) * 24 * 60 * 60 * 1000)
      : null;
    return {
      valid: true,
      productId,
      expiresAt,
      status: "active",
      orderId: `GPA.TEST_ORDER_${Date.now()}`,
      isSubscription: config.isSubscription,
    };
  }

  const packageName = process.env.GOOGLE_PLAY_PACKAGE_NAME;
  const auth = getAuthClient();
  if (!auth || !packageName) {
    console.error(
      "[Android Validator] Missing env: GOOGLE_PLAY_SERVICE_ACCOUNT_JSON or GOOGLE_PLAY_PACKAGE_NAME",
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
        productId,
      );
    } else {
      return await verifyOneTimePurchase(
        publisher,
        packageName,
        purchaseToken,
        productId,
      );
    }
  } catch (err: any) {
    const code = err?.code || err?.response?.status;
    const msg = err?.message || String(err);
    console.error(`[Android Validator] Google API error (${code}):`, msg);

    if (code === 404) return invalidResult("Purchase not found on Google Play");
    if (code === 401 || code === 403)
      return invalidResult("Server auth failed with Google Play");
    return invalidResult("Google Play verification failed");
  }
}

async function verifySubscription(
  publisher: ReturnType<typeof google.androidpublisher>,
  packageName: string,
  token: string,
  productId: string,
): Promise<AndroidPurchaseValidationResult> {
  const res = await publisher.purchases.subscriptionsv2.get({
    packageName,
    token,
  });

  const sub = res.data;
  const lineItems = sub.lineItems || [];
  const expiryTime = sub.lineItems?.[0]?.expiryTime;
  const expiresAt = expiryTime ? new Date(expiryTime) : null;

  const subState = sub.subscriptionState;
  let status: AndroidPurchaseValidationResult["status"];
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
    (li: any) => li.productId === productId || li.offerDetails?.basePlanId,
  );

  return {
    valid,
    productId: matchedProduct
      ? productId
      : lineItems[0]?.productId || productId,
    expiresAt,
    status,
    orderId: sub.latestOrderId || null,
    isSubscription: true,
  };
}

async function verifyOneTimePurchase(
  publisher: ReturnType<typeof google.androidpublisher>,
  packageName: string,
  token: string,
  productId: string,
): Promise<AndroidPurchaseValidationResult> {
  const res = await publisher.purchases.products.get({
    packageName,
    productId,
    token,
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
    error: !valid
      ? `purchaseState=${purchaseState}, refunded=${isRefunded}`
      : undefined,
  };
}

export function getAndroidProductIds(): string[] {
  return Object.keys(PRODUCT_CONFIG);
}

export function getAndroidProductPlan(productId: string): string | null {
  return PRODUCT_CONFIG[productId]?.plan || null;
}
