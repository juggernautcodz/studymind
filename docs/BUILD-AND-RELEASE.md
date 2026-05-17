# Build & Release — StudyMind Android

## Prerequisites

| Tool | Install |
|------|---------|
| Node.js 18+ | Already in this project |
| EAS CLI | `npm install -g eas-cli` |
| Expo account | `eas login` |

## One-time setup

```bash
# 1. Install EAS CLI globally
npm install -g eas-cli

# 2. Log in to your Expo account
eas login

# 3. Link this project (creates the project on expo.dev)
eas init --id <your-project-id>
#    Then put the returned project ID in app.json → expo.extra.eas.projectId
```

## Environment variables

Before building, set `EXPO_PUBLIC_API_URL` in `eas.json` → `build.production.env`:

```jsonc
// eas.json
"production": {
  "env": {
    "EXPO_PUBLIC_API_URL": "https://your-production-api.com"
  }
}
```

The app uses this at runtime to reach your Express backend. If it is missing in a release build, all API requests will fail with a console error.

## Build commands

### Preview APK (internal testing)

```bash
eas build --platform android --profile preview
```

Produces a `.apk` you can side-load on any device or share via a link.

### Production AAB (Google Play)

```bash
eas build --platform android --profile production
```

Produces a signed `.aab` (Android App Bundle) ready for Google Play Console upload.

### Submit to Google Play (optional — auto-upload)

```bash
# Requires a Google Cloud service account JSON key
# See: https://docs.expo.dev/submit/android/
eas submit --platform android --profile production
```

## Version bumping

- **`version`** (user-visible, e.g. `"1.0.0"`) — update in `app.json` → `expo.version`
- **`versionCode`** (Play Store integer) — set in `app.json` → `expo.android.versionCode`
  - The `production` profile has `"autoIncrement": true`, so EAS increments `versionCode` automatically on each build.
  - You still need to bump `version` manually for each visible release (1.0.0 → 1.1.0, etc.).

## Build profiles summary

| Profile | Output | Distribution | Use case |
|---------|--------|-------------|----------|
| `development` | APK | Internal | Dev builds with Expo dev client |
| `preview` | APK | Internal | QA / stakeholder testing |
| `production` | AAB | Play Store | Google Play release |

## Dev-mode safety

The following are **automatically disabled** in production/release builds:

| Feature | Guard |
|---------|-------|
| Dev Mode (PRO) toggle in Settings | Hidden when `__DEV__` is false |
| TEST_RECEIPT / TEST_TOKEN billing stubs | Rejected when `NODE_ENV=production` |
| Verbose API URL fallback to localhost | Only in `__DEV__`; release logs an error and returns empty string |

## Billing verify idempotency

`POST /api/billing/verify` is **idempotent**. If the client retries the same purchase (e.g. due to a network timeout), the server uses `upsert` keyed on `purchaseTokenOrTransactionId` (unique constraint in the Purchase table). A duplicate token simply updates the `verifiedAt` timestamp on the existing row — no duplicate purchases are created. Entitlements and subscription status are also upserted by `userId`, so retries always converge to the correct state.

## Google Play Console checklist

Before submitting to the Play Store, ensure:

- [ ] `EXPO_PUBLIC_API_URL` set to production server URL in `eas.json`
- [ ] `EXPO_PUBLIC_PRIVACY_POLICY_URL` env var points to your hosted privacy policy
- [ ] `expo.extra.eas.projectId` in `app.json` is set to your real project ID
- [ ] Privacy policy hosted and accessible at the URL above
- [ ] Data safety form completed in Play Console (Audio, Camera, Contacts declared)
- [ ] Content rating questionnaire completed
- [ ] App icon and screenshots uploaded to store listing
- [ ] `google-service-account.json` present (only needed for `eas submit`)
