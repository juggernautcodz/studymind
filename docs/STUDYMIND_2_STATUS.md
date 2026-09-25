# StudyMind 2.0 Current Status

Branch: `studymind-2.0`

Starting HEAD for Phase 7A: `5cdb21132f037c1771d16bab50f43a6929cf10a5`

Current phase: Phase 7A — Personalized Study Today backend/domain foundation implemented, not committed

## Completed phases

1. Architecture Design
2. Course Brain
3. SourceLock
4. Lecture Autopilot
5. Mastery
6. Exam Readiness

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

Safe checks completed:

- `npm run test:exam-readiness` — 10 passed
- `npm run test:exam-readiness-client` — 7 passed
- `npm run test:study-today` — 11 passed
- `npm run check:types`
- `npm run server:build`
- focused Prettier check for the Phase 7A domain, service, route, test, package, and status files
- `git diff --check`

There is no standalone Mastery test command in the repository. The Exam Readiness regression suite includes a test that its calculation preserves the Phase 5 mastery inputs. Prisma validation/generation was not rerun because Phase 7A does not change the schema.

Validation limitations:

- `npm run lint` cannot start because the existing ESLint config imports the uninstalled `eslint-plugin-prettier/recommended` module.
- `npm run audit:fast` uses POSIX environment-variable syntax and does not run on Windows. The full boot audit was not substituted because route startup can touch the configured PostgreSQL database, which is forbidden for this phase.

## Remaining Phase 7 work

- Phase 7B should add the client Study Today presentation and navigation behavior using `GET /api/study-today` without duplicating ranking logic on-device.
- The existing `StudyTodayScreen` still shuffles locally cached flashcards; it was intentionally not changed in the backend/domain phase.
- Live API integration depends on the already committed prerequisite SourceLock, Mastery, and Exam Readiness migrations being separately reviewed and deployed.
- User timezone persistence is not currently available. UTC is explicit in the response and should be revisited only with a product-wide timezone design.
- The existing ESLint dependency/configuration blocker remains unrelated to Phase 7A.
