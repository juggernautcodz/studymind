-- Additive Mastery foundation. Intentionally not applied by development tasks.
CREATE TABLE "Concept" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Concept_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConceptMastery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "incorrectCount" INTEGER NOT NULL DEFAULT 0,
    "lastPracticedAt" TIMESTAMP(3),
    "trend" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ConceptMastery_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ConceptMastery_score_check" CHECK ("score" >= 0 AND "score" <= 1),
    CONSTRAINT "ConceptMastery_confidence_check" CHECK ("confidence" >= 0 AND "confidence" <= 1)
);

CREATE TABLE "MasteryEvent" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceId" TEXT,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "incorrectCount" INTEGER NOT NULL DEFAULT 0,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MasteryEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MasteryEvent_counts_check" CHECK ("correctCount" >= 0 AND "incorrectCount" >= 0)
);

CREATE UNIQUE INDEX "Concept_courseId_topicId_key" ON "Concept"("courseId", "topicId");
CREATE INDEX "Concept_userId_idx" ON "Concept"("userId");
CREATE INDEX "Concept_courseId_idx" ON "Concept"("courseId");
CREATE INDEX "Concept_topicId_idx" ON "Concept"("topicId");
CREATE UNIQUE INDEX "ConceptMastery_userId_conceptId_key" ON "ConceptMastery"("userId", "conceptId");
CREATE INDEX "ConceptMastery_userId_courseId_idx" ON "ConceptMastery"("userId", "courseId");
CREATE INDEX "ConceptMastery_conceptId_idx" ON "ConceptMastery"("conceptId");
CREATE UNIQUE INDEX "MasteryEvent_eventKey_key" ON "MasteryEvent"("eventKey");
CREATE INDEX "MasteryEvent_userId_courseId_conceptId_occurredAt_idx" ON "MasteryEvent"("userId", "courseId", "conceptId", "occurredAt");
CREATE INDEX "MasteryEvent_conceptId_idx" ON "MasteryEvent"("conceptId");

ALTER TABLE "Concept" ADD CONSTRAINT "Concept_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Concept" ADD CONSTRAINT "Concept_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Concept" ADD CONSTRAINT "Concept_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConceptMastery" ADD CONSTRAINT "ConceptMastery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConceptMastery" ADD CONSTRAINT "ConceptMastery_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConceptMastery" ADD CONSTRAINT "ConceptMastery_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "Concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MasteryEvent" ADD CONSTRAINT "MasteryEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MasteryEvent" ADD CONSTRAINT "MasteryEvent_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MasteryEvent" ADD CONSTRAINT "MasteryEvent_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "Concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;
