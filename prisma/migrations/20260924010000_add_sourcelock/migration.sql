-- Additive SourceLock provenance foundation. This migration is intentionally
-- safe for existing rows and does not backfill legacy study data.

-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM (
    'LECTURE_AUDIO',
    'LECTURE_TRANSCRIPT',
    'DOCUMENT',
    'PDF',
    'WHITEBOARD_IMAGE',
    'MANUAL_TEXT',
    'VIDEO',
    'URL'
);

-- CreateEnum
CREATE TYPE "ArtifactKind" AS ENUM ('FLASHCARD', 'QUIZ_QUESTION', 'TOPIC_NOTES');

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "topicId" TEXT,
    "recordingId" TEXT,
    "whiteboardImageId" TEXT,
    "kind" "SourceKind" NOT NULL,
    "title" TEXT NOT NULL,
    "originUri" TEXT,
    "mimeType" TEXT,
    "currentRevision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Source_currentRevision_check" CHECK ("currentRevision" >= 1),
    CONSTRAINT "Source_legacy_origin_check" CHECK (num_nonnulls("recordingId", "whiteboardImageId") <= 1)
);

-- CreateTable
CREATE TABLE "GenerationRun" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GenerationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceRevision" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "generationRunId" TEXT,
    "revision" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "contentLength" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceRevision_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SourceRevision_revision_check" CHECK ("revision" >= 1),
    CONSTRAINT "SourceRevision_contentLength_check" CHECK ("contentLength" >= 0)
);

-- CreateTable
CREATE TABLE "SourceSegment" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "locatorLabel" TEXT,
    "pageNumber" INTEGER,
    "startSeconds" DOUBLE PRECISION,
    "endSeconds" DOUBLE PRECISION,
    "charStart" INTEGER,
    "charEnd" INTEGER,
    "regionX" DOUBLE PRECISION,
    "regionY" DOUBLE PRECISION,
    "regionWidth" DOUBLE PRECISION,
    "regionHeight" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceSegment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SourceSegment_position_check" CHECK ("position" >= 0),
    CONSTRAINT "SourceSegment_pageNumber_check" CHECK ("pageNumber" IS NULL OR "pageNumber" > 0),
    CONSTRAINT "SourceSegment_time_check" CHECK (
        ("startSeconds" IS NULL OR "startSeconds" >= 0) AND
        ("endSeconds" IS NULL OR "endSeconds" >= 0) AND
        ("startSeconds" IS NULL OR "endSeconds" IS NULL OR "endSeconds" >= "startSeconds")
    ),
    CONSTRAINT "SourceSegment_character_range_check" CHECK (
        ("charStart" IS NULL OR "charStart" >= 0) AND
        ("charEnd" IS NULL OR "charEnd" >= 0) AND
        ("charStart" IS NULL OR "charEnd" IS NULL OR "charEnd" >= "charStart")
    ),
    CONSTRAINT "SourceSegment_region_check" CHECK (
        (("regionX" IS NULL AND "regionY" IS NULL AND "regionWidth" IS NULL AND "regionHeight" IS NULL) OR
        ("regionX" >= 0 AND "regionY" >= 0 AND "regionWidth" > 0 AND "regionHeight" > 0 AND
         "regionX" + "regionWidth" <= 1 AND "regionY" + "regionHeight" <= 1))
    )
);

-- CreateTable
CREATE TABLE "ArtifactCitation" (
    "id" TEXT NOT NULL,
    "sourceSegmentId" TEXT NOT NULL,
    "generationRunId" TEXT,
    "artifactKind" "ArtifactKind" NOT NULL,
    "flashcardId" TEXT,
    "quizQuestionId" TEXT,
    "topicId" TEXT,
    "evidenceExcerpt" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtifactCitation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ArtifactCitation_target_check" CHECK (
        ("artifactKind" = 'FLASHCARD' AND "flashcardId" IS NOT NULL AND "quizQuestionId" IS NULL AND "topicId" IS NULL) OR
        ("artifactKind" = 'QUIZ_QUESTION' AND "flashcardId" IS NULL AND "quizQuestionId" IS NOT NULL AND "topicId" IS NULL) OR
        ("artifactKind" = 'TOPIC_NOTES' AND "flashcardId" IS NULL AND "quizQuestionId" IS NULL AND "topicId" IS NOT NULL)
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "Source_recordingId_key" ON "Source"("recordingId");
CREATE UNIQUE INDEX "Source_whiteboardImageId_key" ON "Source"("whiteboardImageId");
CREATE INDEX "Source_courseId_idx" ON "Source"("courseId");
CREATE INDEX "Source_topicId_idx" ON "Source"("topicId");
CREATE INDEX "Source_courseId_kind_idx" ON "Source"("courseId", "kind");
CREATE INDEX "GenerationRun_courseId_idx" ON "GenerationRun"("courseId");
CREATE UNIQUE INDEX "SourceRevision_sourceId_revision_key" ON "SourceRevision"("sourceId", "revision");
CREATE INDEX "SourceRevision_generationRunId_idx" ON "SourceRevision"("generationRunId");
CREATE UNIQUE INDEX "SourceSegment_revisionId_position_key" ON "SourceSegment"("revisionId", "position");
CREATE INDEX "SourceSegment_revisionId_idx" ON "SourceSegment"("revisionId");
CREATE INDEX "ArtifactCitation_sourceSegmentId_idx" ON "ArtifactCitation"("sourceSegmentId");
CREATE INDEX "ArtifactCitation_generationRunId_idx" ON "ArtifactCitation"("generationRunId");
CREATE INDEX "ArtifactCitation_flashcardId_idx" ON "ArtifactCitation"("flashcardId");
CREATE INDEX "ArtifactCitation_quizQuestionId_idx" ON "ArtifactCitation"("quizQuestionId");
CREATE INDEX "ArtifactCitation_topicId_idx" ON "ArtifactCitation"("topicId");
CREATE UNIQUE INDEX "ArtifactCitation_segment_flashcard_key" ON "ArtifactCitation"("sourceSegmentId", "flashcardId") WHERE "flashcardId" IS NOT NULL;
CREATE UNIQUE INDEX "ArtifactCitation_segment_quizQuestion_key" ON "ArtifactCitation"("sourceSegmentId", "quizQuestionId") WHERE "quizQuestionId" IS NOT NULL;
CREATE UNIQUE INDEX "ArtifactCitation_segment_topic_key" ON "ArtifactCitation"("sourceSegmentId", "topicId") WHERE "topicId" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "Source" ADD CONSTRAINT "Source_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Source" ADD CONSTRAINT "Source_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Source" ADD CONSTRAINT "Source_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Source" ADD CONSTRAINT "Source_whiteboardImageId_fkey" FOREIGN KEY ("whiteboardImageId") REFERENCES "WhiteboardImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GenerationRun" ADD CONSTRAINT "GenerationRun_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceRevision" ADD CONSTRAINT "SourceRevision_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceRevision" ADD CONSTRAINT "SourceRevision_generationRunId_fkey" FOREIGN KEY ("generationRunId") REFERENCES "GenerationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SourceSegment" ADD CONSTRAINT "SourceSegment_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "SourceRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArtifactCitation" ADD CONSTRAINT "ArtifactCitation_sourceSegmentId_fkey" FOREIGN KEY ("sourceSegmentId") REFERENCES "SourceSegment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArtifactCitation" ADD CONSTRAINT "ArtifactCitation_generationRunId_fkey" FOREIGN KEY ("generationRunId") REFERENCES "GenerationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ArtifactCitation" ADD CONSTRAINT "ArtifactCitation_flashcardId_fkey" FOREIGN KEY ("flashcardId") REFERENCES "Flashcard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArtifactCitation" ADD CONSTRAINT "ArtifactCitation_quizQuestionId_fkey" FOREIGN KEY ("quizQuestionId") REFERENCES "QuizQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArtifactCitation" ADD CONSTRAINT "ArtifactCitation_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enforce immutable revision identity and evidence content. Reprocessing creates
-- a new SourceRevision instead of changing rows already referenced by citations.
CREATE FUNCTION "prevent_sourcelock_content_update"() RETURNS TRIGGER AS $$
BEGIN
    IF TG_TABLE_NAME = 'SourceRevision' THEN
        IF NEW."id" IS DISTINCT FROM OLD."id"
            OR NEW."sourceId" IS DISTINCT FROM OLD."sourceId"
            OR NEW."revision" IS DISTINCT FROM OLD."revision"
            OR NEW."contentHash" IS DISTINCT FROM OLD."contentHash"
            OR NEW."contentLength" IS DISTINCT FROM OLD."contentLength"
            OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
            OR (
                NEW."generationRunId" IS DISTINCT FROM OLD."generationRunId"
                AND NOT (OLD."generationRunId" IS NOT NULL AND NEW."generationRunId" IS NULL)
            ) THEN
            RAISE EXCEPTION 'SourceLock revision evidence identity is immutable; create a new revision';
        END IF;
        RETURN NEW;
    END IF;

    IF TG_TABLE_NAME = 'SourceSegment' AND NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION 'SourceLock segment content and locators are immutable; create a new revision';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SourceRevision_prevent_update"
BEFORE UPDATE ON "SourceRevision"
FOR EACH ROW EXECUTE FUNCTION "prevent_sourcelock_content_update"();

CREATE TRIGGER "SourceSegment_prevent_update"
BEFORE UPDATE ON "SourceSegment"
FOR EACH ROW EXECUTE FUNCTION "prevent_sourcelock_content_update"();
