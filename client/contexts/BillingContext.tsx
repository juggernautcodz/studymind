import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiUrl, apiRequest } from "@/lib/query-client";
import { useAuth } from "./AuthContext";

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
  expiresAt: string | null;
  source: "free" | "iap";
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

interface BillingContextType {
  entitlement: EntitlementInfo | null;
  usage: UsageInfo | null;
  loading: boolean;
  refreshEntitlements: () => Promise<void>;
  verifyPurchase: (
    productId: string,
    transactionId?: string,
    purchaseToken?: string,
  ) => Promise<boolean>;
  isFeatureAvailable: (feature: keyof PlanLimits) => boolean;
  canRecord: () => boolean;
  canTranscribe: (additionalMinutes?: number) => boolean;
  devModePro: boolean;
  setDevModePro: (enabled: boolean) => void;
}

const DEFAULT_FREE_LIMITS: PlanLimits = {
  maxRecordingsLifetime: 2,
  maxTranscriptionMinutesPerMonth: 30,
  hasFlashcards: false,
  hasNotes: true,
  hasMindMap: false,
  hasQuizzes: false,
  hasAdaptiveReview: false,
  hasExamMode: false,
  hasExport: false,
};

const DEV_PRO_LIMITS: PlanLimits = {
  maxRecordingsLifetime: -1,
  maxTranscriptionMinutesPerMonth: -1,
  hasFlashcards: true,
  hasNotes: true,
  hasMindMap: true,
  hasQuizzes: true,
  hasAdaptiveReview: true,
  hasExamMode: true,
  hasExport: true,
};

const DEV_PRO_ENTITLEMENT: EntitlementInfo = {
  plan: "PRO",
  limits: DEV_PRO_LIMITS,
  expiresAt: null,
  source: "iap",
};

const BillingContext = createContext<BillingContextType | null>(null);

const ENTITLEMENT_CACHE_KEY = "@studymind_entitlement";
const USAGE_CACHE_KEY = "@studymind_usage";
const DEV_MODE_KEY = "@studymind_dev_mode_pro";

export function BillingProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  const [entitlement, setEntitlement] = useState<EntitlementInfo | null>(null);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [devModePro, setDevModeProState] = useState(false);

  useEffect(() => {
    loadCachedData();
    AsyncStorage.getItem(DEV_MODE_KEY).then((val) => {
      if (val === "true") setDevModeProState(true);
    });
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      refreshEntitlements();
    } else {
      setEntitlement({
        plan: "FREE",
        limits: DEFAULT_FREE_LIMITS,
        expiresAt: null,
        source: "free",
      });
      setLoading(false);
    }
  }, [isAuthenticated]);

  const loadCachedData = async () => {
    try {
      const [cachedEntitlement, cachedUsage] = await Promise.all([
        AsyncStorage.getItem(ENTITLEMENT_CACHE_KEY),
        AsyncStorage.getItem(USAGE_CACHE_KEY),
      ]);

      if (cachedEntitlement) {
        setEntitlement(JSON.parse(cachedEntitlement));
      }
      if (cachedUsage) {
        setUsage(JSON.parse(cachedUsage));
      }
    } catch (error) {
      console.error("Failed to load cached billing data:", error);
    }
  };

  const cacheData = async (ent: EntitlementInfo, usg: UsageInfo) => {
    try {
      await Promise.all([
        AsyncStorage.setItem(ENTITLEMENT_CACHE_KEY, JSON.stringify(ent)),
        AsyncStorage.setItem(USAGE_CACHE_KEY, JSON.stringify(usg)),
      ]);
    } catch (error) {
      console.error("Failed to cache billing data:", error);
    }
  };

  const refreshEntitlements = useCallback(async () => {
    if (!isAuthenticated) return;

    try {
      setLoading(true);
      const url = new URL("/api/billing/entitlements", getApiUrl());
      const authHeaders: Record<string, string> = {};
      try {
        const AsyncStorage = (
          await import("@react-native-async-storage/async-storage")
        ).default;
        const token = await AsyncStorage.getItem("studymind_auth_token");
        if (token) authHeaders["Authorization"] = `Bearer ${token}`;
      } catch {}

      const response = await fetch(url.toString(), {
        headers: authHeaders,
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();
        setEntitlement(data.entitlement);
        setUsage(data.usage);
        await cacheData(data.entitlement, data.usage);
      }
    } catch (error) {
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  const verifyPurchase = useCallback(
    async (
      productId: string,
      transactionId?: string,
      purchaseToken?: string,
    ): Promise<boolean> => {
      try {
        const platform = Platform.OS === "ios" ? "ios" : "android";
        const url = new URL("/api/billing/verify", getApiUrl());

        const response = await apiRequest("POST", url.toString(), {
          platform,
          productId,
          transactionId: transactionId || "TEST_RECEIPT",
          purchaseToken: purchaseToken || "TEST_TOKEN",
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Verification failed");
        }

        const result = await response.json();

        if (result.success) {
          setEntitlement(result.entitlement);
          setUsage(result.usage);
          await cacheData(result.entitlement, result.usage);
          return true;
        }

        return false;
      } catch (error) {
        console.error("Purchase verification failed:", error);
        return false;
      }
    },
    [],
  );

  const setDevModePro = useCallback(async (enabled: boolean) => {
    setDevModeProState(enabled);
    await AsyncStorage.setItem(DEV_MODE_KEY, enabled ? "true" : "false");
  }, []);

  const effectiveEntitlement = devModePro ? DEV_PRO_ENTITLEMENT : entitlement;

  const isFeatureAvailable = useCallback(
    (feature: keyof PlanLimits): boolean => {
      if (devModePro) return true;
      if (!entitlement) return false;
      const value = entitlement.limits[feature];
      if (typeof value === "boolean") return value;
      if (typeof value === "number") return value !== 0;
      return false;
    },
    [entitlement, devModePro],
  );

  const canRecord = useCallback((): boolean => {
    if (devModePro) return true;
    if (!entitlement || !usage) return false;
    const limit = entitlement.limits.maxRecordingsLifetime;
    if (limit === -1) return true;
    return usage.recordingsCount < limit;
  }, [entitlement, usage, devModePro]);

  const canTranscribe = useCallback(
    (additionalMinutes: number = 0): boolean => {
      if (devModePro) return true;
      if (!entitlement || !usage) return false;
      const limit = entitlement.limits.maxTranscriptionMinutesPerMonth;
      if (limit === -1) return true;
      return usage.transcriptionMinutesUsed + additionalMinutes <= limit;
    },
    [entitlement, usage, devModePro],
  );

  return (
    <BillingContext.Provider
      value={{
        entitlement: effectiveEntitlement,
        usage,
        loading,
        refreshEntitlements,
        verifyPurchase,
        isFeatureAvailable,
        canRecord,
        canTranscribe,
        devModePro,
        setDevModePro,
      }}
    >
      {children}
    </BillingContext.Provider>
  );
}

export function useBilling() {
  const context = useContext(BillingContext);
  if (!context) {
    throw new Error("useBilling must be used within a BillingProvider");
  }
  return context;
}

export function usePaywall() {
  const { entitlement, isFeatureAvailable } = useBilling();

  const requireFeature = (feature: keyof PlanLimits): PaywallError | null => {
    if (isFeatureAvailable(feature)) return null;

    const planRequired: PlanType = [
      "hasQuizzes",
      "hasAdaptiveReview",
      "hasExamMode",
      "hasExport",
    ].includes(feature)
      ? "PRO"
      : "PLUS";

    return {
      type: "PAYWALL_REQUIRED",
      planRequired,
      upgradeOptions:
        planRequired === "PRO"
          ? ["com.studymind.pro.monthly", "com.studymind.pro.yearly"]
          : ["com.studymind.plus.monthly", "com.studymind.plus.yearly"],
      currentUsage: {
        recordingsCount: 0,
        transcriptionMinutesUsed: 0,
        storageBytesUsed: 0,
        monthKey: new Date().toISOString().slice(0, 7),
      },
      limit: 0,
      feature,
      message: `This feature requires ${planRequired} plan or higher`,
    };
  };

  return {
    currentPlan: entitlement?.plan || "FREE",
    requireFeature,
    isFeatureAvailable,
  };
}
