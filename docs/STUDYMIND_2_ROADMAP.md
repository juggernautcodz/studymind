# StudyMind 2.0 Roadmap

## Foundation
Completed or in progress:
- studymind-2.0 branch
- PostgreSQL durable persistence
- Prisma migration baseline
- ownership / IDOR hardening
- sync/hydration foundation
- existing feature preservation

## Phase 1 — Architecture Design
Design the minimal architecture for:
- Course Brain
- Sources
- Concepts
- Concept relationships
- Source provenance
- Mastery
- compatibility with future features

No code implementation beyond planning.

## Phase 2 — Course Brain
Build the minimum Course Brain foundation.
Reuse Course, Topic, Recording, Flashcard, Quiz, Exam, adaptive engine, Library, Search, and sync.

## Phase 3 — SourceLock
Add first-class Sources and provenance.
Ensure generated knowledge traces back to owned Sources.
Prevent cross-user and cross-course leakage.

## Phase 4 — Lecture Autopilot
Lecture flow becomes:
record → source → concepts → course brain → study material

Reuse existing transcription, notes, flashcard, and quiz pipelines.

## Phase 5 — Mastery
Extend existing FlashcardStat and QuizAttempt data into concept-level mastery.
Do not rebuild the adaptive engine.

## Phase 6 — Exam Readiness
Use Course Brain + Concepts + Mastery to identify readiness, weak areas, and targeted preparation.

## Phase 7 — Personalized Study Today
Upgrade Study Today to combine:
- due cards
- weak concepts
- mastery gaps
- exam proximity
- course context

## Phase 8 — Full Regression Audit
Verify:
- auth
- ownership
- recording
- transcription
- OCR
- notes
- flashcards
- quizzes
- exam
- Course Brain
- Sources
- provenance
- Concepts
- Mastery
- Study Today
- billing
- sync/hydration
- export/delete
- Android/iOS compatibility

Fix only real blockers/regressions.

## Phase 9 — Phone Testing
Test the complete app on a real device before continuing.

## Phase 10 — Professor Emphasis

## Phase 11 — Ask My Course

## Phase 12 — I Missed Class

## Phase 13 — Knowledge Map

## Phase 14 — Course-aware Writing Lab
