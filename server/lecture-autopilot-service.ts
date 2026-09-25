import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";

import type {
  LectureAutopilotJobDto,
  LectureAutopilotMaterials,
  LectureAutopilotResultDto,
  LectureAutopilotStage,
} from "../shared/lecture-autopilot";
import prisma from "./db";
import { incrementUsage } from "./middleware";
import { AppError } from "./lib/errors";
import { USE_REAL_AI } from "./lib/ai-runtime";
import type { LectureAutopilotInput } from "./lib/lecture-autopilot-validation";
import {
  generateLectureFlashcards,
  generateLectureNotes,
  generateLectureQuiz,
  LectureAutopilotStageError,
  transcribeLectureAudio,
  type EvidenceSegment,
} from "./lib/lecture-autopilot-ai";
import {
  createArtifactCitationsBatch,
  createSource,
  getSource,
} from "./source-lock-service";

const JOB_TYPE = "lecture-autopilot" as const;
const PIPELINE_VERSION = 1;
const activeJobs = new Set<string>();
const INTERRUPTIBLE_JOB_STATUSES = new Set<LectureAutopilotStage>([
  "queued",
  "transcribing",
  "source-locking",
  "generating-notes",
  "generating-flashcards",
  "generating-quiz",
]);

interface StoredJobInput {
  version: number;
  courseId: string;
  topicId: string;
  durationMinutes: number;
  audioHash: string;
  materials: LectureAutopilotMaterials;
}

interface CitationPlan {
  artifactId: string;
  segmentIds: string[];
}

interface StoredJobOutput {
  version: number;
  completedStages: LectureAutopilotStage[];
  failedStage?: LectureAutopilotStage;
  recordingId?: string;
  sourceId?: string;
  revisionId?: string;
  segmentIds?: string[];
  notesWritten?: boolean;
  notesComplete?: boolean;
  notesGenerationRunId?: string;
  noteCitationSegmentIds?: string[];
  flashcardsWritten?: boolean;
  flashcardsComplete?: boolean;
  flashcardsGenerationRunId?: string;
  flashcardIds?: string[];
  flashcardCitationPlan?: CitationPlan[];
  quizWritten?: boolean;
  quizComplete?: boolean;
  quizGenerationRunId?: string;
  quizId?: string;
  quizQuestionIds?: string[];
  quizCitationPlan?: CitationPlan[];
  usageRecorded?: boolean;
}

interface OwnedContext {
  courseId: string;
  topicId: string;
  topicName: string;
}

function stableId(...parts: string[]): string {
  return createHash("sha256").update(parts.join(":"), "utf8").digest("hex");
}

function audioHash(audioBase64: string): string {
  return createHash("sha256")
    .update(Buffer.from(audioBase64, "base64"))
    .digest("hex");
}

function parseStoredInput(value: string | null): StoredJobInput {
  const parsed = JSON.parse(value ?? "null") as StoredJobInput | null;
  if (
    !parsed ||
    parsed.version !== PIPELINE_VERSION ||
    typeof parsed.courseId !== "string" ||
    typeof parsed.topicId !== "string" ||
    typeof parsed.audioHash !== "string" ||
    typeof parsed.durationMinutes !== "number" ||
    !parsed.materials
  ) {
    throw new AppError(
      500,
      "INVALID_JOB_STATE",
      "Lecture job state is invalid",
    );
  }
  return parsed;
}

function parseStoredOutput(value: string | null): StoredJobOutput {
  if (!value) return { version: PIPELINE_VERSION, completedStages: [] };
  const parsed = JSON.parse(value) as StoredJobOutput;
  if (
    !parsed ||
    parsed.version !== PIPELINE_VERSION ||
    !Array.isArray(parsed.completedStages)
  ) {
    throw new AppError(
      500,
      "INVALID_JOB_STATE",
      "Lecture job output is invalid",
    );
  }
  return parsed;
}

function appendCompletedStage(
  output: StoredJobOutput,
  stage: LectureAutopilotStage,
): StoredJobOutput {
  return {
    ...output,
    failedStage: undefined,
    completedStages: output.completedStages.includes(stage)
      ? output.completedStages
      : [...output.completedStages, stage],
  };
}

function sameMaterials(
  left: LectureAutopilotMaterials,
  right: LectureAutopilotMaterials,
): boolean {
  return (
    left.notes === right.notes &&
    left.flashcards === right.flashcards &&
    left.quiz === right.quiz
  );
}

async function assertOwnedContext(
  userId: string,
  courseId: string,
  topicId: string,
): Promise<OwnedContext> {
  const topic = await prisma.topic.findFirst({
    where: {
      id: topicId,
      userId,
      courseId,
      course: { userId },
    },
    select: { id: true, name: true, courseId: true },
  });
  if (!topic) throw new AppError(404, "NOT_FOUND", "Course or topic not found");
  return { courseId: topic.courseId, topicId: topic.id, topicName: topic.name };
}

async function getOutput(jobId: string): Promise<StoredJobOutput> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { output: true },
  });
  if (!job) throw new AppError(404, "NOT_FOUND", "Job not found");
  return parseStoredOutput(job.output);
}

async function writeOutput(
  jobId: string,
  output: StoredJobOutput,
  status?: LectureAutopilotStage,
): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: {
      output: JSON.stringify(output),
      ...(status ? { status } : {}),
      error: null,
    },
  });
}

async function setStage(
  jobId: string,
  stage: LectureAutopilotStage,
): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { status: stage, error: null },
  });
}

async function failInterruptedJobIfNeeded(
  userId: string,
  job: { id: string; status: string; output: string | null },
): Promise<void> {
  if (
    activeJobs.has(job.id) ||
    !INTERRUPTIBLE_JOB_STATUSES.has(job.status as LectureAutopilotStage)
  ) {
    return;
  }

  const output = {
    ...parseStoredOutput(job.output),
    failedStage: job.status as LectureAutopilotStage,
  };
  await prisma.job.updateMany({
    where: {
      id: job.id,
      userId,
      type: JOB_TYPE,
      status: job.status,
    },
    data: {
      status: "failed",
      output: JSON.stringify(output),
      error:
        "Lecture Autopilot was interrupted. The server does not retain raw audio; re-upload the same recording to retry.",
    },
  });
}

function splitTranscript(transcript: string): Array<{
  content: string;
  locatorLabel: string;
  charStart: number;
  charEnd: number;
}> {
  const segments: Array<{
    content: string;
    locatorLabel: string;
    charStart: number;
    charEnd: number;
  }> = [];
  let cursor = 0;

  while (cursor < transcript.length) {
    while (cursor < transcript.length && /\s/.test(transcript[cursor]))
      cursor += 1;
    if (cursor >= transcript.length) break;

    let end = Math.min(cursor + 2_000, transcript.length);
    if (end < transcript.length) {
      const sentenceEnd = Math.max(
        transcript.lastIndexOf(". ", end),
        transcript.lastIndexOf("? ", end),
        transcript.lastIndexOf("! ", end),
        transcript.lastIndexOf("\n", end),
      );
      if (sentenceEnd > cursor + 800) end = sentenceEnd + 1;
    }

    const raw = transcript.slice(cursor, end);
    const content = raw.trim();
    if (content) {
      const leadingWhitespace = raw.length - raw.trimStart().length;
      const start = cursor + leadingWhitespace;
      segments.push({
        content,
        locatorLabel: `Transcript segment ${segments.length + 1}`,
        charStart: start,
        charEnd: start + content.length,
      });
    }
    cursor = end;
  }

  if (segments.length === 0) {
    throw new LectureAutopilotStageError(
      "source-locking",
      "Transcript did not contain sourceable text",
    );
  }
  return segments;
}

async function ensureRecording(
  jobId: string,
  userId: string,
  input: StoredJobInput,
): Promise<string> {
  const recordingId = stableId(JOB_TYPE, jobId, "recording");
  await prisma.recording.upsert({
    where: { id: recordingId },
    create: {
      id: recordingId,
      userId,
      topicId: input.topicId,
      filename: `lecture-${jobId.slice(0, 12)}.m4a`,
      filepath: `ephemeral://lecture-autopilot/${jobId}`,
      durationSeconds: input.durationMinutes * 60,
      transcriptStatus: "processing",
    },
    update: {},
  });

  const output = await getOutput(jobId);
  if (output.recordingId !== recordingId) {
    await writeOutput(jobId, { ...output, recordingId });
  }
  return recordingId;
}

async function ensureTranscript(
  jobId: string,
  userId: string,
  input: StoredJobInput,
  recordingId: string,
  audioBase64: string,
): Promise<string> {
  await setStage(jobId, "transcribing");
  const recording = await prisma.recording.findFirst({
    where: { id: recordingId, userId, topicId: input.topicId },
    select: { transcript: true },
  });
  if (!recording) throw new AppError(404, "NOT_FOUND", "Recording not found");

  let transcript = recording.transcript?.trim() ?? "";
  if (!transcript) {
    transcript = await transcribeLectureAudio(audioBase64);
    const output = appendCompletedStage(await getOutput(jobId), "transcribing");
    // These are legacy compatibility copies used by existing screens and sync.
    // ensureSourceLock creates the immutable SourceLock revision immediately after.
    await prisma.$transaction([
      prisma.recording.update({
        where: { id: recordingId },
        data: { transcript, transcriptStatus: "completed" },
      }),
      prisma.topic.update({
        where: { id: input.topicId },
        data: { transcript, status: "transcribing" },
      }),
      prisma.job.update({
        where: { id: jobId },
        data: { output: JSON.stringify(output), error: null },
      }),
    ]);
  } else {
    await writeOutput(
      jobId,
      appendCompletedStage(await getOutput(jobId), "transcribing"),
    );
  }

  const output = await getOutput(jobId);
  if (!output.usageRecorded) {
    await incrementUsage(userId, "transcription", input.durationMinutes);
    await incrementUsage(userId, "recording", 1);
    await writeOutput(jobId, {
      ...(await getOutput(jobId)),
      usageRecorded: true,
    });
  }
  return transcript;
}

async function ensureSourceLock(
  jobId: string,
  userId: string,
  context: OwnedContext,
  recordingId: string,
  transcript: string,
): Promise<{
  sourceId: string;
  revisionId: string;
  segments: EvidenceSegment[];
}> {
  await setStage(jobId, "source-locking");
  let source = await prisma.source.findFirst({
    where: {
      recordingId,
      courseId: context.courseId,
      course: { userId },
    },
    select: { id: true },
  });

  if (!source) {
    try {
      const created = await createSource(userId, context.courseId, {
        kind: "LECTURE_TRANSCRIPT",
        title: `${context.topicName} lecture transcript`,
        topicId: context.topicId,
        recordingId,
        mimeType: "text/plain",
        segments: splitTranscript(transcript),
        generation: {
          operation: "lecture-autopilot-transcription",
          provider: USE_REAL_AI ? "openai" : "development",
          model: USE_REAL_AI ? "whisper" : "development",
        },
      });
      source = { id: created.id };
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2002"
      ) {
        throw error;
      }
      source = await prisma.source.findFirst({
        where: {
          recordingId,
          courseId: context.courseId,
          course: { userId },
        },
        select: { id: true },
      });
      if (!source) throw error;
    }
  }

  const detail = await getSource(userId, context.courseId, source.id);
  const revision = detail.revisions[0];
  const segments = revision.segments.map((segment) => ({
    id: segment.id,
    position: segment.position,
    content: segment.content,
  }));
  const output = appendCompletedStage(await getOutput(jobId), "source-locking");
  await writeOutput(jobId, {
    ...output,
    sourceId: detail.id,
    revisionId: revision.id,
    segmentIds: segments.map((segment) => segment.id),
  });
  return { sourceId: detail.id, revisionId: revision.id, segments };
}

async function ensureGenerationRun(
  jobId: string,
  courseId: string,
  operation: string,
): Promise<string> {
  const id = stableId(JOB_TYPE, jobId, operation);
  await prisma.generationRun.upsert({
    where: { id },
    create: {
      id,
      courseId,
      operation,
      provider: USE_REAL_AI ? "openai" : "development",
      model: USE_REAL_AI ? "gpt-4o-mini" : "development",
    },
    update: {},
  });
  return id;
}

async function generateNotesStage(
  jobId: string,
  userId: string,
  input: StoredJobInput,
  source: { sourceId: string; revisionId: string; segments: EvidenceSegment[] },
): Promise<void> {
  if (!input.materials.notes) return;
  await setStage(jobId, "generating-notes");
  let output = await getOutput(jobId);

  if (!output.notesWritten) {
    const generated = await generateLectureNotes(source.segments);
    const generationRunId = await ensureGenerationRun(
      jobId,
      input.courseId,
      "lecture-autopilot-notes",
    );
    output = {
      ...output,
      notesWritten: true,
      notesGenerationRunId: generationRunId,
      noteCitationSegmentIds: generated.citationSegmentIds,
    };
    await prisma.$transaction([
      prisma.topic.update({
        where: { id: input.topicId },
        data: { notes: generated.markdown },
      }),
      prisma.job.update({
        where: { id: jobId },
        data: { output: JSON.stringify(output), error: null },
      }),
    ]);
  }

  output = await getOutput(jobId);
  if (!output.notesComplete) {
    await createArtifactCitationsBatch(userId, input.courseId, {
      sourceId: source.sourceId,
      revisionId: source.revisionId,
      allowedSegmentIds: source.segments.map((segment) => segment.id),
      generationRunId: output.notesGenerationRunId,
      items: [
        {
          target: { kind: "TOPIC_NOTES", topicId: input.topicId },
          segmentIds: output.noteCitationSegmentIds ?? [],
        },
      ],
    });
    await writeOutput(jobId, {
      ...appendCompletedStage(output, "generating-notes"),
      notesComplete: true,
    });
  }
}

async function generateFlashcardsStage(
  jobId: string,
  userId: string,
  input: StoredJobInput,
  source: { sourceId: string; revisionId: string; segments: EvidenceSegment[] },
): Promise<void> {
  if (!input.materials.flashcards) return;
  await setStage(jobId, "generating-flashcards");
  let output = await getOutput(jobId);

  if (!output.flashcardsWritten) {
    const generated = await generateLectureFlashcards(source.segments);
    const generationRunId = await ensureGenerationRun(
      jobId,
      input.courseId,
      "lecture-autopilot-flashcards",
    );
    const cards = generated.map((card, index) => ({
      id: stableId(JOB_TYPE, jobId, "flashcard", String(index)),
      topicId: input.topicId,
      front: card.front,
      back: card.back,
      orderIndex: index,
    }));
    output = {
      ...output,
      flashcardsWritten: true,
      flashcardsGenerationRunId: generationRunId,
      flashcardIds: cards.map((card) => card.id),
      flashcardCitationPlan: generated.map((card, index) => ({
        artifactId: cards[index].id,
        segmentIds: card.citationSegmentIds,
      })),
    };
    await prisma.$transaction([
      prisma.flashcard.createMany({ data: cards, skipDuplicates: true }),
      prisma.job.update({
        where: { id: jobId },
        data: { output: JSON.stringify(output), error: null },
      }),
    ]);
  }

  output = await getOutput(jobId);
  if (!output.flashcardsComplete) {
    await createArtifactCitationsBatch(userId, input.courseId, {
      sourceId: source.sourceId,
      revisionId: source.revisionId,
      allowedSegmentIds: source.segments.map((segment) => segment.id),
      generationRunId: output.flashcardsGenerationRunId,
      items: (output.flashcardCitationPlan ?? []).map((plan) => ({
        target: { kind: "FLASHCARD", flashcardId: plan.artifactId },
        segmentIds: plan.segmentIds,
      })),
    });
    await writeOutput(jobId, {
      ...appendCompletedStage(output, "generating-flashcards"),
      flashcardsComplete: true,
    });
  }
}

async function generateQuizStage(
  jobId: string,
  userId: string,
  input: StoredJobInput,
  source: { sourceId: string; revisionId: string; segments: EvidenceSegment[] },
  topicName: string,
): Promise<void> {
  if (!input.materials.quiz) return;
  await setStage(jobId, "generating-quiz");
  let output = await getOutput(jobId);

  if (!output.quizWritten) {
    const generated = await generateLectureQuiz(source.segments);
    const generationRunId = await ensureGenerationRun(
      jobId,
      input.courseId,
      "lecture-autopilot-quiz",
    );
    const quizId = stableId(JOB_TYPE, jobId, "quiz");
    const questions = generated.map((question, index) => ({
      id: stableId(JOB_TYPE, jobId, "quiz-question", String(index)),
      quizId,
      question: question.question,
      options: JSON.stringify(question.options),
      correctAnswer: question.correctAnswer,
      explanation: question.explanation,
      orderIndex: index,
    }));
    output = {
      ...output,
      quizWritten: true,
      quizGenerationRunId: generationRunId,
      quizId,
      quizQuestionIds: questions.map((question) => question.id),
      quizCitationPlan: generated.map((question, index) => ({
        artifactId: questions[index].id,
        segmentIds: question.citationSegmentIds,
      })),
    };
    await prisma.$transaction([
      prisma.quiz.upsert({
        where: { id: quizId },
        create: {
          id: quizId,
          topicId: input.topicId,
          title: `Quiz: ${topicName}`,
        },
        update: {},
      }),
      prisma.quizQuestion.createMany({ data: questions, skipDuplicates: true }),
      prisma.job.update({
        where: { id: jobId },
        data: { output: JSON.stringify(output), error: null },
      }),
    ]);
  }

  output = await getOutput(jobId);
  if (!output.quizComplete) {
    await createArtifactCitationsBatch(userId, input.courseId, {
      sourceId: source.sourceId,
      revisionId: source.revisionId,
      allowedSegmentIds: source.segments.map((segment) => segment.id),
      generationRunId: output.quizGenerationRunId,
      items: (output.quizCitationPlan ?? []).map((plan) => ({
        target: { kind: "QUIZ_QUESTION", quizQuestionId: plan.artifactId },
        segmentIds: plan.segmentIds,
      })),
    });
    await writeOutput(jobId, {
      ...appendCompletedStage(output, "generating-quiz"),
      quizComplete: true,
    });
  }
}

async function runLectureAutopilot(
  jobId: string,
  userId: string,
  audioBase64: string,
): Promise<void> {
  try {
    const job = await prisma.job.findFirst({
      where: { id: jobId, userId, type: JOB_TYPE },
    });
    if (!job) throw new AppError(404, "NOT_FOUND", "Job not found");
    const input = parseStoredInput(job.input);
    if (audioHash(audioBase64) !== input.audioHash) {
      throw new AppError(
        400,
        "AUDIO_MISMATCH",
        "Retry audio does not match the job",
      );
    }
    const context = await assertOwnedContext(
      userId,
      input.courseId,
      input.topicId,
    );
    const recordingId = await ensureRecording(jobId, userId, input);
    const transcript = await ensureTranscript(
      jobId,
      userId,
      input,
      recordingId,
      audioBase64,
    );
    const source = await ensureSourceLock(
      jobId,
      userId,
      context,
      recordingId,
      transcript,
    );
    await generateNotesStage(jobId, userId, input, source);
    await generateFlashcardsStage(jobId, userId, input, source);
    await generateQuizStage(jobId, userId, input, source, context.topicName);

    const output = appendCompletedStage(await getOutput(jobId), "complete");
    await prisma.$transaction([
      prisma.topic.update({
        where: { id: input.topicId },
        data: { status: "completed" },
      }),
      prisma.recording.update({
        where: { id: recordingId },
        data: { transcriptStatus: "completed" },
      }),
      prisma.job.update({
        where: { id: jobId },
        data: {
          status: "complete",
          output: JSON.stringify(output),
          error: null,
        },
      }),
    ]);
  } catch (error) {
    console.error("[Lecture Autopilot] pipeline failed:", error);
    const current = await prisma.job.findUnique({
      where: { id: jobId },
      select: { status: true, output: true, input: true },
    });
    if (current) {
      const stage =
        error instanceof LectureAutopilotStageError
          ? error.stage
          : (current.status as LectureAutopilotStage);
      const safeMessage =
        error instanceof AppError || error instanceof LectureAutopilotStageError
          ? error.message
          : "Lecture Autopilot failed";
      const output = {
        ...parseStoredOutput(current.output),
        failedStage: stage,
      };
      const input = parseStoredInput(current.input);
      await prisma.$transaction([
        prisma.topic.updateMany({
          where: { id: input.topicId, userId },
          data: { status: "pending" },
        }),
        prisma.job.update({
          where: { id: jobId },
          data: {
            status: "failed",
            output: JSON.stringify(output),
            error: safeMessage,
          },
        }),
      ]);
    }
  } finally {
    activeJobs.delete(jobId);
  }
}

export function queueLectureAutopilot(
  jobId: string,
  userId: string,
  audioBase64: string,
): void {
  if (activeJobs.has(jobId)) return;
  activeJobs.add(jobId);
  setImmediate(() => {
    void runLectureAutopilot(jobId, userId, audioBase64);
  });
}

export async function startLectureAutopilot(
  userId: string,
  courseId: string,
  topicId: string,
  request: LectureAutopilotInput,
) {
  await assertOwnedContext(userId, courseId, topicId);
  const hash = audioHash(request.audioBase64);
  const jobId = stableId(
    JOB_TYPE,
    String(PIPELINE_VERSION),
    userId,
    courseId,
    topicId,
    hash,
  );
  const input: StoredJobInput = {
    version: PIPELINE_VERSION,
    courseId,
    topicId,
    durationMinutes: request.durationMinutes,
    audioHash: hash,
    materials: request.materials,
  };

  try {
    await prisma.job.create({
      data: {
        id: jobId,
        userId,
        type: JOB_TYPE,
        status: "queued",
        input: JSON.stringify(input),
        output: JSON.stringify({
          version: PIPELINE_VERSION,
          completedStages: [],
        }),
      },
    });
  } catch (error) {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== "P2002"
    ) {
      throw error;
    }
    const existing = await prisma.job.findFirst({
      where: { id: jobId, userId, type: JOB_TYPE },
    });
    if (!existing) throw error;
    const existingInput = parseStoredInput(existing.input);
    if (
      existingInput.courseId !== courseId ||
      existingInput.topicId !== topicId ||
      existingInput.audioHash !== hash ||
      !sameMaterials(existingInput.materials, request.materials)
    ) {
      throw new AppError(409, "JOB_CONFLICT", "Lecture job identity conflict");
    }
    if (existing.status === "failed") {
      await prisma.job.update({
        where: { id: jobId },
        data: { status: "queued", error: null },
      });
    }
  }

  queueLectureAutopilot(jobId, userId, request.audioBase64);
  return getLectureAutopilotJob(userId, jobId);
}

export async function retryLectureAutopilot(
  userId: string,
  jobId: string,
  audioBase64: string,
) {
  const job = await prisma.job.findFirst({
    where: { id: jobId, userId, type: JOB_TYPE },
  });
  if (!job) throw new AppError(404, "NOT_FOUND", "Job not found");
  await failInterruptedJobIfNeeded(userId, job);
  const input = parseStoredInput(job.input);
  await assertOwnedContext(userId, input.courseId, input.topicId);
  if (audioHash(audioBase64) !== input.audioHash) {
    throw new AppError(
      400,
      "AUDIO_MISMATCH",
      "Retry audio does not match the job",
    );
  }
  if (job.status !== "complete") {
    await prisma.job.update({
      where: { id: jobId },
      data: { status: "queued", error: null },
    });
    queueLectureAutopilot(jobId, userId, audioBase64);
  }
  return getLectureAutopilotJob(userId, jobId);
}

async function buildResult(
  userId: string,
  input: StoredJobInput,
  output: StoredJobOutput,
): Promise<LectureAutopilotResultDto | null> {
  if (!output.recordingId || !output.sourceId || !output.revisionId)
    return null;
  const [topic, recording, flashcards, quiz] = await Promise.all([
    prisma.topic.findFirst({
      where: { id: input.topicId, userId, courseId: input.courseId },
      select: { transcript: true, notes: true },
    }),
    prisma.recording.findFirst({
      where: { id: output.recordingId, userId, topicId: input.topicId },
      select: { id: true, durationSeconds: true },
    }),
    output.flashcardIds?.length
      ? prisma.flashcard.findMany({
          where: {
            id: { in: output.flashcardIds },
            topic: { id: input.topicId, userId, courseId: input.courseId },
          },
          orderBy: { orderIndex: "asc" },
          select: { id: true, front: true, back: true, orderIndex: true },
        })
      : [],
    output.quizId
      ? prisma.quiz.findFirst({
          where: {
            id: output.quizId,
            topic: { id: input.topicId, userId, courseId: input.courseId },
          },
          select: {
            id: true,
            title: true,
            questions: {
              orderBy: { orderIndex: "asc" },
              select: {
                id: true,
                question: true,
                options: true,
                correctAnswer: true,
                explanation: true,
                orderIndex: true,
              },
            },
          },
        })
      : null,
  ]);
  if (!topic || !recording || !topic.transcript) return null;

  return {
    courseId: input.courseId,
    topicId: input.topicId,
    recording,
    source: {
      id: output.sourceId,
      revisionId: output.revisionId,
      segmentIds: output.segmentIds ?? [],
    },
    transcript: topic.transcript,
    notes: input.materials.notes ? topic.notes : null,
    flashcards,
    quiz: quiz
      ? {
          id: quiz.id,
          title: quiz.title,
          questions: quiz.questions.map((question) => ({
            ...question,
            options: JSON.parse(question.options) as string[],
          })),
        }
      : null,
  };
}

export async function getLectureAutopilotJob(
  userId: string,
  jobId: string,
): Promise<LectureAutopilotJobDto> {
  let job = await prisma.job.findFirst({
    where: { id: jobId, userId, type: JOB_TYPE },
  });
  if (!job) throw new AppError(404, "NOT_FOUND", "Job not found");
  await failInterruptedJobIfNeeded(userId, job);
  job = await prisma.job.findFirst({
    where: { id: jobId, userId, type: JOB_TYPE },
  });
  if (!job) throw new AppError(404, "NOT_FOUND", "Job not found");
  const input = parseStoredInput(job.input);
  await assertOwnedContext(userId, input.courseId, input.topicId);
  const output = parseStoredOutput(job.output);
  const status = job.status as LectureAutopilotStage;
  return {
    id: job.id,
    type: JOB_TYPE,
    status,
    completedStages: output.completedStages,
    failedStage: output.failedStage ?? null,
    error: job.error,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    result:
      status === "complete" ? await buildResult(userId, input, output) : null,
  };
}
