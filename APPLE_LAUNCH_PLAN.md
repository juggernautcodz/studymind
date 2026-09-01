# StudyMind — Apple App Store Launch Plan

Written 2026-08-24. Picks up after the full server/client security & correctness
audit (Phases 1-6, see git log `89e79ea`, `abaf59c`, `e7d6638`, `a7f4eb2`,
`dd50572`) was completed and Android IAP billing was confirmed working
end-to-end in production (real purchase + restore verified against Play
Console on 2026-08-24).

**Baseline state at time of writing:**
- Android: live on Play Store, production track, IAP billing verified working
  (Google Play Android Developer API enabled + service account granted
  "View financial data" + app access in Play Console).
- iOS: bundle ID is **`com.shanethetester.studymind`** (changed 2026-08-29 —
  `com.studymind.app` was already claimed by an unrelated Apple Developer
  account and unavailable to register; Android's `com.studymind.app`
  package name is untouched, the two platforms don't need to match). App ID
  registered with Push Notifications capability (In-App Purchase is on by
  default). App Store Connect app created 2026-08-29 under the name
  **"StudyMind — AI Study Assistant"** (plain "StudyMind" and "StudyMind AI"
  were both already taken as App Store display names — unrelated to the
  bundle ID collision above, this is a separate Apple namespace). SKU:
  `studymind-ios-001`. `server/billing/iosReceiptValidator.ts`
  is a stub — the production code path always returns `valid: false` with
  `error: "Production validation not configured"` (see file, lines 113-147).
  Only `TEST_RECEIPT`/`TEST_RECEIPT_*` values work, and only outside
  `NODE_ENV=production`.
- Stripe (`studymind-web`) stays exactly as-is — out of scope for this plan,
  not touched by any of this.

**Isolation guarantee:** every step below is additive and iOS-specific.
Nothing here requires editing `androidPurchaseValidator.ts`, the Android
block of `app.json`, the `android` build profile in `eas.json`, or any
Android env var. Android ships from the same repo without any risk of
regression from this work.

---

## Phase 0 — Apple account setup (you, no code, do this first)

**Status: Program fee paid.** Everything below is the granular click-by-click
sequence for what's left. Do them in order — later steps need App IDs/keys
from earlier ones.

### 0.1 Confirm enrollment is fully active
- Go to developer.apple.com/account. Membership can take up to 48h to show
  "Active" even after payment clears — if it still says "Enrollment in
  progress," wait before continuing (App Store Connect app creation will
  fail or be greyed out until this flips).

### 0.2 Register the App ID (bundle ID) — do this BEFORE App Store Connect
- developer.apple.com/account → **Certificates, Identifiers & Profiles**
  → **Identifiers** (left sidebar) → **+** button
- Select **App IDs** → Continue → Type: **App**
- Description: `StudyMind` (internal label only, not user-facing)
- Bundle ID: **Explicit** → enter `com.shanethetester.studymind` exactly
  (must match `app.json` — do not use a wildcard ID). `com.studymind.app`
  was tried first and rejected as already claimed by an unrelated Apple
  Developer account — this new ID is the one actually in use.
- Capabilities: check **Push Notifications** (confirmed needed —
  `client/lib/notifications.ts` calls `getExpoPushTokenAsync()` for remote
  push, not just local reminders). In-App Purchase is on by default for
  every App ID, no checkbox needed.
- Register. This must exist before App Store Connect will let you pick a
  bundle ID for the new app in step 0.3.

### 0.3 Create the app in App Store Connect
- appstoreconnect.apple.com → **Apps** → **+** → **New App**
- Platform: **iOS**
- Name: `StudyMind` — App Store names are globally unique (unlike Play
  Store); if taken, have a fallback ready (e.g. "StudyMind AI",
  "StudyMind — AI Study Assistant")
- Primary language: English (or your target market's primary language)
- Bundle ID: select `com.shanethetester.studymind` from the dropdown
  (populated from step 0.2 — if it's not there, step 0.2 didn't save or
  hasn't propagated yet, wait a few minutes and refresh)
- SKU: any unique internal string you won't reuse, e.g. `studymind-ios-001`
  (never shown to users, just Apple's internal bookkeeping)
- User Access: Full Access (default is fine for a solo account)

### 0.4 App Information tab (can be partial for now, but start it)
- **Privacy Policy URL** — required before submission; reuse the one
  already live for Android/Play Store if it covers iOS data handling too
- **Category** (primary + optional secondary) — likely Education or
  Productivity depending on how StudyMind is positioned
- **Content Rights** — declare whether the app contains third-party content
  requiring rights documentation (almost certainly "No" for StudyMind)

### 0.5 App Privacy questionnaire ("nutrition label")
- App Store Connect → your app → **App Privacy** tab → **Get Started**
- Answer per data type StudyMind actually collects — be accurate, Apple
  spot-checks this against actual app behavior during review:
  - Account email (linked to identity, used for account functionality)
  - Audio recordings (if StudyMind records audio — linked to identity,
    used for app functionality; check `app.json`'s
    `NSMicrophoneUsageDescription` to confirm this applies)
  - Usage/analytics data (if any analytics SDK is integrated)
- This becomes the public "App Privacy" label on your store listing —
  under-declaring is a common rejection reason, over-declaring just looks
  slightly less private than necessary

### 0.6 Age rating questionnaire
- App Store Connect → your app → **Age Rating** tab → answer the
  questionnaire (violence, gambling, user-generated content, etc.) —
  for a study app this should land at 4+ unless it has open chat/UGC

### 0.7 Create a subscription group, then the 4 IAP products
Auto-renewable subscriptions must live inside a **Subscription Group**
first — you can't create standalone subscription products.
- App Store Connect → your app → **Monetization** → **Subscriptions** →
  **+** next to "Subscription Groups" → name it something like
  `studymind_plans` (internal only)
- Inside that group, **+** to add each subscription, one at a time:
  1. `com.studymind.plus.monthly` — Reference name `Plus Monthly`,
     Duration: 1 month
  2. `com.studymind.plus.yearly` — Duration: 1 year
  3. `com.studymind.pro.monthly` — Duration: 1 month
  4. `com.studymind.pro.yearly` — Duration: 1 year
  - (Skip the retired lifetime SKU — no new purchasers, only legacy
    Android holders restore it.)
- For each: set the **Price** using Apple's price tier picker to match the
  same effective price as the Android SKU (enter one reference territory's
  price, e.g. USD, and Apple auto-populates the rest — don't try to
  manually match every currency)
- Each subscription needs: a localized display name, description, and (for
  the *first* subscription in the group only) a **review screenshot** —
  Apple requires one screenshot showing the subscription purchase UI for
  App Review, upload any placeholder-quality screenshot of the paywall
  screen, it just needs to exist
- Set **Subscription Group Localization** display name (shown to users
  choosing between tiers) — e.g. "StudyMind Plans"

### 0.8 Generate the App Store Server API key (for server-side receipt validation)
- App Store Connect → **Users and Access** → **Integrations** tab (Apple
  has renamed this a few times — look for "In-App Purchase" or "App Store
  Server API" under Integrations if "Integrations" itself isn't the tab
  name)
- Generate a new key, role: whatever Apple offers for App Store Server API
  (not "Admin"/"Finance" — pick the narrowest one shown)
- **Download the `.p8` file immediately — Apple only allows this once.**
  Save it into a password manager or encrypted note right away; if you
  navigate away before downloading, you must revoke and regenerate.
- Note down alongside it, from the same screen:
  - **Key ID** (short alphanumeric string)
  - **Issuer ID** (UUID, same for all your keys — visible at the top of
    the Integrations/API Keys page)

### 0.9 Generate a second key for automated `eas submit` (optional, can defer to Phase 3)
- Easiest path: skip this entirely and let `eas submit --platform ios`
  prompt you to generate/store an App Store Connect API key itself the
  first time you run it (Phase 3) — EAS handles the key generation UI for
  you.
- If you'd rather do it manually now: App Store Connect → **Users and
  Access** → **Keys** tab (this is a *different* tab from Integrations) →
  generate a key with **App Manager** role. This is a separate key from
  0.8's App Store Server key even though both live under Apple's "API
  Keys" UI — one verifies purchases server-side, the other authenticates
  CLI/CI app submissions. Label them clearly when downloaded so they don't
  get conflated.

**Status: Phase 0 complete** (2026-08-31) — all 4 subscriptions created
under group `studymind_plans` (Plus/Pro × Monthly/Yearly, priced in CAD to
match Play Console), App Store Server API key generated (`.p8` downloaded,
Key ID + Issuer ID saved by Shane outside this repo/chat).

---

## Phase 1 — Server: real iOS receipt validation ✅ done (2026-08-31)

File: `server/billing/iosReceiptValidator.ts`, fully rewritten (not just
the production branch — the function's first parameter changed meaning
from `receiptData` to `transactionId`, see the Phase 2 note below on why).

What was built:
1. `npm install @apple/app-store-server-library` (`^3.1.0`, in
   `package.json`).
2. Apple's root CA cert (`AppleRootCA-G3.cer`, from
   apple.com/certificateauthority/) downloaded and checked into
   `server/billing/certs/AppleRootCA-G3.cer` — required locally by
   `SignedDataVerifier` to verify Apple's JWS signatures, per the
   library's README ("Obtaining Apple Root Certificates").
3. 4 new env vars, all required in production (fails closed — returns
   `{ valid: false, error: "Billing not configured" }` if any is
   missing, doesn't crash the process):
   - `APPLE_IAP_SIGNING_KEY` — the `.p8` file's contents (PEM string), not
     a file path — same convention as `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`.
   - `APPLE_IAP_KEY_ID` — from Phase 0 step 0.8.
   - `APPLE_IAP_ISSUER_ID` — from Phase 0 step 0.8.
   - `APPLE_APP_ID` — the app's numeric Apple ID (**`6806695446`**, shown
     on the App Information page in App Store Connect). Required by
     `SignedDataVerifier`'s constructor for `Environment.Production` (it
     throws `"appAppleId is required when the environment is Production"`
     otherwise) — this is a separate value from Key ID/Issuer ID/bundle ID
     and easy to miss.
4. `verifyIosReceipt(transactionId, productId)` calls
   `AppStoreServerAPIClient.getTransactionInfo(transactionId)`, tries
   **Production first**, and falls back to **Sandbox** on
   `APIError.ORIGINAL_TRANSACTION_ID_NOT_FOUND` (HTTP 404) — this is
   Apple's documented pattern for a prod server receiving a
   TestFlight/sandbox purchase; the fallback is unconditional, not gated
   on `NODE_ENV`. The signed transaction is then verified + decoded via
   `SignedDataVerifier.verifyAndDecodeTransaction()`, mapped through the
   existing `TEST_PRODUCTS` table for plan lookup, and returned in the
   same `IosReceiptValidationResult` shape the old stub used.
5. Bundle ID (`com.shanethetester.studymind`) is a hardcoded constant in
   the file, not an env var — matches how it's fixed in `app.json`.

**Verified:** `tsc --noEmit` clean, `server:build` (esbuild) succeeds,
and a local smoke test (`tsx`, temp file, deleted after) confirmed both
the dev `TEST_RECEIPT` path and the fail-closed "unconfigured" path work.
Real Apple API calls are untested — needs Phase 4 (TestFlight) since that
requires an actual signed transaction ID from a real sandbox purchase.

---

## Phase 2 — Client: confirm iOS purchase flow correctness ✅ done (2026-08-31)

Found and fixed a real bug while implementing Phase 1: `BillingScreen.tsx`'s
`processPurchase()` was calling `verifyPurchaseWithContext(productId,
undefined, purchase.purchaseToken)` for *every* platform — the 2nd arg
(receipt/transaction identifier) was always `undefined` on iOS. Two things
made this invisible until now: `BillingContext.tsx` defaulted the missing
value to the literal string `"TEST_RECEIPT"` before sending it, and the old
server stub always returned `valid: false` anyway regardless of input — so
real iOS purchases would have silently failed verification in production
forever, masked by the stub.

Also discovered: `react-native-iap` v14's `Purchase.purchaseToken` field is
**unified but platform-divergent** — "iOS JWS, Android purchaseToken" per
its own type doc. On iOS it holds a JWS blob, not a usable API identifier.
The correct field for Apple's App Store Server API is `Purchase.transactionId`
(present on both `PurchaseIOS` and `PurchaseAndroid`), which is the numeric
transaction ID `getTransactionInfo()` expects.

Fix applied across 3 files:
- `client/screens/BillingScreen.tsx` — now passes `purchase.transactionId`
  as the 2nd arg instead of `undefined`.
- `client/contexts/BillingContext.tsx` — `verifyPurchase()`'s 2nd param
  renamed `receiptData` → `transactionId` (matches what it actually is now
  that legacy `verifyReceipt` was never implemented), request body key
  changed from `receiptData` to `transactionId` to match.
- `server/billing.ts` — the `/verify` route now passes `transactionId ||
  receiptData` into `verifyIosReceipt()` instead of always passing
  `receiptData` alone (which the client never sent).

**No Android code touched** — `Purchase.purchaseToken` is untouched and
still flows to the Android branch exactly as before; only the iOS-relevant
identifier changed.

**Not yet verified against a real device** — this can only be confirmed
end-to-end in Phase 4 (TestFlight), since it needs a real StoreKit
purchase to produce a real `transactionId`.

---

## Phase 3 — EAS build & submit config for iOS

`eas.json` currently has no iOS-specific keys under `build.production`,
`build.preview`, etc. — profiles apply per `--platform` flag, so this is
additive, not a rewrite:

1. First iOS build: `eas build --platform ios --profile production` — EAS
   will prompt to either let it auto-manage credentials (recommended,
   mirrors how Android's signing already works) or supply your own
   distribution certificate/provisioning profile. Choose auto-managed
   unless you have a specific reason not to.
2. Add an `ios` block to `eas.json`'s `submit.production` section (mirrors
   the existing `android` block) once ready to automate `eas submit
   --platform ios`. Needs the second API key from Phase 0 step 6.
3. `app.json`'s `ios` block (lines 10-17) already has the required
   `NSMicrophoneUsageDescription`, `NSCameraUsageDescription`,
   `NSPhotoLibraryUsageDescription` usage strings — Apple requires these
   for any permission StudyMind requests; confirm the wording still
   accurately describes what the app does before submitting (Apple review
   checks that these match actual app behavior).

---

## Phase 4 — TestFlight internal testing

Do this before any public submission — same purpose as the Android internal
testing track already used.

1. Upload the Phase 3 build to TestFlight via `eas submit` or manually.
2. Add yourself (and any other testers) under App Store Connect → TestFlight
   → Internal Testing.
3. Run the full purchase + restore flow against Apple's **sandbox**
   environment (TestFlight builds use sandbox IAP automatically) — this is
   the first real end-to-end test of Phase 1's server code against actual
   Apple infrastructure, not just unit-level correctness.
4. Confirm entitlements update correctly client-side after a sandbox
   purchase (same class of bug as the Android `BillingContext` staleness
   fix from `a7f4eb2` — worth deliberately checking this doesn't regress
   for iOS).

---

## Phase 5 — App Store submission & review

1. Complete remaining App Store Connect listing requirResources: screenshots
   (iPhone required; iPad required too since `supportsTablet: true` is set
   in `app.json:11`), promotional text, description, keywords.
2. Submit for review via App Store Connect (or `eas submit` if already
   scripted in Phase 3).
3. Apple's review is **manual**, typically 24-48h but can run longer —
   unlike Play Store's largely automated review. Budget for at least one
   rejection-and-resubmit cycle; common first-time subscription-app
   rejection reasons worth pre-checking:
   - Guideline 3.1.2: subscription terms (price, duration, auto-renewal)
     must be clearly shown to the user *before* purchase, not just in a
     ToS link.
   - "Restore Purchases" must be present and functional (already true here
     — reuses the same button verified working on Android).
   - No mention of external payment methods anywhere in the app or its
     metadata (StudyMind is IAP-only, so this should already be clean).

---

## Explicit non-goals for this plan

- Stripe/`studymind-web` — untouched, stays exactly as configured.
- Android — no file listed above requires an Android-side change; if a
  future session finds itself editing `androidPurchaseValidator.ts` or the
  `android` key in `eas.json`/`app.json` while working this plan, that's a
  sign of scope creep — stop and reconsider.

## Resuming this plan in a future session

Point Claude at this file directly: "read
`C:\WebAutomation\projects\studybrain\APPLE_LAUNCH_PLAN.md` and continue
Apple launch work." Start with Phase 0 if it isn't done yet — everything
else is blocked on it, especially the Phase 0 step 5 credentials (`.p8`
key, Key ID, Issuer ID), which Phase 1 cannot start without.
