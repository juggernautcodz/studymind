import React, { useState, useEffect, useRef } from "react";
import Constants from "expo-constants";
import {
  View,
  StyleSheet,
  ScrollView,
  Platform,
  Pressable,
} from "react-native";
import {
  initConnection,
  endConnection,
  getProducts,
  getSubscriptions,
  requestPurchase,
  requestSubscription,
  purchaseUpdatedListener,
  purchaseErrorListener,
  finishTransaction,
  getAvailablePurchases,
  PurchaseStateAndroid,
  type Purchase,
} from "react-native-iap";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation } from "@react-navigation/native";
import { Icon } from "@/components/Icon";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { BottomSheet } from "@/components/BottomSheet";
import { LoadingState } from "@/components/LoadingState";
import { useTheme } from "@/hooks/useTheme";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/contexts/AuthContext";
import { useBilling } from "@/contexts/BillingContext";
import { Spacing, BorderRadius } from "@/constants/theme";
import { getApiUrl, apiRequest } from "@/lib/query-client";

interface Product {
  id: string;
  name: string;
  description: string;
  plan: string;
  type: "non-consumable" | "subscription";
  period?: string;
  price: string;
  features: string[];
}

interface Entitlement {
  plan: string;
  expiresAt: string | null;
  source: string;
}

const FREE_FEATURES = [
  { text: "3 recordings free", included: true },
  { text: "45 min transcription", included: true },
  { text: "AI-generated notes", included: true },
  { text: "Flashcard generation", included: true },
  { text: "Quiz generation", included: false },
  { text: "Exam mode & analytics", included: false },
];

const BENEFITS = [
  {
    icon: "trending-up" as const,
    text: "Students improve 1 letter grade on average",
  },
  { icon: "clock" as const, text: "Save 5+ hours per week on study prep" },
  { icon: "brain" as const, text: "Remember more with spaced repetition" },
];

const SUBSCRIPTION_SKUS = [
  "com.studymind.plus.monthly",
  "com.studymind.plus.yearly",
  "com.studymind.pro.monthly",
  "com.studymind.pro.yearly",
];
const PRODUCT_SKUS: string[] = [];

// True when running inside Expo Go — IAP native module is not available there.
const IS_EXPO_GO = Constants.appOwnership === "expo";

export default function BillingScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const navigation = useNavigation();
  const { user, updateUser } = useAuth();
  const { verifyPurchase: verifyPurchaseWithContext, refreshEntitlements } = useBilling();

  const { showToast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  const [showRestoreSheet, setShowRestoreSheet] = useState(false);
  const [billingAvailable, setBillingAvailable] = useState(true);
  const gpPricesRef = useRef<Record<string, string>>({});
  const androidOfferTokensRef = useRef<Record<string, string>>({});
  const purchaseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPurchasingState = () => {
    if (purchaseTimeoutRef.current) {
      clearTimeout(purchaseTimeoutRef.current);
      purchaseTimeoutRef.current = null;
    }
    setPurchasing(null);
  };

  useEffect(() => {
    fetchServerProducts();
    fetchEntitlements();
  }, []);

  useEffect(() => {
    // Expo Go does not ship the native IAP module — skip all IAP init to
    // prevent an E_IAP_NOT_AVAILABLE crash. The friendly fallback UI renders
    // instead. Production / dev-client builds run the full flow below.
    if (IS_EXPO_GO) {
      setBillingAvailable(false);
      return;
    }

    let purchaseListener: { remove: () => void } | null = null;
    let errorListener: { remove: () => void } | null = null;

    const init = async () => {
      try {
        await initConnection();

        // Only register listeners after a successful connection.
        purchaseListener = purchaseUpdatedListener(async (purchase: Purchase) => {
          const androidState = (purchase as any).purchaseStateAndroid;
          const purchased =
            androidState == null || androidState === PurchaseStateAndroid.PURCHASED;
          if (!purchased) return;
          await processPurchase(purchase);
        });

        errorListener = purchaseErrorListener((error: any) => {
          if (error.code !== "E_USER_CANCELLED") {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            showToast({
              type: "error",
              title: "Purchase Failed",
              message: error.message || "Something went wrong.",
            });
          }
          clearPurchasingState();
        });

        const [subsResult, prodsResult] = await Promise.allSettled([
          getSubscriptions({ skus: SUBSCRIPTION_SKUS }),
          PRODUCT_SKUS.length > 0
            ? getProducts({ skus: PRODUCT_SKUS })
            : Promise.resolve([] as any[]),
        ]);

        const prices: Record<string, string> = {};
        const offerTokens: Record<string, string> = {};
        if (subsResult.status === "fulfilled") {
          for (const s of subsResult.value as any[]) {
            // react-native-iap v12's Android Billing v5 shape: a subscription's
            // price and offerToken live under subscriptionOfferDetails, not on
            // the subscription object itself. Every base plan/offer requires an
            // explicit offerToken passed to requestSubscription(), or Google
            // Play's native purchase UI can't resolve a proper title for the
            // offer and falls back to showing the raw base plan ID (e.g.
            // "plus-monthly-base") instead of the subscription's display name.
            const offer = s.subscriptionOfferDetails?.[0];
            if (offer?.offerToken) {
              offerTokens[s.productId] = offer.offerToken;
            }
            // Last pricing phase is the ongoing recurring price (any trial/
            // intro phase, if present, comes first in the list).
            const phase = offer?.pricingPhases?.pricingPhaseList?.slice(-1)[0];
            if (phase?.formattedPrice) {
              prices[s.productId] = phase.formattedPrice;
            } else if (s.localizedPrice) {
              prices[s.productId] = s.localizedPrice;
            }
          }
        }
        if (prodsResult.status === "fulfilled") {
          for (const p of prodsResult.value as any[]) {
            if (p.localizedPrice) {
              prices[p.productId] = p.localizedPrice;
            }
          }
        }
        gpPricesRef.current = prices;
        androidOfferTokensRef.current = offerTokens;

        setProducts((prev) =>
          prev.map((p) =>
            prices[p.id] ? { ...p, price: prices[p.id] } : p,
          ),
        );
      } catch (e: any) {
        console.log("[IAP] Init failed:", e);
        if (e?.code === "E_IAP_NOT_AVAILABLE") {
          setBillingAvailable(false);
        }
      }
    };

    init();

    return () => {
      purchaseListener?.remove();
      errorListener?.remove();
      endConnection().catch(() => {});
      if (purchaseTimeoutRef.current) clearTimeout(purchaseTimeoutRef.current);
    };
  }, []);

  const processPurchase = async (purchase: Purchase) => {
    try {
      // Delegate to BillingContext.verifyPurchase — it derives the correct
      // platform from Platform.OS (this screen used to hardcode "android",
      // which broke iOS verification) and keeps BillingContext's own
      // entitlement/usage state in sync instead of drifting from it.
      const success = await verifyPurchaseWithContext(
        purchase.productId,
        undefined,
        purchase.purchaseToken || undefined,
      );

      if (!success) {
        throw new Error("Purchase verification failed");
      }

      // The purchase is already granted server-side once verify succeeds —
      // update local state and tell the user now, so a subsequent
      // finishTransaction failure (network hiccup, store glitch) doesn't
      // get reported as a purchase failure when it already succeeded.
      const freshEntitlement = await fetchEntitlements();
      if (freshEntitlement) {
        await updateUser({ plan: freshEntitlement.plan as "FREE" | "PLUS" | "PRO" });
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({
        type: "success",
        title: "Welcome to " + (freshEntitlement?.plan || "your new plan"),
        message: "You now have full access to all features!",
      });

      try {
        await finishTransaction({ purchase, isConsumable: false });
      } catch (finishError) {
        console.warn(
          "[IAP] finishTransaction failed after a successful verify — purchase is still granted:",
          finishError,
        );
      }

      navigation.goBack();
    } catch (error: any) {
      console.error("[IAP] processPurchase error:", error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({
        type: "error",
        title: "Purchase Failed",
        message: error.message || "Something went wrong. Please try again.",
      });
    } finally {
      clearPurchasingState();
    }
  };

  const fetchServerProducts = async () => {
    try {
      const url = new URL("/api/billing/products", getApiUrl());
      const response = await fetch(url.toString());
      const data = await response.json();
      setProducts(data.products || []);
    } catch (error) {
      console.error("Failed to fetch products:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchEntitlements = async (): Promise<Entitlement | null> => {
    try {
      const url = new URL("/api/billing/entitlements", getApiUrl());
      const response = await apiRequest("GET", url.toString());
      const data = await response.json();
      setEntitlement(data.entitlement);
      return data.entitlement;
    } catch (error) {
      console.log("Failed to fetch entitlements (may not be authenticated)");
      return null;
    }
  };

  const handlePurchase = async (product: Product) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPurchasing(product.id);

    try {
      if (product.type === "subscription") {
        const offerToken = androidOfferTokensRef.current[product.id];
        if (Platform.OS === "android" && !offerToken) {
          // Android subscriptions require an offerToken (Billing v5) — if we
          // don't have one, native product/offer data never loaded correctly,
          // so there's nothing valid to purchase against yet.
          throw new Error(
            "This plan isn't available for purchase right now. Please try again in a moment.",
          );
        }
        await requestSubscription(
          Platform.OS === "ios"
            ? { sku: product.id }
            : { subscriptionOffers: [{ sku: product.id, offerToken: offerToken! }] },
        );
      } else {
        await requestPurchase(
          Platform.OS === "ios" ? { sku: product.id } : { skus: [product.id] },
        );
      }
      // Purchase result handled in purchaseUpdatedListener. As a safety net,
      // if the listener never fires (e.g. the app was backgrounded during
      // the native purchase UI, or it raced initConnection), clear the
      // spinner after a while so the button doesn't stay stuck forever.
      if (purchaseTimeoutRef.current) clearTimeout(purchaseTimeoutRef.current);
      purchaseTimeoutRef.current = setTimeout(() => {
        purchaseTimeoutRef.current = null;
        setPurchasing((current) => (current === product.id ? null : current));
      }, 30000);
    } catch (error: any) {
      if (error.code !== "E_USER_CANCELLED") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        showToast({
          type: "error",
          title: "Purchase Failed",
          message: error.message || "Something went wrong. Please try again.",
        });
      }
      clearPurchasingState();
    }
  };

  const handleRestorePurchases = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowRestoreSheet(true);
  };

  const confirmRestore = async () => {
    setShowRestoreSheet(false);
    try {
      const purchases = await getAvailablePurchases();
      if (purchases.length === 0) {
        showToast({ type: "info", title: "Nothing to Restore", message: "No previous purchases found." });
        return;
      }
      for (const purchase of purchases) {
        await processPurchase(purchase);
      }
    } catch (err: any) {
      console.error("[IAP] confirmRestore error:", err);
      showToast({
        type: "error",
        title: "Restore Failed",
        message: err?.message || "Could not check your purchase history. Please try again.",
      });
    }
  };

  const currentPlan = entitlement?.plan || user?.plan || "FREE";

  const getRecommendedProduct = () => {
    return products.find((p) => p.plan === "PRO" && p.period === "yearly");
  };

  const renderFeatureRow = (
    text: string,
    included: boolean,
    highlight = false,
  ) => (
    <View style={styles.featureRow} key={text}>
      <View
        style={[
          styles.featureIcon,
          {
            backgroundColor: included
              ? theme.success + "20"
              : theme.error + "20",
          },
        ]}
      >
        <Icon
          name={included ? "check" : "x"}
          size={12}
          color={included ? theme.success : theme.error}
        />
      </View>
      <ThemedText
        type="small"
        style={[
          styles.featureText,
          !included && { color: theme.textSecondary },
          highlight && { fontWeight: "600" },
        ]}
      >
        {text}
      </ThemedText>
    </View>
  );

  const renderProductCard = (product: Product, isRecommended: boolean) => {
    const isCurrentPlan = currentPlan === product.plan;
    const isPro = product.plan === "PRO";

    return (
      <Card
        key={product.id}
        style={
          isRecommended
            ? [styles.planCard, { borderColor: theme.link, borderWidth: 2 }]
            : styles.planCard
        }
      >
        {isRecommended ? (
          <View
            style={[styles.recommendedBadge, { backgroundColor: theme.link }]}
          >
            <Icon
              name="star"
              size={12}
              color="#fff"
              style={{ marginRight: 4 }}
            />
            <ThemedText type="caption" style={styles.recommendedText}>
              RECOMMENDED
            </ThemedText>
          </View>
        ) : null}

        <View style={styles.planHeader}>
          <View>
            <ThemedText type="h2">{product.name}</ThemedText>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              {product.description}
            </ThemedText>
          </View>
          {isCurrentPlan ? <Badge label="Current" variant="success" /> : null}
        </View>

        <View style={styles.priceSection}>
          <ThemedText type="display" style={styles.price}>
            {product.price.split("/")[0]}
          </ThemedText>
          <View style={styles.priceDetails}>
            <ThemedText type="body" style={{ color: theme.textSecondary }}>
              {product.type === "subscription"
                ? `per ${product.period}`
                : "one-time"}
            </ThemedText>
            {product.period === "yearly" ? (
              <Badge label="Save 50%" variant="success" />
            ) : null}
          </View>
        </View>

        <View style={styles.featuresSection}>
          {product.features.map((feature) =>
            renderFeatureRow(feature, true, isPro),
          )}
        </View>

        <Button
          onPress={() => handlePurchase(product)}
          disabled={isCurrentPlan || purchasing !== null}
          loading={purchasing === product.id}
          variant={isRecommended ? "primary" : "secondary"}
          size="lg"
          fullWidth
        >
          {isCurrentPlan
            ? "Current Plan"
            : product.type === "subscription"
              ? "Subscribe Now"
              : "Purchase"}
        </Button>
      </Card>
    );
  };

  if (loading) {
    return <LoadingState fullScreen message="Loading plans..." />;
  }

  if (!billingAvailable) {
    return (
      <ThemedView style={[styles.container, { justifyContent: "center", alignItems: "center", padding: Spacing["2xl"] }]}>
        <Icon name="shopping-cart" size={48} color={theme.textSecondary} />
        <ThemedText type="h2" style={{ textAlign: "center", marginTop: Spacing.xl, marginBottom: Spacing.md }}>
          Purchases Unavailable
        </ThemedText>
        <ThemedText type="body" style={{ textAlign: "center", color: theme.textSecondary }}>
          Purchases are unavailable in this environment.{"\n\n"}To manage your subscription, please use the production app on Google Play.
        </ThemedText>
      </ThemedView>
    );
  }

  const recommendedProduct = getRecommendedProduct();
  const otherProducts = products.filter((p) => p.id !== recommendedProduct?.id);

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: headerHeight + Spacing.lg,
            paddingBottom: insets.bottom + Spacing["3xl"],
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View
            style={[styles.headerIcon, { backgroundColor: theme.link + "15" }]}
          >
            <Icon name="zap" size={28} color={theme.link} />
          </View>
          <ThemedText type="h1" style={styles.title}>
            Ace Your Exams
          </ThemedText>
          <ThemedText
            type="body"
            style={[styles.subtitle, { color: theme.textSecondary }]}
          >
            Join students who boosted their grades with smarter studying
          </ThemedText>
        </View>

        <View style={styles.benefitsSection}>
          {BENEFITS.map((benefit, index) => (
            <View key={index} style={styles.benefitRow}>
              <Icon name={benefit.icon} size={18} color={theme.success} />
              <ThemedText type="body" style={styles.benefitText}>
                {benefit.text}
              </ThemedText>
            </View>
          ))}
        </View>

        {recommendedProduct
          ? renderProductCard(recommendedProduct, true)
          : null}

        {otherProducts.map((product) => renderProductCard(product, false))}

        <Card style={styles.freeCard}>
          <View style={styles.planHeader}>
            <ThemedText type="h3">Free Plan</ThemedText>
            {currentPlan === "FREE" ? (
              <Badge label="Current" variant="success" />
            ) : null}
          </View>
          <View style={styles.freeFeaturesGrid}>
            {FREE_FEATURES.map((feature) =>
              renderFeatureRow(feature.text, feature.included),
            )}
          </View>
        </Card>

        <View style={styles.footer}>
          <Pressable
            onPress={handleRestorePurchases}
            style={styles.restoreLink}
            accessibilityRole="button"
            accessibilityLabel="Restore previous purchases"
          >
            <ThemedText type="small" style={{ color: theme.link }}>
              Restore Purchases
            </ThemedText>
          </Pressable>

          <View style={styles.trustSection}>
            <View style={styles.trustItem}>
              <Icon name="refresh-cw" size={14} color={theme.textSecondary} />
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                Cancel anytime
              </ThemedText>
            </View>
            <View style={styles.trustItem}>
              <Icon name="lock" size={14} color={theme.textSecondary} />
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                Secure payment
              </ThemedText>
            </View>
          </View>

          <ThemedText
            type="caption"
            style={[styles.legalText, { color: theme.textSecondary }]}
          >
            Subscriptions auto-renew unless canceled 24 hours before the end of
            the current period. Manage in your App Store or Google Play
            settings.
          </ThemedText>

        </View>
      </ScrollView>

      <BottomSheet
        visible={showRestoreSheet}
        onClose={() => setShowRestoreSheet(false)}
        title="Restore Purchases"
      >
        <ThemedText type="body" style={{ color: theme.textSecondary, marginBottom: Spacing.lg }}>
          This will check your purchase history and restore any previous subscriptions.
        </ThemedText>
        <Button
          variant="primary"
          fullWidth
          onPress={confirmRestore}
        >
          Restore
        </Button>
        <Button
          variant="ghost"
          fullWidth
          onPress={() => setShowRestoreSheet(false)}
          style={{ marginTop: Spacing.sm }}
        >
          Cancel
        </Button>
      </BottomSheet>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
  },
  header: {
    alignItems: "center",
    marginBottom: Spacing["2xl"],
  },
  headerIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.lg,
  },
  title: {
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  subtitle: {
    textAlign: "center",
  },
  benefitsSection: {
    marginBottom: Spacing["2xl"],
  },
  benefitRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  benefitText: {
    marginLeft: Spacing.md,
  },
  planCard: {
    marginBottom: Spacing.lg,
    position: "relative",
    overflow: "hidden",
    shadowColor: "#7C3AED",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  recommendedBadge: {
    position: "absolute",
    top: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderBottomLeftRadius: BorderRadius.sm,
  },
  recommendedText: {
    color: "#fff",
    fontWeight: "700",
  },
  planHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: Spacing.lg,
  },
  priceSection: {
    flexDirection: "row",
    alignItems: "baseline",
    marginBottom: Spacing.lg,
  },
  price: {
    marginRight: Spacing.sm,
  },
  priceDetails: {
    gap: Spacing.xs,
  },
  featuresSection: {
    marginBottom: Spacing.lg,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  featureIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  featureText: {
    marginLeft: Spacing.sm,
    flex: 1,
  },
  freeCard: {
    marginBottom: Spacing.xl,
  },
  freeFeaturesGrid: {
    marginTop: Spacing.md,
  },
  footer: {
    alignItems: "center",
  },
  restoreLink: {
    padding: Spacing.md,
    marginBottom: Spacing.md,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  trustSection: {
    flexDirection: "row",
    gap: Spacing.xl,
    marginBottom: Spacing.lg,
  },
  trustItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  legalText: {
    textAlign: "center",
    lineHeight: 18,
  },
  reviewerNote: {
    textAlign: "center",
    marginTop: Spacing.lg,
    fontStyle: "italic",
  },
});
