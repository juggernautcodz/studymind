# StudyMind 2.0 Current Status

Branch: `studymind-2.0`

Starting HEAD for Phase 8: `73cdaec56fd60266dc44adb58610ac19db58cee4`

Current phase: Phase 8 — full regression audit performed; all HIGH findings are remediated, but unresolved MEDIUM findings make Phase 9 phone testing **NOT READY**

## Completed phases

1. Architecture Design
2. Course Brain
3. SourceLock
4. Lecture Autopilot
5. Mastery
6. Exam Readiness
7. Personalized Study Today

## Phase 8 full regression audit

Audit result: **NOT READY for Phase 9 phone testing**.

Confirmed safe areas:

- The Phase 1–7 canonical Course Brain, SourceLock, Lecture Autopilot, Mastery, Exam Readiness, and Study Today server queries enforce authenticated-user ownership through their direct records and joins.
- Course Brain, Exam Readiness, Study Today, and Mastery client/server response shapes align for IDs, enum values, optional fields, nullability, and error/status handling.
- The new concepts, mastery records/events, sources/provenance, exam scope/readiness, and Study Today recommendations remain PostgreSQL-backed or dynamically derived from PostgreSQL. No new Phase 1–7 durable domain is persisted only in AsyncStorage.
- The SourceLock, Mastery, quiz-submission-idempotency, and Exam Readiness migrations are additive and ordered consistently. Their foreign keys, indexes, uniqueness constraints, and delete cascades are ordered after their prerequisites.
- Production build/startup paths contain no schema mutation or `prisma db push` command. Prisma generation and the server bundle build do not apply migrations.
- Privacy export includes SourceLock history, concepts, mastery records/events, and exam concept scopes. Cascades cover the new Phase 1–7 records during owned course/topic/user deletion.

Remediated findings:

- **HIGH — account deletion could report success without deleting the account.** Phase 8A changed both `DELETE /api/auth/data` and `DELETE /api/auth/account` to require `authMiddleware`; missing, invalid, expired, and legacy guest tokens now return `401` and cannot fall back to the shared guest identity. The client now requires a stored token, propagates network/non-success responses, and clears local account/auth state only after the server confirms deletion. Settings therefore retains the signed-in state on failure and can show its existing retryable error message. Normal logout remains unchanged.
- **HIGH — Study Today actions did not complete durable study work.** Phase 8B marks Study Today navigation explicitly and hydrates only the selected owned topic activity from the authenticated server topic export so flashcard, quiz, and question IDs remain canonical. The Cards action now exposes correct/incorrect review controls after the answer is revealed and posts a stable event ID through the existing authenticated adaptive flashcard endpoint. The existing `recordFlashcardReview` transaction remains the authority for idempotency, due-date/ease/interval updates, `FlashcardStat`, Mastery events, and concept-mastery recomputation. A failed request stays on the card and is shown as unsaved. The Quiz action now submits canonical question-ID answers with a stable `submissionId` through the existing durable quiz-attempt path, displays the server score only after success, preserves answers for retry on failure, and invalidates Study Today, course Mastery, and Exam Readiness queries. The quiz submission route now requires `authMiddleware`, scopes quiz lookup through the authenticated user's topic and course, retains the existing upsert idempotency/conflict behavior, and runs the existing Phase 5 Mastery backfill. Optional callbacks preserve the existing passive Cards and local Quiz behavior for ordinary non-Study-Today Topic entry.
- **HIGH — server-backed Study Today topics could open empty device-local tabs.** Phase 8C extends the existing authenticated topic export with owned source-revision segments and scopes both the topic and its course to the authenticated user. Every Study Today action now hydrates the selected Notes, Cards, or Quiz destination from canonical server data before rendering, including Prisma `front`/`back` flashcards and source-backed notes. Successful hydration fills only missing user-namespaced cache categories, so existing local or pending Notes, Cards, and Quiz edits are not overwritten. A network/service failure may use an existing destination-specific cache with a warning; authentication and ownership failures never fall back to cache. A fresh-device cache miss now shows a retryable loading/error state instead of an empty success state. Ordinary non-Study-Today Topic entry remains unchanged.

Remaining unresolved findings:

- **MEDIUM — ordinary server startup can mutate data.** Route registration calls `ensureAnonymousUserExists()`, which conditionally creates the shared guest user. No schema mutation occurs, but startup is not database-read-only. Removing it safely must be coordinated with the remaining legacy guest middleware behavior.
- **MEDIUM — Exam Readiness migration assumes every legacy `Exam.topicIds` value is a valid JSON array.** Three unguarded `::jsonb`/`jsonb_array_elements_text` expressions can abort the migration on malformed or non-array legacy data. The migration should add a reviewed preflight/guard before deployment; it was not changed or applied during this audit.

Validation performed:

- `npm run check:types` — passed
- `npm run server:build` — passed; the generated tracked bundle was restored after the check
- `npm run test:study-today` — 11 passed
- `npm run test:study-today-client` — 5 passed
- `npm run test:exam-readiness` — 10 passed
- `npm run test:exam-readiness-client` — 7 passed
- `npm run test:account-deletion` — 8 passed; the server route harness uses mocked Prisma methods and cannot contact a database
- `npm run test:study-evidence` — 18 passed; covers canonical IDs, durable flashcard success/failure ordering, authenticated owned-quiz service behavior, server scoring, Mastery update dispatch, stable-submission idempotency/conflict handling, client failure propagation, relevant cache refresh keys, and the Phase 8C client hydration/reconciliation cases
- `npm run test:topic-hydration` — 16 passed without connecting to a database; covers authenticated topic/course ownership constraints, source-segment export shape, real Prisma flashcard normalization, Notes/Cards/Quiz hydration, fresh-device cache population, per-user cache namespacing, non-overwrite reconciliation, destination-specific offline fallback, unauthorized/not-found rejection, empty server content, and source-backed notes
- Phase 8B component coverage uses extracted presentation/action/submission helpers because the repository has no React Native component-test renderer. Existing Study Today client coverage also verifies that Cards and Quiz destinations carry the explicit durable-action marker; ordinary Topic callbacks remain optional for backward compatibility.
- Focused Prettier check for the new account-deletion helper, tests, and package script — passed
- Focused Prettier check for the new Phase 8B evidence helpers and tests — passed; the touched legacy Topic, Cards, Quiz, and AI-provider files retain their pre-existing whole-file formatting deviations rather than receiving an unrelated reformat
- Focused Prettier check for the new Phase 8C hydration, cache-namespace, navigation, and test files — passed; touched legacy storage, Topic, and sync files retain their pre-existing whole-file formatting deviations rather than receiving an unrelated reformat
- `server/auth.ts` and `client/contexts/AuthContext.tsx` remain part of the pre-existing whole-file formatting backlog; their Phase 8A edits were kept minimal rather than reformatting unrelated code
- `npx prisma validate` — passed without connecting to or mutating a database
- `git diff --check` — passed
- No standalone Course Brain, Mastery, or quiz regression tests exist in the repository
- Full `npm run check:format` remains blocked by 70 pre-existing formatting deviations; no broad reformat was performed
- `npm run lint` remains blocked before linting because `eslint-plugin-prettier/recommended` is referenced but not installed; no dependency was installed or changed

No production or shared database command was run. No migration was applied, no `prisma db push` was run, and no production database mutation was performed. The following migrations remain unapplied:

- `prisma/migrations/20260924010000_add_sourcelock/migration.sql`
- `prisma/migrations/20260924020000_add_mastery/migration.sql`
- `prisma/migrations/20260924021000_add_quiz_submission_idempotency/migration.sql`
- `prisma/migrations/20260924030000_add_exam_readiness/migration.sql`

## Phase 6 additions

- Extended the existing `Exam` domain with an optional description and durable course association while preserving legacy `topicIds` and `studyPlan` fields.
- Added the relational `ExamConcept` scope with a composite `(examId, conceptId)` primary key so duplicate associations cannot accumulate.
- Existing single-course exams are backfilled from their legacy topic scope when the migration is eventually reviewed and applied.
- Exam creation accepts `courseId`, optional `description`, and optional `conceptIds`; legacy topic selections are mapped to their existing Phase 5 concepts.
- Added idempotent exam concept-scope replacement.
- Added one canonical deterministic server-side readiness calculation from persisted `ConceptMastery` data.
- Included exams and their concept scope in the authenticated privacy export; delete-data remains cascade-safe.
- Added a typed mobile readiness client backed only by `GET /api/exams/:id/readiness`.
- Added an Exam Readiness screen reached from existing Course Brain exam rows. It presents the server score only when evidence exists, makes sparse coverage explicit, and lists strong, developing, weak, unassessed concepts, and server drivers.
- Preserved the existing local Exam Mode flow. No parallel client-side readiness calculation or local persistence was introduced.

## API routes

- `POST /api/exams` — creates a course-owned exam and durable concept scope while retaining the existing topic-based response contract.
- `PUT /api/exams/:id/concepts` — replaces the owned exam's concept scope; repeated concept IDs are deduplicated and the database primary key enforces uniqueness.
- `GET /api/exams/:id/readiness` — returns the explainable readiness result for the authenticated owner.

All routes preserve the existing authentication and Exam Mode entitlement middleware. Course, topic, concept, exam, and mastery queries remain user-scoped. Unauthorized and nonexistent exam readiness lookups both return the generic not-found response.

## Prisma and migration

Schema additions:

- `Exam.courseId` and the `Exam.course` relation
- `Exam.description`
- `Exam.conceptScopes`
- `Course.exams`
- `Concept.examScopes`
- `ExamConcept` with foreign keys, cascade behavior, indexes, and composite uniqueness

Migration: `prisma/migrations/20260924030000_add_exam_readiness/migration.sql`

The migration has **NOT** been applied. No production or shared database command was run.

Previously committed migrations also remain unapplied:

- `prisma/migrations/20260924010000_add_sourcelock/migration.sql`
- `prisma/migrations/20260924020000_add_mastery/migration.sql`
- `prisma/migrations/20260924021000_add_quiz_submission_idempotency/migration.sql`

## Readiness semantics

- Exam scope is the exam's durable `ExamConcept` set; concepts outside that set cannot affect the result.
- Meaningful evidence requires a positive Phase 5 `evidenceCount` and at least one recorded correct/incorrect answer.
- Each scoped concept contributes `mastery score × evidence confidence`, normalized to 0–100.
- Unassessed concepts contribute zero; they are not treated as mastered.
- Overall readiness is the mean contribution across all scoped concepts, so missing coverage remains visible in the score.
- Bands are `READY`, `PROGRESSING`, `NOT_READY`, and `NO_SCOPE`.
- The response includes coverage, evidence and answer counts, per-concept mastery/confidence/trend, strong/developing/weak/unassessed groups, and deterministic drivers.

## Phase 7A Study Today foundation

- Added the canonical authenticated `GET /api/study-today` endpoint. The existing `/api/adaptive/study-today` response remains unchanged for the current dashboard and due-card flow.
- Added a pure deterministic Study Today ranking domain plus a Prisma-backed repository. No AI model ranks or generates recommendations.
- Reused existing owned courses, concepts, concept mastery, confidence/evidence, exam concept scope and dates, flashcards/due state, quizzes, notes, transcripts, and sources.
- Recommendations are computed dynamically. No recommendation table or other persistent state was added.
- Results distinguish `NO_COURSES`, `NO_CONCEPTS`, `NO_RECOMMENDATIONS`, and `READY` states and return at most 10 recommendations.
- The response records `generatedAt` and the explicit current assumption `timeZone: UTC`. Exam proximity uses UTC calendar-day boundaries because the current user model has no timezone field.

### Prioritization model

All thresholds and weights live in `STUDY_TODAY_CONFIG` in `server/study-today-domain.ts`:

- low demonstrated mastery: +35
- no meaningful mastery evidence: +30
- low confidence: +10
- sparse evidence (two or fewer evidence events): +10
- exam proximity: +20 within 7 days, +15 within 14 days, +8 within 30 days, and no urgency beyond 30 days
- weak exam-scoped readiness evidence: +10 when an upcoming exam is within the urgency window
- one or more due flashcards: +10

Scores are an inspectable sum of returned factor points, capped at 100. Priority bands are `HIGH` at 55+, `MEDIUM` at 30+, and `LOW` below 30. Ties are resolved by course name, concept name, then concept ID so ranking remains deterministic.

Each recommendation returns structured reason codes and labels, mastery state/score/confidence/evidence, last practice and trend, nearest scoped upcoming exam, and a deterministic action supported by the existing product: `TAKE_QUIZ`, `REVIEW_FLASHCARDS`, or `REVIEW_CONCEPT`. Concepts with no supported action or no real priority factor are not fabricated into recommendations.

### Authorization

- The route requires the existing `authMiddleware` and passes only `req.user.id` into the service.
- Courses, concepts, topics, masteries, exam scopes, exams, and flashcard stats are all filtered to the authenticated user.
- Quizzes, flashcards, and source material are reached only through an authenticated user's owned topic/course graph.
- The repository contract and tests verify that another user's records cannot influence the result.

### Phase 7B Study Today client integration

- Replaced the old locally shuffled `StudyTodayScreen` card session with the canonical server-backed Study Today plan. The screen now reads only `GET /api/study-today`; it does not calculate, sort, or reshuffle recommendations locally.
- Added a typed React Query client layer with a 30-second stale window, authenticated requests, typed result/status/reason/action models, and the `study-today` cache key.
- The existing dashboard destination remains `StudyToday`; its legacy `/api/adaptive/study-today` due-card summary contract remains intact and is not presented as a competing recommendation list.
- Study Today presents the server order as rank-numbered cards with course, concept, readable priority, mastery/evidence state, nearest upcoming scoped exam, friendly structured reasons, and a deterministic action.
- Added intentional loading, authentication/unavailable error, no-course, no-concept, no-recommendation, and sparse-evidence states. No urgency or replacement list is fabricated for empty responses.
- Action buttons map only to existing Topic capabilities: flashcard actions open the Cards tab, quiz actions open the Quiz tab, and source/concept actions open the Notes tab. The Topic route now accepts an optional focused initial tab.

### Phase 7B files

- Added `client/lib/studyToday.ts`
- Added `client/lib/studyTodayPresentation.ts`
- Added `client/lib/studyTodayPresentation.test.ts`
- Updated `client/screens/StudyTodayScreen.tsx`
- Updated `client/screens/TopicScreen.tsx`
- Updated `client/navigation/RootStackNavigator.tsx`
- Updated `package.json`
- Updated `docs/STUDYMIND_2_STATUS.md`

### Phase 7A files

- Added `server/study-today-domain.ts`
- Added `server/study-today-service.ts`
- Added `server/study-today.ts`
- Added `server/study-today.test.ts`
- Updated `server/routes.ts`
- Updated `package.json`
- Updated `docs/STUDYMIND_2_STATUS.md`

## Prisma and migration status

Phase 7A does not change `prisma/schema.prisma` and adds no migration. Recommendations are derived from existing durable records.

No migration has been applied. No database mutation or production database command was run.

The following committed migrations remain unapplied:

- `prisma/migrations/20260924010000_add_sourcelock/migration.sql`
- `prisma/migrations/20260924020000_add_mastery/migration.sql`
- `prisma/migrations/20260924021000_add_quiz_submission_idempotency/migration.sql`
- `prisma/migrations/20260924030000_add_exam_readiness/migration.sql`

## Tests and validation

`server/exam-readiness.test.ts` covers:

- high, mixed, and weak mastery outcomes
- missing and sparse evidence
- strict exam-concept scoping
- ownership and nonexistent-exam behavior
- duplicate ID normalization
- preservation of Phase 5 mastery inputs

`client/lib/examReadinessPresentation.test.ts` covers:

- normal, sparse, no-scope, and no-evidence presentation states
- loading and error/not-found state selection
- strong, weak, and unassessed concept grouping

`server/study-today.test.ts` covers:

- weak concepts ranking above strong concepts
- unassessed concepts without fabricated mastery
- upcoming exam boosts for weak scoped concepts
- no artificial urgency for far-future or absent exams
- deprioritization of strong, well-evidenced concepts
- visible sparse-evidence reasons
- authenticated-user repository scoping
- cross-user isolation
- empty and concept-free course states
- deterministic ranking independent of input order
- bounded recommendation output

`client/lib/studyTodayPresentation.test.ts` covers:

- preservation of canonical server recommendation order
- friendly reason, mastery, priority, and action labels
- visible sparse and missing evidence state
- loading, error, and empty state selection
- supported action mapping to existing Topic tabs

Safe checks completed:

- `npm run test:exam-readiness` — 10 passed
- `npm run test:exam-readiness-client` — 7 passed
- `npm run test:study-today` — 11 passed
- `npm run test:study-today-client` — 5 passed
- `npm run check:types`
- `npm run server:build`
- focused Prettier checks for the Phase 7A/7B added and rewritten files, package, and status files
- `git diff --check`

There is no standalone Mastery test command in the repository. The Exam Readiness regression suite includes a test that its calculation preserves the Phase 5 mastery inputs. Prisma validation/generation was not rerun because Phase 7A does not change the schema.

Validation limitations:

- `npm run lint` cannot start because the existing ESLint config imports the uninstalled `eslint-plugin-prettier/recommended` module.
- `client/screens/TopicScreen.tsx` has pre-existing whole-file Prettier deviations. Its focused-tab change was kept minimal rather than mechanically reformatting unrelated code.
- `npm run audit:fast` uses POSIX environment-variable syntax and does not run on Windows. The full boot audit was not substituted because route startup can touch the configured PostgreSQL database, which is forbidden for this phase.

## Remaining Phase 7 work

- Phase 7 implementation is complete. Live API/device verification depends on the already committed prerequisite SourceLock, Mastery, and Exam Readiness migrations being separately reviewed and deployed.
- User timezone persistence is not currently available. UTC is explicit in the response and should be revisited only with a product-wide timezone design.
- The existing ESLint dependency/configuration blocker remains unrelated to Phase 7A.
