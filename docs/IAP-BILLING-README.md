# StudyMind IAP Billing System

This document describes the In-App Purchase (IAP) billing system for StudyMind, designed for iOS App Store and Google Play Store compliance.

## Overview

StudyMind uses platform-native In-App Purchases for monetization:
- **iOS**: App Store In-App Purchases (StoreKit)
- **Android**: Google Play Billing

**IMPORTANT**: This app sells digital features/content. Therefore, all purchases within the iOS/Android apps MUST use platform IAP. Stripe/external payment links are NOT allowed in mobile apps per App Store and Google Play policies.

## Plan Tiers

### FREE (Default)
- 2 recordings lifetime
- 30 minutes transcription total
- Basic notes only
- No flashcard generation, quizzes, or advanced features

### BASE (One-Time Purchase - $9.99)
- **Product ID**: `com.studymind.base.lifetime`
- **Type**: Non-consumable (lifetime unlock)
- Unlocks: Mind map, flashcards, notes
- 60 min transcription/month

### PRO (Auto-Renewing Subscription)
- **Product IDs**: 
  - `com.studymind.pro.monthly` ($4.99/month)
  - `com.studymind.pro.yearly` ($49.99/year)
- **Type**: Auto-renewing subscription
- Unlocks: Quizzes, exam mode, adaptive review, export
- 300 min transcription/month

## Backend Architecture

### Database Models (Prisma/SQLite)

```prisma
model SubscriptionStatus {
  id               String    @id @default(uuid())
  userId           String    @unique
  platform         String    // 'ios' | 'android'
  status           String    // 'active' | 'inactive' | 'canceled' | 'grace_period'
  productId        String?
  currentPeriodEnd DateTime?
}

model Purchase {
  id                         String    @id @default(uuid())
  userId                     String
  platform                   String
  productId                  String
  purchaseTokenOrTransactionId String
  rawReceiptJson             String?
  verifiedAt                 DateTime?
}

model Entitlement {
  id        String    @id @default(uuid())
  userId    String    @unique
  plan      String    // 'FREE' | 'BASE' | 'PRO'
  expiresAt DateTime? // null for lifetime/free
  source    String    // 'free' | 'iap'
}

model Usage {
  id                       String @id @default(uuid())
  userId                   String
  monthKey                 String // 'YYYY-MM'
  recordingsCount          Int
  transcriptionMinutesUsed Float
  storageBytesUsed         Int
  
  @@unique([userId, monthKey])
}
```

### API Endpoints

#### GET /api/billing/products
Returns available IAP products with pricing and features.

#### POST /api/billing/verify
Validates purchase receipts and updates entitlements.

**Request Body:**
```json
{
  "platform": "ios" | "android",
  "productId": "com.studymind.pro.monthly",
  "receiptData": "base64_receipt_data",  // iOS
  "transactionId": "transaction_id",      // iOS
  "purchaseToken": "purchase_token"       // Android
}
```

**Response:**
```json
{
  "success": true,
  "entitlement": {
    "plan": "PRO",
    "limits": { ... },
    "expiresAt": "2025-02-23T00:00:00Z",
    "source": "iap"
  },
  "usage": { ... }
}
```

#### GET /api/billing/entitlements
Returns current user's plan, limits, and usage.

## Receipt Validation

### Development Mode (TEST_RECEIPT)

For local development and testing, the validators accept:
- **iOS**: `receiptData = "TEST_RECEIPT"`
- **Android**: `purchaseToken = "TEST_TOKEN"`

These return valid=true with the corresponding plan.

### Production Implementation

#### iOS (Apple App Store)

Replace stub in `server/billing/iosReceiptValidator.ts`:

```typescript
import { AppStoreServerAPIClient, Environment } from '@apple/app-store-server-library';

const client = new AppStoreServerAPIClient(
  signingKey,     // Private key from App Store Connect
  keyId,          // Key ID
  issuerId,       // Issuer ID
  bundleId,       // com.studymind.app
  Environment.Production
);

const transactionInfo = await client.getTransactionInfo(transactionId);
// Parse and validate transactionInfo
```

#### Android (Google Play)

Replace stub in `server/billing/androidPurchaseValidator.ts`:

```typescript
import { google } from 'googleapis';

const auth = new google.auth.GoogleAuth({
  keyFile: './service-account-key.json',
  scopes: ['https://www.googleapis.com/auth/androidpublisher']
});

const androidPublisher = google.androidpublisher({ version: 'v3', auth });

// For subscriptions:
const response = await androidPublisher.purchases.subscriptions.get({
  packageName: 'com.studymind.app',
  subscriptionId: productId,
  token: purchaseToken
});
```

## Frontend Integration

### React Native IAP Flow

```typescript
import * as InAppPurchases from 'expo-in-app-purchases';

// 1. Connect to store
await InAppPurchases.connectAsync();

// 2. Get products
const { results } = await InAppPurchases.getProductsAsync([
  'com.studymind.base.lifetime',
  'com.studymind.pro.monthly',
  'com.studymind.pro.yearly'
]);

// 3. Purchase
const purchase = await InAppPurchases.purchaseItemAsync(productId);

// 4. Get receipt and verify
const receipt = await InAppPurchases.getReceiptAsync();
const response = await fetch('/api/billing/verify', {
  method: 'POST',
  body: JSON.stringify({
    platform: 'ios',
    productId,
    receiptData: receipt
  })
});

// 5. Finish transaction
await InAppPurchases.finishTransactionAsync(purchase);
```

### Paywall Hook

```typescript
import { usePaywall } from '@/contexts/BillingContext';

function QuizScreen() {
  const { requireFeature } = usePaywall();
  
  const paywallError = requireFeature('hasQuizzes');
  if (paywallError) {
    return <UpgradePrompt error={paywallError} />;
  }
  
  return <QuizContent />;
}
```

## Testing Instructions

### Local Development

1. Start the backend:
   ```bash
   npm run server:dev
   ```

2. Test the products endpoint:
   ```bash
   curl http://localhost:5000/api/billing/products
   ```

3. Simulate a purchase (requires authentication):
   ```bash
   curl -X POST http://localhost:5000/api/billing/verify \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -d '{
       "platform": "ios",
       "productId": "com.studymind.pro.monthly",
       "receiptData": "TEST_RECEIPT"
     }'
   ```

### Sandbox Testing

#### iOS
1. Create sandbox tester accounts in App Store Connect
2. Sign out of production App Store on device
3. Sign in with sandbox account when prompted during purchase
4. Use sandbox environment URL for receipt validation

#### Android
1. Add test accounts in Google Play Console
2. Use license testing for free transactions
3. Use `isTestPurchase` flag in response to identify test purchases

## Store Setup Checklist

### App Store Connect (iOS)
- [ ] Create app record with bundle ID
- [ ] Configure In-App Purchases (non-consumable + subscriptions)
- [ ] Set up subscription groups
- [ ] Create App Store Server API key
- [ ] Configure server-to-server notifications
- [ ] Add sandbox tester accounts

### Google Play Console (Android)
- [ ] Create app with package name
- [ ] Set up billing products
- [ ] Create service account for API access
- [ ] Grant service account access to billing
- [ ] Configure real-time developer notifications
- [ ] Add license testers

## Security Considerations

1. **Always validate receipts server-side** - Never trust client-side validation
2. **Store receipts** - Keep raw receipt data for dispute resolution
3. **Handle grace periods** - Subscriptions may have billing grace periods
4. **Prevent duplicate transactions** - Check `originalTransactionId` (iOS) or `orderId` (Android)
5. **Implement webhook handlers** - For real-time subscription status updates
