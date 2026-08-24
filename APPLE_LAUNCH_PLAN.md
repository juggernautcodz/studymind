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
- iOS: `com.studymind.app` bundle ID reserved in `app.json`, but no Apple
  Developer account work has started. `server/billing/iosReceiptValidator.ts`
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

Nothing below can start until this is done. Budget a few days of slack —
Apple's review/enrollment steps aren't instant.

1. Enroll in the **Apple Developer Program** ($99/year) at
   developer.apple.com if not already enrolled. Can take up to 48h for
   Apple to approve.
2. In **App Store Connect** (appstoreconnect.apple.com), create a new app:
   - Bundle ID: `com.studymind.app` (already set in `app.json:12` — must
     match exactly)
   - Name: StudyMind (confirm availability — App Store names are globally
     unique, unlike Play Store)
3. Fill out required App Store Connect metadata (can be draft/incomplete
   until submission time, but start early since some of it takes research):
   - Support URL, marketing URL (optional), privacy policy URL
   - App Privacy questionnaire ("nutrition label" — what data StudyMind
     collects: account email, audio recordings, usage analytics if any)
   - Age rating questionnaire
4. Create 4 In-App Purchase products, matching what's already live on
   Android exactly (same tiers, same effective price points):
   - `com.studymind.plus.monthly`
   - `com.studymind.plus.yearly`
   - `com.studymind.pro.monthly`
   - `com.studymind.pro.yearly`
   - (Skip recreating the retired lifetime SKU — no new purchasers, only
     legacy Android holders restore it.)
5. Generate an **App Store Server API key**: App Store Connect → Users and
   Access → Integrations tab → In-App Purchase (or "App Store Server API"
   depending on current Apple UI naming). Download the `.p8` private key
   file — **Apple only lets you download this once**, save it somewhere
   durable immediately (password manager or encrypted storage, never
   committed to git). Note the **Key ID** and **Issuer ID** shown alongside
   it — you'll need all three for Phase 2.
6. Separately, for automated `eas submit`: either let EAS manage an App
   Store Connect API key itself (it'll prompt during `eas submit --platform
   ios` and can generate/store one), or generate a second, separate App
   Store Connect API key with **App Manager** role for that purpose. This
   is a *different* key from Phase 0.5's App Store Server API key even
   though both live under "API Keys" in Apple's UI — one is for server-side
   receipt verification, the other is for CI/CLI app submission. Easy to
   conflate; keep them labeled clearly when you download them.

**Deliverable to bring back to a future session:** the `.p8` file (or its
contents), Key ID, and Issuer ID from step 5.

---

## Phase 1 — Server: real iOS receipt validation (code, needs Phase 0 step 5)

File: `server/billing/iosReceiptValidator.ts`. The commented skeleton
already in the file (lines 113-134) is the correct approach — Apple's
official `@apple/app-store-server-library` npm package, not the deprecated
`verifyReceipt` HTTP endpoint.

1. `npm install @apple/app-store-server-library`
2. Add 3 new env vars (names TBD at implementation time, e.g.
   `APPLE_IAP_SIGNING_KEY`, `APPLE_IAP_KEY_ID`, `APPLE_IAP_ISSUER_ID`) —
   store the `.p8` contents as a secret, not a file path, matching how
   `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` is handled as an inline env var
   rather than a checked-in file.
3. Implement `verifyIosReceipt()`'s production branch: construct an
   `AppStoreServerAPIClient`, call `getTransactionInfo()`/
   `getTransactionHistory()`, decode the signed transaction, map Apple's
   `productId` → plan via the existing `TEST_PRODUCTS` table (lines 31-63
   already have the right product-ID-to-plan mapping — reuse it, don't
   duplicate), and return the same `IosReceiptValidationResult` shape the
   stub already returns so nothing downstream (`billing.ts` verify route)
   needs to change.
4. Fail closed like every other secret in this codebase (`SESSION_SECRET`,
   `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`, `INTERNAL_API_SECRET` all throw at
   startup in production if unset) — same pattern here for the 3 new
   Apple env vars.
5. Sandbox testing: Apple's sandbox environment uses different receipts
   than production. `AppStoreServerAPIClient` takes an `Environment.Sandbox`
   vs `Environment.Production` flag — the existing `allowTestReceipts`
   dev-only branch (line 69) can likely stay as-is for local dev; sandbox
   becomes relevant once real TestFlight builds are being tested (Phase 4).

**Verify:** `tsc --noEmit` clean, `server:build` (esbuild) succeeds. No
runtime iOS device needed yet for this phase — that's Phase 4.

---

## Phase 2 — Client: confirm iOS purchase flow correctness

Already partially done in commit `a7f4eb2` (`BillingScreen.tsx` now derives
platform from `Platform.OS` instead of hardcoding `"android"` — this was
finding #17 from the original audit). Re-verify this is still correct once
Phase 1 lands, since the server side it talks to is changing:

1. Confirm `react-native-iap`'s iOS purchase listener path (separate from
   the Android path already tested) sends the receipt in whatever shape
   `verifyIosReceipt()` now expects (StoreKit 2 transaction JWS vs. legacy
   base64 receipt — depends on what `@apple/app-store-server-library`
   wants as input, confirm during Phase 1 implementation).
2. `BillingContext.tsx:202`'s existing platform-aware verify call should
   need zero changes if Phase 1 preserves the same request/response shape
   — but re-check once Phase 1's exact request contract is implemented.

**No Android code touched in this phase** — `BillingScreen.tsx`/
`BillingContext.tsx` are shared files, but the Android branch of the
`Platform.OS` checks stays untouched; only the iOS branch changes.

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
