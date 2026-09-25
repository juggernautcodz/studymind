-- Additive Exam Readiness foundation. Intentionally not applied by development tasks.
ALTER TABLE "Exam" ADD COLUMN "courseId" TEXT;
ALTER TABLE "Exam" ADD COLUMN "description" TEXT;

CREATE TABLE "ExamConcept" (
    "examId" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExamConcept_pkey" PRIMARY KEY ("examId", "conceptId")
);

CREATE INDEX "Exam_courseId_idx" ON "Exam"("courseId");
CREATE INDEX "Exam_userId_courseId_idx" ON "Exam"("userId", "courseId");
CREATE INDEX "ExamConcept_conceptId_idx" ON "ExamConcept"("conceptId");

ALTER TABLE "Exam" ADD CONSTRAINT "Exam_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExamConcept" ADD CONSTRAINT "ExamConcept_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExamConcept" ADD CONSTRAINT "ExamConcept_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "Concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve existing exams when their legacy topic scope resolves to one owned course.
WITH "ExamTopicCourses" AS (
    SELECT "Exam"."id" AS "examId", "Topic"."courseId"
    FROM "Exam"
    CROSS JOIN LATERAL jsonb_array_elements_text("Exam"."topicIds"::jsonb) AS "ScopedTopic"("topicId")
    INNER JOIN "Topic" ON "Topic"."id" = "ScopedTopic"."topicId" AND "Topic"."userId" = "Exam"."userId"
    INNER JOIN "Course" ON "Course"."id" = "Topic"."courseId" AND "Course"."userId" = "Exam"."userId"
),
"SingleCourseExams" AS (
    SELECT "examId", MIN("courseId") AS "courseId"
    FROM "ExamTopicCourses"
    GROUP BY "examId"
    HAVING COUNT(DISTINCT "courseId") = 1
)
UPDATE "Exam"
SET "courseId" = "SingleCourseExams"."courseId"
FROM "SingleCourseExams"
WHERE "Exam"."id" = "SingleCourseExams"."examId";

-- Ensure legacy exam topics have the Phase 5 concept record needed for scope.
-- The deterministic text ID avoids requiring a database UUID extension.
INSERT INTO "Concept" ("id", "userId", "courseId", "topicId", "name", "createdAt", "updatedAt")
SELECT DISTINCT
    'legacy-exam-' || md5("Exam"."courseId" || ':' || "Topic"."id"),
    "Exam"."userId",
    "Exam"."courseId",
    "Topic"."id",
    "Topic"."name",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Exam"
CROSS JOIN LATERAL jsonb_array_elements_text("Exam"."topicIds"::jsonb) AS "ScopedTopic"("topicId")
INNER JOIN "Topic" ON "Topic"."id" = "ScopedTopic"."topicId"
    AND "Topic"."courseId" = "Exam"."courseId"
    AND "Topic"."userId" = "Exam"."userId"
WHERE "Exam"."courseId" IS NOT NULL
ON CONFLICT ("courseId", "topicId") DO NOTHING;

-- Concepts were established by Phase 5 as the durable one-per-topic mastery scope.
INSERT INTO "ExamConcept" ("examId", "conceptId")
SELECT DISTINCT "Exam"."id", "Concept"."id"
FROM "Exam"
CROSS JOIN LATERAL jsonb_array_elements_text("Exam"."topicIds"::jsonb) AS "ScopedTopic"("topicId")
INNER JOIN "Concept" ON "Concept"."topicId" = "ScopedTopic"."topicId"
    AND "Concept"."courseId" = "Exam"."courseId"
    AND "Concept"."userId" = "Exam"."userId"
WHERE "Exam"."courseId" IS NOT NULL
ON CONFLICT ("examId", "conceptId") DO NOTHING;
