# StudyMind 2.0 Current Status

Branch: `studymind-2.0`

Starting HEAD for this phase: `b5965c25b308ee6c680b7adfe306ff476e5f922d`

Current phase: Phase 6A — Exam Readiness backend/domain foundation implemented, not committed

## Completed phases

1. Architecture Design
2. Course Brain
3. SourceLock
4. Lecture Autopilot
5. Mastery

## Phase 6A additions

- Extended the existing `Exam` domain with an optional description and durable course association while preserving legacy `topicIds` and `studyPlan` fields.
- Added the relational `ExamConcept` scope with a composite `(examId, conceptId)` primary key so duplicate associations cannot accumulate.
- Existing single-course exams are backfilled from their legacy topic scope when the migration is eventually reviewed and applied.
- Exam creation accepts `courseId`, optional `description`, and optional `conceptIds`; legacy topic selections are mapped to their existing Phase 5 concepts.
- Added idempotent exam concept-scope replacement.
- Added one canonical deterministic server-side readiness calculation from persisted `ConceptMastery` data.
- Included exams and their concept scope in the authenticated privacy export; delete-data remains cascade-safe.

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

## Tests and validation

`server/exam-readiness.test.ts` covers:

- high, mixed, and weak mastery outcomes
- missing and sparse evidence
- strict exam-concept scoping
- ownership and nonexistent-exam behavior
- duplicate ID normalization
- preservation of Phase 5 mastery inputs

Safe checks completed:

- `npx prisma validate`
- `npx prisma generate`
- `npm run test:exam-readiness` — 10 passed
- `npm run check:types`
- `npm run server:build`
- focused Prettier check for the changed TypeScript and package files

Validation limitations:

- `npm run lint` cannot start because the existing ESLint config imports the uninstalled `eslint-plugin-prettier/recommended` module.
- `npm run audit:fast` uses POSIX environment-variable syntax and does not run on Windows. The full boot audit was not substituted because route startup can touch the configured PostgreSQL database, which is forbidden for this phase.

## Remaining Phase 6 work

- Review and explicitly approve the additive migration before any deployment applies it.
- Add client consumption/presentation of the readiness endpoint in a separately approved UI phase if desired.
- Perform live integration verification only after the prerequisite migrations are approved and deployed.

Phase 7 Personalized Study Today has not been started.
