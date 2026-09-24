# StudyMind — Handoff for Codex / ChatGPT

**Written:** 2026-09-24
**Repo:** `C:\WebAutomation\projects\studybrain` (GitHub: `github.com/juggernautcodz/studymind`)
**Current branch:** `studymind-2.0` (8 commits ahead of `master`, NOT yet merged — see "Branch state" below)
**Stack:** Expo/React Native client + Express server, Prisma ORM → Postgres (Neon), deployed on Replit Autoscale. Native IAP billing (Google Play + Apple App Store), no Stripe in the mobile app.

This doc exists so a different AI/tool (you) can pick this project up without re-discovering context that already cost real debugging time. Read this fully before touching code. Where a claim might be stale, it says so — verify against current code, don't trust this blindly either.

---

## 0. How to orient fast

1. Run `git log --oneline -30` to see exactly where HEAD is — this doc will drift out of date, git won't.
2. Read `docs/SYSTEM_ARCHITECTURE.md` for the actual code map.
3. Read `docs/STUDY_FLOW_REDESIGN_PLAN.md` for the product/competitive plan (StudySmarter/NotebookLM comparison, what's decided vs. open).
4. Read `APPLE_LAUNCH_PLAN.md` for the iOS launch sequence, phase-by-phase.
5. Read `docs/BUILD-AND-RELEASE.md` and `docs/IAP-BILLING-README.md` for build/release mechanics.
6. This file (`HANDOFF_FOR_CODEX.md`) is the narrative glue between all of the above — what broke, why, and what's still open, in plain language.

---

## 1. Branch state — READ THIS FIRST

Current work is on `studymind-2.0`, which is `master` (equivalent to `origin/master`) plus **8 unmerged commits** made 2026-09-24 (today), diverging at `1200a0c`:

```
cf02b6c fix: remove automatic production database schema mutation
aa66cfc chore: add initial Prisma baseline migration
c7b85f6 fix: harden study resource ownership
cfda15f fix: harden exam resource ownership
b2f0e28 fix: harden adaptive flashcard ownership
30bd70a fix: harden quiz submission ownership
6bbe838 fix: harden AI persistence ownership
eb83b14 fix: harden transcription job ownership
```

These are **not yet on `master`/`origin`**. Don't assume production is running this code — confirm what Replit's deployed workspace actually has (see §4, the Replit deploy gotcha) before treating these fixes as live.

---

## 2. What's actually broken and fixed — chronological, with root causes

### 2.1 Security audit (Phases 1-6, commits `89e79ea` / `abaf59c` / `e7d6638` / `a7f4eb2` / `dd50572`, completed before 2026-08-24)
Full server/client security & correctness audit predates this doc's window. Referenced by `APPLE_LAUNCH_PLAN.md` as the baseline everything else builds on. If you need the details, `git show` those hashes — not re-summarized here.

### 2.2 Production database was ephemeral SQLite (fixed 2026-09-03)
- **Symptom:** users had to sign up again every time they reopened the app after a while.
- **Root cause:** `server/db.ts` pointed at a local SQLite file. The app deploys to Replit **Autoscale**, which is stateless — local filesystem writes don't survive instance restarts. Deployment logs showed `SQLite database prod.db created` (not "opened") on repeated deploys — every account was being wiped on every restart.
- **Fix:** switched `prisma/schema.prisma` to `provider = "postgresql"`, swapped the Prisma adapter to `@prisma/adapter-pg`, fixed `prisma.config.js` (it previously *rejected* Postgres URLs), pointed at Replit's already-provisioned Neon Postgres (`DATABASE_URL` secret existed, unused). Confirmed live 2026-09-03 — deploy log showed a clean `neondb` connection, real sign-in tested successfully in production.
- **Gotcha hit during this fix:** a leftover `SQLITE_DATABASE_URL` in `.replit` and a stale `prisma.config.js.backup` caused one redeploy to silently fall back to SQLite again after the "fix" looked done. Both removed.
- **Still open as of today:** long-idle-restart persistence was never independently re-verified beyond the initial test.

### 2.3 "Committed" ≠ "deployed" on this project (discovered 2026-09-03, still true)
**This is the single most expensive gotcha on this project — read it before assuming any push went live.**
Replit's Repl has its **own separate git history** (`main` branch, full of auto-generated "Published your App" checkpoint commits from Replit's own Publish button), and that workspace — not this local clone, not GitHub — is what Replit actually deploys. `git push origin master` from this machine only updates GitHub. It does **not** reach the Repl.

Correct deploy path:
1. `git push origin master` (or whatever branch tracks `origin`) from local.
2. Open the Repl in browser → its own **Shell** tab (separate terminal from anything local) → `git merge origin/master -m "..."` (merges GitHub's `master` into the Repl's `main` — plain merge, not rebase, to preserve Replit's own publish checkpoints).
3. *Then* trigger the Replit redeploy.
4. Verify via deployment logs afterward — don't assume a redeploy picked up changes just because they were pushed.

**Known credential gap:** this local machine could not push to `github.com/juggernautcodz/studymind` at one point (password auth rejected, no PAT configured) — some fixes had to be applied directly in the Replit Shell instead of flowing machine → GitHub → Repl. Check whether this is still true before assuming a normal push/merge workflow works end-to-end.

### 2.4 Guest mode shared one global account across every device (fixed, shipped, verified live 2026-09-06)
- **Root cause:** `server/constants.ts`'s `ANONYMOUS_USER_ID` was a single hardcoded ID, and `guestOrAuthMiddleware` mapped *every* guest session, from every device, to that exact same account — a real privacy bug, not per-device local identity. Anyone using "Continue as Guest" could see/modify/delete anything any other guest-mode user anywhere had created.
- **Fix:** removed the "Continue as Guest" entry point entirely (`LoginScreen.tsx`, `AuthContext.tsx`). Left the server-side middleware fallback alone (it also handles expired/invalid-token error fallback, needs its own careful pass if ever touched).
- **Status:** shipped as versionCode 20-23, confirmed by Shane live on Android **Production** track 2026-09-06. Closed.

### 2.5 On-device local storage had no per-user scoping (fixed, shipped, verified live 2026-09-06)
- **Symptom:** brand-new signups on a device that had prior accounts saw old accounts' study material.
- **Root cause:** `client/lib/storage.ts` stored all study content (semesters/courses/topics/flashcards/quizzes/notes) under fixed AsyncStorage keys with zero per-user namespacing. `AuthContext.tsx` cleared the React Query cache and auth tokens on login/logout but never touched content keys.
- **First attempt (versionCode 21, superseded):** blanket `storage.clearAll()` on every login/signup/logout — stopped the leak but also wiped the *same* account's own data on every re-login. Shane hit this immediately.
- **Real fix (versionCode 23):** namespaced every content key by active user id (`${userId}:${key}`) via `setActiveUser()`/`scopeKey()`. Logout now detaches the namespace instead of deleting data.
- **Related bug fixed in the same pass:** duplicate "My Studies"/"General" topic creation — several entry points (camera/gallery/upload/clipboard/record) each checked stale React state instead of fresh storage reads before deciding whether a default setup existed, so concurrent calls each created their own duplicate. Fixed with fresh-storage reads + an in-flight-promise guard.
- **Status:** versionCode 23 confirmed live on Android Production 2026-09-06. Closed for Android.
- **Still open:** iOS TestFlight build at the time (build 3, commit `25e4e039`) predated all three fixes (commit `04f3f34`). Confirm current iOS build includes this before shipping further — check `git log` for whether a fresh iOS build has been cut since.

### 2.6 Cross-device hydration gap (fixed 2026-09-06, commit `c9d1035` — **on-device verification status unclear, check before trusting**)
- **Symptom:** logging into the *same* account on a second device (or after reinstall) created a duplicate default "My Studies" setup instead of pulling down existing data.
- **Root cause:** `client/lib/storage.ts` is local-first and only ever *pushes* to the server (`serverSync.ts`, fire-and-forget POSTs) — there was no pull/GET path. A fresh device with empty local storage would see zero semesters and create its own duplicate default, which then got pushed as an *additional* server record rather than merged.
- **Fix:** added `storage.hasContent()` / `storage.hydrateFromServer()` / `serverSync.hydrateFromServerIfEmpty()` — pulls existing data from the server if and only if local storage is empty, before the dashboard can mount and run its default-setup logic.
- **This bug affects Android too**, not just iOS — same architecture gap, just discovered via an iPad test. As of the last update on this, it had **not yet been shipped to an Android build** and Shane had not confirmed timing. **Check current state before assuming this is deployed anywhere.**
- Pre-existing duplicate data created before this fix is not retroactively cleaned up — that needs manual in-app cleanup per affected account.

### 2.7 Monthly usage counter silently dropped increments under load (fixed 2026-09-07, commit `1651466`)
- **Root cause:** two divergent implementations of `incrementUsage` existed for the same `Usage` table. `server/billing.ts`'s version was correct (atomic Prisma `upsert` on `@@unique([userId, monthKey])`) but was **dead code, never called**. `server/middleware.ts`'s version — the one actually wired into `server/ai-providers.ts` after every transcription — used `findFirst` then separate `create`/`update`, a check-then-act race. Two transcriptions finishing close together (a normal pattern, not an edge case) could both miss the existing row, both try `create()`, and the second would hit a Prisma P2002 unique-constraint error that was silently swallowed by a bare `catch`. That usage increment was just dropped.
- **Fix:** `middleware.ts` now delegates to `billing.ts`'s atomic upsert.
- **Pattern worth re-checking generally:** this repo has had at least 3 instances of "two implementations exist, the correct one is dead code, the wrong one is live" (this bug, `scheduleDueCardsNotification`, and the client paywall — see §2.9). Grep for duplicate function names before assuming a fix is unique.
- No automated test exists for this — there is no `server/**/*.test.ts` test harness in this repo at all as of this writing.

### 2.8 "Time to Study!" home card was misleading / StudyToday never persisted results (fixed 2026-09-07, commit `419bc3c`)
- Made basic due-date scheduling free-tier (removed the `hasAdaptiveReview` PRO gate on `GET /api/adaptive/study-today`) — a deliberate product call justified by competitor research (see §3). `DashboardScreen.tsx` now shows a real due count. `StudyTodayScreen.tsx` now actually POSTs answers to `/api/adaptive/flashcards/:id/answer` so due dates advance — previously nothing was ever persisted from that screen.
- **Still open:** StudyToday still shuffles *all* cards rather than prioritizing due ones first. PRO's "Adaptive Review" marketing copy hasn't been repositioned now that basic due-tracking is free.

### 2.9 MAJOR: the entire client-side paywall was dead code (found + partially fixed 2026-09-08)
- **Finding:** `usePaywall()`/`requireFeature()` in `BillingContext.tsx` had **zero call sites anywhere in the app**. Every FREE user had full unrestricted access to quizzes, Mind Map, and Exam Mode — everything the entitlements system and App Store listing describe as PRO-exclusive. The only limits actually enforced anywhere were recording count and transcription minutes/month.
- **Fixed:** Exam Mode gating actually wired up and enforced (commit `04c339c`).
- **Deliberately left free:** quizzes and Mind Map — gating those would hurt the "beat NotebookLM's free tier" competitive goal (see §3).
- **Punted to Shane, not fixed:** `hasExport`/PDF-export gating — the actual implementation is the app's general-purpose Share button used everywhere (flashcards, notes, exam results, Writing Lab), not an isolated premium feature. Gating all of it as-is would make free tier feel stingy. If this should be gated, it needs to be split into "quick share" (free) vs. a distinct "Export as PDF" action first — not built yet.

### 2.10 Product/UX pass — StudyMind vs. StudySmarter/NotebookLM (commits `0df9659`, `f494488`, `eae1000`, `ab7d5d5`, `72e3407`, `adc72b3`, all 2026-09-07/08)
Series of shipped fixes from the redesign plan (full detail in `docs/STUDY_FLOW_REDESIGN_PLAN.md`):
- New cross-topic Library view (`client/screens/LibraryScreen.tsx`).
- Mastery/progress surfaced on `CourseScreen` and `DashboardScreen` from existing quiz-attempt history (no new data model).
- Mind Map "subtopics" renamed to "Concepts" with an inline notice that they're outline-only (no notes/flashcards/quiz attach) — chosen over building real-Topic conversion, since nobody had asked for that feature.
- "Recent Topics" now ranks by actual last-opened time, not creation order.
- Citation-linked flashcards: each AI-generated flashcard now carries a verbatim `sourceQuote` — chosen over a rejected audio-timestamp-linked approach (that would have required reversing an existing in-app privacy promise, since audio is deleted right after transcription and Whisper runs without segment timestamps).
- Whiteboard photo capture merged directly into the recording-complete flow (previously required leaving the screen).
- **All 6 numbered priorities in the redesign plan doc are done as of 2026-09-07.** What's left there is the "Differentiation ideas" and "Open decisions" sections (not yet decided/built) and one flagged-but-unfixed item: a "Due cards reminder" notification toggle in Settings that does nothing (`scheduleDueCardsNotification` exists, fully implemented, never called from anywhere — no `AppState` foreground/background listener exists in the app to call it from correctly).

### 2.11 Android Play Store Production track was stuck 18 days on a stale build (fixed 2026-08-27)
- **Symptom:** real users were on versionCode 12 (pre-security-fix, released Aug 9) all the way until 2026-08-27, even though versionCodes 13-18 (including the security audit fixes) had been built and released to **Internal testing only**.
- **Root cause:** `eas.json`'s `submit.production.android.track` is `"internal"` (still true — see §5), and `google-service-account.json` didn't exist yet at the time, so every prior production release required a manual Play Console upload — and at some point that manual step landed on Internal testing instead of Production without anyone noticing.
- **Fix:** manually uploaded versionCode 19 directly to Play Console → Production (100% rollout, not staged, since it carried a security fix). Confirmed live 2026-08-27.
- **Standing lesson:** after any release, explicitly check the **Production** track in Play Console — not just Internal testing — before assuming a build is live. An earlier claim that IAP billing was "verified working in production" (2026-08-24) had actually only been verified against Internal testing.

### 2.12 Today's work (2026-09-24) — Prisma startup mutation removed + IDOR hardening pass
On the unmerged `studymind-2.0` branch (§1):
- **`cf02b6c` — removed automatic production database schema mutation.** `server/index.ts` used to run `npx prisma generate && npx prisma db push --accept-data-loss` on every server startup, and `scripts/build.cjs` ran `prisma db push --accept-data-loss` on every build. Both silently mutate the production schema (and can silently drop data — that's what `--accept-data-loss` means) on every deploy/restart, with no real migration history. Both removed.
- **`aa66cfc` — added an initial Prisma baseline migration** (`prisma/migrations/20260924000000_baseline/migration.sql`, 413 lines) so the project now has an actual migration history to move forward from instead of `db push` blind schema syncing. **This means the deploy process now needs `prisma migrate deploy` wired in somewhere it currently isn't — check `scripts/build.cjs` / `server/index.ts` / the Replit deploy config for this before shipping, or every future deploy will just silently not apply new migrations.**
- **6 "harden ownership" commits** (`c7b85f6` study, `cfda15f` exam, `b2f0e28` adaptive flashcard, `30bd70a` quiz submission, `6bbe838` AI persistence, `eb83b14` transcription job) — this is an IDOR (insecure direct object reference) fix pass. Pattern seen in `server/study.ts`: routes that took a client-supplied `id` for create/update were not verifying that the referenced parent resource (`semesterId` on a course, `courseId` on a topic) actually belonged to the requesting `userId` before writing to it. Fixed by adding `findFirst({ where: { id, userId } })` ownership checks before use, returning a generic "not found" (via new `server/lib/errors.ts` `notFound()` helper) rather than leaking existence of another user's resource. **This is a real cross-account data-access vulnerability class, not a style fix** — treat it as security-sensitive when reviewing/testing, and check whether the same pattern exists anywhere it wasn't yet touched (routes not in this list: billing, auth, search, sync).
- Also: `app.json` build numbers were reset/preserved (iOS `buildNumber` 6→8, Android `versionCode` 21→23) to match what's actually been shipped historically, and `docs/STUDY_FLOW_REDESIGN_PLAN.md` + a plan artifact HTML were checked into the repo (commit `1200a0c`) — this plan doc is the same one described in §2.10/§3, now version-controlled instead of living only in chat history.

---

## 3. Standing product goal — read before making any feature/scope decision

Shane's own words, stated as a hard requirement: **"my app needs to be better than the competition, no exceptions."** This isn't a one-off ask — treat it as the standing priority behind every other fix.

Full competitor research is in `docs/STUDY_FLOW_REDESIGN_PLAN.md`. Short version:
- **StudySmarter** — same price ($9.99/mo), beats StudyMind on visible mastery % and review-scheduling.
- **Google NotebookLM** — the dangerous one: same core loop (upload/record → auto-generate flashcards/quizzes), **free**, more generous free tier than StudyMind's (100 notebooks/50 sources/50 chats-a-day vs. StudyMind's 45 min transcription / 3 recordings lifetime), has real progress tracking and citation-linked drill-downs, backed by Google.
- **Quizlet** dropped true spaced repetition in 2020 — confirms StudyMind's old shuffle-only free flow was a regression, not an acceptable baseline (this justified making due-date scheduling free, §2.8).
- **Anki** — spaced-repetition gold standard but fully manual card creation; StudyMind's auto-generation-from-lectures is a real structural advantage over it.
- **Brainscape** ($19.99/mo, matches StudyMind Pro) — reinforces visible progress as expected-standard, not premium.

**Conclusion already reached:** StudyMind's *pricing* isn't the problem — it's at parity with StudySmarter/Brainscape. The problem was that it delivered *less* than StudySmarter/NotebookLM at the same price, because real due-based review and visible mastery were either broken or hidden behind a paywall nobody could even reach (§2.9). Several of those gaps are now closed; remaining differentiation ideas (not yet built) are in `docs/STUDY_FLOW_REDESIGN_PLAN.md`'s open-decisions section — notably whether the free tier is still too stingy next to NotebookLM's, which is flagged as unresolved and worth a decision before investing further in paid-tier features nobody sees.

---

## 4. Deploy topology — don't skip this

- **Server:** Express + Prisma, deployed to **Replit Autoscale** (stateless — no local filesystem persistence between instances/restarts). Production URL as of last check: `https://asset-manager-landrys424.replit.app` (legacy Repl slug from before a rename — title in-app confirms it's StudyMind; don't be thrown by the URL).
- **Database:** Neon Postgres (`neondb`), reached via `DATABASE_URL`. Was SQLite until 2026-09-03 (§2.2) — if you ever see "SQLite" in a deploy log again, that's a regression, stop and investigate immediately rather than proceeding.
- **Deploy mechanics:** GitHub push alone does **not** deploy — see §2.3, the most important gotcha in this doc.
- **Mobile builds:** EAS (`eas build`/`eas submit`), config in `eas.json`. `submit.production.android.track` is `"internal"` — **any Android production release still requires a manual promotion to the Production track in Play Console** (§2.11); don't assume `eas submit` alone reaches real users.
- **Android package:** `com.studymind.app`. **iOS bundle ID:** `com.shanethetester.studymind` (deliberately different — `com.studymind.app` was already claimed by an unrelated Apple Developer account; the two platforms don't need to match and nothing depends on them matching).
- **Current shipped version markers** (`app.json`, as of `1200a0c`): `version: "1.0.0"`, iOS `buildNumber: "8"`, Android `versionCode: 23`. Cross-check these against what's actually live in App Store Connect / Play Console before cutting the next build — don't trust `app.json` alone as ground truth for what users have.
- **Credentials that live outside this repo** (gitignored, ask Shane for values, do not attempt to regenerate blindly): `google-service-account.json` (Google Play service account — also used for IAP purchase verification, has "Release apps to testing tracks" + financial data permissions), Apple `.p8` App Store Server API key + Key ID + Issuer ID (`APPLE_IAP_SIGNING_KEY`/`APPLE_IAP_KEY_ID`/`APPLE_IAP_ISSUER_ID`/`APPLE_APP_ID=6806695446`).

---

## 5. Where things stand right now, per platform

### Android
- **Production:** live, versionCode 23, includes the guest-account fix, local-storage-scoping fix, and duplicate-topic fix (§2.4, §2.5). IDOR hardening (§2.12) is NOT yet on this build — it's unmerged on `studymind-2.0`.
- **Open:** cross-device hydration fix (§2.6) has not been confirmed shipped to Android — check before assuming it's live. Decide whether/when to cut a build once `studymind-2.0` is merged and includes it.
- **Standing gotcha:** always verify the **Production** track specifically in Play Console after any release — Internal testing success has been mistaken for Production success before (§2.11).

### iOS / Apple
- Full phase-by-phase plan: `APPLE_LAUNCH_PLAN.md`. Status per that doc (verify current phase before acting — this doc's own age is unknown relative to today):
  - **Phase 0 (App Store Connect setup):** done. Bundle ID `com.shanethetester.studymind`, app name "StudyMind — AI Study Assistant" (plain "StudyMind" was taken), 4 subscriptions under group `studymind_plans`, App Store Server API key generated.
  - **Phase 1 (server-side receipt validation):** done — real `@apple/app-store-server-library` implementation in `server/billing/iosReceiptValidator.ts`, Production-first/Sandbox-fallback.
  - **Phase 2 (client purchase flow fix):** done — fixed `BillingScreen.tsx` sending `purchase.transactionId` instead of an unusable `undefined`/JWS blob.
  - **Phase 3 (EAS build config):** done — fixed `eas.json`'s `prebuildCommand` being hardcoded to Android-only at the profile top level (would have silently skipped iOS prebuild).
  - **Phase 4 (TestFlight):** core flow verified on a borrowed iPhone (no Mac/iPhone owned in-house) — record button, notes, transcription, whiteboard capture all tested working. **Sandbox purchase + restore flow was NOT yet explicitly confirmed end-to-end** as of the plan doc's last update — this is the actual first real test of Apple receipt validation and hasn't happened yet as far as this doc's sources show.
  - **Phase 5 (App Store submission/review):** blocked behind Phase 4's purchase testing and finishing the App Store listing (screenshots for iPhone AND iPad since `supportsTablet: true`, promotional text, description, keywords). Not yet submitted for review as of last update.
- **Known bugs fixed during iOS testing:** record button silently failing (missing `setAudioModeAsync({allowsRecording:true})`, iOS-only requirement), toast overlapping the Dynamic Island, timer digits overlapping the waveform, React Query cache not clearing on account switch.
- **Open before Phase 5:** confirm the local-storage-scoping fix and cross-device hydration fix are both in the current iOS build (an earlier TestFlight build predated both — check `git log` against whatever build is currently in TestFlight before resubmitting for review).
- **A reviewer test account** (`applereview@studymind.test`) needs recreating post-Postgres-migration — anything created before the DB migration (§2.2) no longer exists.

---

## 6. Known gaps / non-goals to be aware of

- **No server-side test suite exists** (`server/**/*.test.ts` — none found). Bug fixes in this codebase have generally been verified via `tsc --noEmit`, `esbuild`, and manual/on-device testing, not automated tests. If you add tests, that's new infrastructure, not a regression fix.
- **`serverSync.ts`'s local-first-then-best-effort-push pattern** — any sync failure (network blip, server error) stays local-only indefinitely with just a `console.warn`, no retry/reconciliation. Not fixed, just known.
- **Dead "Due cards reminder" notification toggle** in Settings — fully implemented function, never called, no `AppState` listener exists to call it correctly. Flagged, not fixed.
- **Stripe (`studymind-web`)** is explicitly out of scope for all mobile/IAP work — don't touch it as a side effect of Android/iOS billing work.
- **Recurring pattern to watch for:** at least 3 separate instances found in this codebase of "two implementations of the same thing exist, the correct one is unused dead code, the wrong one is what's actually wired up" (usage tracking §2.7, the client paywall §2.9, the notification scheduler above). If a new bug looks similar, grep for a second implementation before assuming the visible one is the only one.

---

## 7. If you're picking this up fresh, in order

1. Confirm current `git log` / branch state against §1 — this doc may already be stale by the time you read it.
2. Check whether `studymind-2.0` has been merged to `master`/deployed yet. If not, and you're asked to ship the IDOR hardening (§2.12), remember: local commit ≠ deployed (§2.3), and the new Prisma migration needs a `migrate deploy` step wired into the actual deploy path before it does anything.
3. For Android: verify Play Console Production track version against `app.json`'s `versionCode` before assuming parity.
4. For iOS: read `APPLE_LAUNCH_PLAN.md` Phase 4 onward, confirm sandbox purchase/restore has now actually been tested, and check whether TestFlight's current build includes every client-side fix from §2.5/§2.6.
5. For product decisions: read `docs/STUDY_FLOW_REDESIGN_PLAN.md`'s open-decisions section before building anything new — several tradeoffs (free-tier generosity vs. NotebookLM, export gating, notification wiring) are explicitly Shane's calls to make, not something to decide unilaterally.
