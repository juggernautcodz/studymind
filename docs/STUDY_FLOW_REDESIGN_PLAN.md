# StudyMind — Study Flow & Professionalism Redesign Plan

**Status:** Planning only. Nothing in this document has been implemented.
**Date:** 2026-09-07

This plan covers three things raised in review: (1) monthly usage tracking
appears broken, (2) the home screen's "Time to Study!" flashcard flow is
confusing, (3) a general pass to make the study flow better and the app feel
more professional, informed by competitor research (Anki, Quizlet, Google
NotebookLM, Brainscape, StudySmarter).

---

## 1. Confirmed bugs (found in code, not guesses)

### 1a. Monthly usage tracking has a real race condition — likely root cause of "doesn't work"

There are **two separate, conflicting implementations** of usage
incrementing:

- `server/billing.ts` → `incrementUsage()` — uses an atomic Prisma `upsert`
  keyed on the `@@unique([userId, monthKey])` constraint on the `Usage`
  table. **This is the correct pattern. It is never called anywhere in the
  codebase — dead code.**
- `server/middleware.ts` → `incrementUsage()` — the version actually used in
  production (imported by `server/ai-providers.ts` after every transcription
  completes, lines 390/395/478-479). This one does `findFirst` → then a
  separate `create` or `update` call. That is a check-then-act pattern, not
  atomic.

**The bug:** if two transcription jobs for the same user finish close
together in the same month (e.g. two lectures recorded back-to-back, or a
retry), both requests can run `findFirst`, both see no existing row, and
both call `create()`. The `@@unique([userId, monthKey])` constraint means
the second `create()` throws a Prisma P2002 error — which is silently
swallowed by a bare `catch (error) { console.error(...) }`. **That entire
usage increment is dropped with no retry and no user-facing error.**
Effect: displayed usage under-counts real usage, inconsistently, in a way
that's invisible until someone compares it against what they actually did
— exactly the "doesn't feel right" experience being reported.

**Fix (plan only):**
- Replace `middleware.ts`'s `incrementUsage` body with the same atomic
  `upsert` pattern already correctly written in `billing.ts`.
- Delete the dead, unused `billing.ts` version once merged in (or keep one
  canonical implementation and have the other import it — don't maintain
  two copies of the same logic in two files, which is how this drifted in
  the first place).
- Add a regression test: fire two concurrent `incrementUsage` calls for the
  same user/month, assert the final `transcriptionMinutesUsed` reflects
  both amounts (this is exactly the kind of bug that reappears silently
  without a test).

### 1b. "Time to Study!" is misleading — confirmed, not just a feeling

`DashboardScreen.tsx`'s `getNextAction()`:
```
if (totalFlashcardCount > 0) {
  title: "Time to Study!",
  subtitle: `${totalFlashcardCount} flashcards ready`,
  onPress: () => navigation.navigate("StudyToday"),
}
```
`totalFlashcardCount` is just **every flashcard that has ever been
created**, with no concept of due/overdue/already-mastered. `StudyToday`
then shuffles literally all of them at random. A card you correctly
answered five times already looks exactly as "ready" as one you've never
seen. The word "ready" implies a real due-for-review queue exists —
it doesn't, for the free flow.

**The frustrating part:** a real spaced-repetition engine already exists
in this codebase and is just not used here. `prisma/schema.prisma`'s
`FlashcardStat` model has `easeFactor`, `interval`, `nextReview`,
`lastReviewed` — full SM-2 fields — and `server/adaptive.ts` already has a
working `GET` endpoint that queries `nextReview: { lte: now }` (real due
cards) and a `POST` endpoint that updates the SM-2 stats after a review.
This is currently gated behind the PRO-only "Adaptive Review" feature
(`hasAdaptiveReview` in `entitlements.ts`) and the free "Time to Study"
path never touches it at all.

**Fix (plan only):**
- Home screen's next-action card should query actual due cards (via the
  existing `adaptive.ts` due-cards endpoint), not a raw count of all
  flashcards ever made.
- Rename/reword based on real state: "3 cards due for review" (due today),
  vs. "You're all caught up" (nothing due) — never a static "Time to
  Study!" that fires regardless of whether anything is actually due.
- Decide deliberately whether basic due-date scheduling (not the full
  adaptive-difficulty algorithm) should be a free-tier baseline, with
  "Adaptive Review" (PRO) layering smarter interval tuning on top — see
  competitor section below on why this matters commercially, not just
  functionally.

---

## 2. Competitor research — what the market actually does

| App | What it does well | What StudyMind is currently missing vs. it |
|---|---|---|
| **Anki** | Real due-card queue (SM-2, moving to FSRS in 2026 — mathematically tuned review timing). Gold standard for "what should I study right now." | StudyMind has the backend for this (`adaptive.ts`) but doesn't expose it outside a paywalled feature nobody's using by default. |
| **Quizlet** | Simple, low-friction UI. **Note:** Quizlet actually dropped true spaced repetition in 2020 — its free tier is closer to StudyMind's current "shuffle everything" than people assume. Streaks track *habit*, not mastery. | Confirms shuffle-based study isn't "good enough" even by Quizlet's own admission — it's considered a step down from real SR, not a baseline to match. |
| **Google NotebookLM** | Closest direct competitor — same core loop (upload/record source → auto-generate flashcards & quizzes grounded in that source). 2026 update added persistent progress/mastery tracking, shuffle/delete controls, and an "explain why you got this wrong" drill-down with citations back to source material. | StudyMind has no mastery tracking visible to the user, and no "explain this" drill-down linking a wrong quiz answer back to the original note/recording. |
| **StudySmarter** | Combines notes + flashcards + quizzes + a planner in one place; generates cards from lecture material (same as StudyMind); planner shows how much of each subject is "mastered." | This is the model closest to what StudyMind is trying to be — and it has the unified library/progress view StudyMind lacks. |
| **Brainscape** | Polished spaced repetition + reminders + streaks, positioned as "Anki without the setup pain." | Reinforces: reminders + due-based study + visible progress is the expected default in this category now, not a premium add-on. |

**Bottom line from research:** every serious competitor in this space has
converged on the same three things — (1) a real due/mastery-based study
queue as the *default*, not shuffle, (2) a visible progress/mastery signal
per subject, (3) a unified library view across all material. StudyMind
currently has none of these as the default experience, even though two of
the three (due-cards engine, and the raw data for a library view) already
exist in the backend/schema and just aren't surfaced.

---

## 3. Structural gaps already found (from earlier review, restated here for one combined plan)

- **Mind Map "subtopics" are fake.** They're just a label in a tree
  diagram (`MindmapNode`, `nodeType: "concept"`) with no notes/flashcards/
  quiz attached — a dead end, disconnected from the real content model
  (`Topic`). Needs to either become real (creatable as an actual sub-Topic)
  or be renamed so it stops implying it's the same thing as a Topic.
- **No cross-topic library view.** The only ways to see material across
  topics are Study Today (flashcards only, shuffled) and Search (keyword
  query, not browse). Every competitor above has a browse/library view;
  StudyMind doesn't.
- **Four-level navigation depth** (Semester → Course → Topic → tab) is
  heavier than how most people will actually use a note-taking/study app
  casually.
- **No progress/mastery visibility anywhere** — not per topic, not per
  course, not overall. Every competitor treats this as core, not optional.

---

## 4. Proposed redesign (in priority order)

### Priority 1 — Fix the two confirmed bugs
1. Atomic usage increment (§1a) — data-integrity bug, should not wait on
   anything else.
2. Home screen next-action card driven by real due-cards data instead of
   a raw flashcard count (§1b) — this alone fixes most of the "confusing"
   feeling, independent of any bigger redesign.

### Priority 2 — Make the existing adaptive engine the default, not a hidden PRO feature
- Ship **basic due-date scheduling** (SM-2 via the existing `adaptive.ts`
  endpoints) as the free-tier default study queue. This is table stakes
  per every competitor above — Quizlet is the cautionary tale here, not
  the model to match.
- Reframe **PRO's "Adaptive Review"** around something clearly *more* than
  baseline due-dates — e.g. cross-topic weak-area detection, exam-mode
  integration, or FSRS-tier algorithm tuning — so PRO still has a real
  differentiator once basic scheduling is free. (This needs a product
  decision, not just an engineering change — flagging it, not deciding it
  here.)
- Update Home screen copy to reflect real state: due count, "all caught
  up" state, and a light nudge if nothing has been reviewed in N days
  (every competitor above uses some version of this).

### Priority 3 — Add the Library view
- New cross-topic browse screen: filter chips (All / Notes / Flashcards /
  Quizzes), newest-first, each item tagged with its course/topic.
- This is the single most-requested-shape feature across every competitor
  reviewed (StudySmarter and NotebookLM both center on this).

### Priority 4 — Progress/mastery visibility
- Per-topic and per-course mastery indicator, computed from
  `FlashcardStat`/quiz attempt history that already exists in the schema —
  this is largely a *display* problem, not a new data problem, since the
  underlying stats are already being recorded for the PRO adaptive engine.
- Dashboard-level weekly activity view (replacing/augmenting the current
  single "next action" card) — matches Brainscape/StudySmarter's model of
  making progress visible, not just the next task.

### Priority 5 — Mind Map decision
- Product decision needed: make Mind Map subtopics real (creatable as
  actual Topics with content), or rename/reframe them as outline-only so
  they stop implying equivalence with real Topics. Either is fine; leaving
  it as-is (two different things both called "subtopic") is not.

### Priority 6 — Navigation/polish pass
- "Recent" section on Dashboard (last N topics touched) to reduce
  four-level drilling for the common case of "get back to what I was just
  doing."
- General copy pass once the above logic changes land — a lot of current
  copy (like "Time to Study!") was written for a simpler shuffle model and
  will read oddly once real due-state logic exists underneath it.

---

## 5. What this plan deliberately does not decide

- Whether basic spaced repetition becomes free-tier (Priority 2) is a
  pricing/positioning call, not just an engineering one — flagged for a
  decision, not decided here.
- Exact visual design of the Library view and progress indicators — needs
  a design pass once the direction is approved.
- Whether Mind Map becomes "real" or "renamed" — needs a product decision.

## 6. Suggested execution order

1. Usage-tracking atomic fix (isolated, low-risk, high-integrity value)
2. Home screen due-cards wiring (uses infra that already exists)
3. Library view (new screen, additive, low regression risk)
4. Progress/mastery display (additive, uses existing stats data)
5. Mind Map decision + navigation/copy polish (last — cosmetic/structural,
   benefits from the above being settled first)
