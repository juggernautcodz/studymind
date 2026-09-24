# StudyMind 2.0 Agent Rules

Repository:
C:\WebAutomation\projects\studybrain

Development branch:
studymind-2.0

## Core product direction

Course Brain → Sources → Concepts → Mastery → Personalized Study

Planned major capabilities:
- Course Brain
- SourceLock / source provenance
- Lecture Autopilot
- Concept relationships
- Professor Emphasis
- Mastery tracking
- Exam Readiness
- Personalized Study Today
- Ask My Course
- I Missed Class
- Knowledge Map
- Course-aware Writing Lab

## Engineering rules

- Upgrade the existing app in place.
- Do not rebuild from scratch.
- Preserve existing working infrastructure and features.
- Preserve backward compatibility.
- PostgreSQL is the durable source of truth.
- AsyncStorage should increasingly be cache/offline/pending state rather than long-term authority.
- Never run prisma db push against production.
- Never run destructive migrations without explicit review.
- Database mutation must not occur during ordinary app startup or builds.
- Use reviewed Prisma migrations only.
- Use prisma migrate deploy only in approved deployment steps.
- Production database changes require explicit human approval.
- Do not change Expo SDK, app IDs, signing, EAS config, billing config, or auth architecture unless explicitly required.
- Maintain TypeScript strictness.
- Avoid unnecessary dependencies.
- Do not use fake production AI behavior.
- Preserve privacy, accessibility, export, and delete-data behavior.
- Prefer additive and reversible changes.
- Reuse existing systems before creating new ones.
- Do not duplicate working implementations.
- Do not make unrelated cleanup changes during a product phase.
- Build phases, not patches.

## Git rules

- Never automatically commit.
- Never automatically push.
- Never merge, rebase, reset, or force-push.
- Stop at each phase gate.
- Report changed files, checks, failures, risks, and git status.
- Wait for explicit human approval before commit.
- Push requires separate explicit human approval.

## Database safety

- Production data is valuable and irreplaceable.
- No production DB mutation without explicit approval.
- No schema mutation during app startup or build.
- No prisma db push against production.

## Scope discipline

If you discover something unrelated:
- report it
- do not fix it unless it blocks the active phase or creates immediate security/data-loss risk

Do not rescan the whole repo unless specifically required.
Reuse prior findings.
