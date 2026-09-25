-- Additive idempotency key for authenticated quiz submissions.
-- PostgreSQL unique indexes allow multiple rows containing NULL, preserving
-- historical attempts and the existing guest/legacy behavior.
ALTER TABLE "QuizAttempt" ADD COLUMN "submissionId" TEXT;

CREATE UNIQUE INDEX "QuizAttempt_userId_quizId_submissionId_key"
ON "QuizAttempt"("userId", "quizId", "submissionId");
