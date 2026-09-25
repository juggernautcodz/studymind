import { z } from "zod";

import type { LectureAutopilotStage } from "../../shared/lecture-autopilot";
import {
  ensureCompatibleFormat,
  speechToText,
} from "../replit_integrations/audio/client";
import { IS_PRODUCTION, openai } from "./ai-runtime";

export interface EvidenceSegment {
  id: string;
  position: number;
  content: string;
}

const citationIds = z.array(z.string().min(1)).min(1).max(12);
const notesSchema = z
  .object({
    markdown: z.string().min(1).max(100_000),
    citationSegmentIds: citationIds,
  })
  .strict();
const flashcardsSchema = z
  .array(
    z
      .object({
        front: z.string().trim().min(1).max(500),
        back: z.string().trim().min(1).max(2_000),
        citationSegmentIds: citationIds,
      })
      .strict(),
  )
  .min(1)
  .max(20);
const quizSchema = z
  .array(
    z
      .object({
        question: z.string().trim().min(1).max(1_000),
        options: z.array(z.string().trim().min(1).max(500)).length(4),
        correctAnswer: z.number().int().min(0).max(3),
        explanation: z.string().trim().min(1).max(2_000),
        citationSegmentIds: citationIds,
      })
      .strict(),
  )
  .min(1)
  .max(20);

export type GeneratedNotes = z.infer<typeof notesSchema>;
export type GeneratedFlashcards = z.infer<typeof flashcardsSchema>;
export type GeneratedQuiz = z.infer<typeof quizSchema>;

export class LectureAutopilotStageError extends Error {
  constructor(
    public readonly stage: LectureAutopilotStage,
    message: string,
  ) {
    super(message);
    this.name = "LectureAutopilotStageError";
  }
}

function parseJsonContent(content: string): unknown {
  return JSON.parse(content.replace(/```json\n?|\n?```/g, "").trim());
}

function assertAllowedCitations(
  values: readonly { citationSegmentIds: readonly string[] }[],
  segments: readonly EvidenceSegment[],
): void {
  const allowed = new Set(segments.map((segment) => segment.id));
  for (const value of values) {
    if (
      new Set(value.citationSegmentIds).size !==
        value.citationSegmentIds.length ||
      value.citationSegmentIds.some((id) => !allowed.has(id))
    ) {
      throw new Error(
        "AI response cited a source segment outside the allowed set",
      );
    }
  }
}

function segmentPrompt(segments: readonly EvidenceSegment[]): string {
  return segments
    .map((segment) => `[segment:${segment.id}]\n${segment.content}`)
    .join("\n\n");
}

function devNotes(segments: readonly EvidenceSegment[]): GeneratedNotes {
  const cited = segments.slice(0, Math.min(6, segments.length));
  return {
    markdown: [
      "# Lecture Notes",
      "",
      ...cited.map((segment) => `- ${segment.content}`),
    ].join("\n"),
    citationSegmentIds: cited.map((segment) => segment.id),
  };
}

function devFlashcards(
  segments: readonly EvidenceSegment[],
): GeneratedFlashcards {
  return segments
    .slice(0, Math.min(8, segments.length))
    .map((segment, index) => ({
      front: `What is a key point from lecture section ${index + 1}?`,
      back: segment.content,
      citationSegmentIds: [segment.id],
    }));
}

function devQuiz(segments: readonly EvidenceSegment[]): GeneratedQuiz {
  return segments
    .slice(0, Math.min(5, segments.length))
    .map((segment, index) => ({
      question: `Which statement matches lecture section ${index + 1}?`,
      options: [
        segment.content,
        "This statement was not supported by the lecture.",
        "The lecture stated the opposite.",
        "The lecture did not discuss this section.",
      ],
      correctAnswer: 0,
      explanation: "The first option is the cited lecture evidence.",
      citationSegmentIds: [segment.id],
    }));
}

async function structuredCompletion<T>(
  stage: LectureAutopilotStage,
  system: string,
  user: string,
  schema: z.ZodType<T>,
): Promise<T> {
  if (!openai) {
    throw new LectureAutopilotStageError(
      stage,
      IS_PRODUCTION
        ? "AI service is unavailable"
        : "AI service is not configured",
    );
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.3,
      max_tokens: 3_000,
    });
    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("AI returned an empty response");
    return schema.parse(parseJsonContent(content));
  } catch (error) {
    console.error(`[Lecture Autopilot] ${stage} failed:`, error);
    throw new LectureAutopilotStageError(
      stage,
      `Lecture Autopilot failed during ${stage}`,
    );
  }
}

export async function transcribeLectureAudio(
  audioBase64: string,
): Promise<string> {
  if (!openai) {
    if (IS_PRODUCTION) {
      throw new LectureAutopilotStageError(
        "transcribing",
        "AI transcription is unavailable",
      );
    }
    return "Development transcription placeholder derived from the captured lecture audio. Configure the AI provider to verify real transcription.";
  }

  try {
    const rawBuffer = Buffer.from(audioBase64, "base64");
    const { buffer, format } = await ensureCompatibleFormat(rawBuffer);
    const transcript = (await speechToText(buffer, format)).trim();
    if (!transcript) throw new Error("Transcription returned no text");
    if (transcript.length > 250_000) {
      throw new Error("Transcript exceeds the SourceLock content limit");
    }
    return transcript;
  } catch (error) {
    console.error("[Lecture Autopilot] transcription failed:", error);
    throw new LectureAutopilotStageError(
      "transcribing",
      "Lecture transcription failed",
    );
  }
}

export async function generateLectureNotes(
  segments: readonly EvidenceSegment[],
): Promise<GeneratedNotes> {
  if (!openai && !IS_PRODUCTION) return devNotes(segments);
  const result = await structuredCompletion(
    "generating-notes",
    `Create accurate, structured Markdown lecture notes. Return only JSON with
{"markdown":"...","citationSegmentIds":["..."]}. Cite only segment IDs supplied by the user.`,
    segmentPrompt(segments),
    notesSchema,
  );
  assertAllowedCitations([result], segments);
  return result;
}

export async function generateLectureFlashcards(
  segments: readonly EvidenceSegment[],
): Promise<GeneratedFlashcards> {
  if (!openai && !IS_PRODUCTION) return devFlashcards(segments);
  const result = await structuredCompletion(
    "generating-flashcards",
    `Create 8-12 accurate study flashcards. Return only a JSON array. Every item must have
{"front":"...","back":"...","citationSegmentIds":["..."]}. Cite only supplied segment IDs.`,
    segmentPrompt(segments),
    flashcardsSchema,
  );
  assertAllowedCitations(result, segments);
  return result;
}

export async function generateLectureQuiz(
  segments: readonly EvidenceSegment[],
): Promise<GeneratedQuiz> {
  if (!openai && !IS_PRODUCTION) return devQuiz(segments);
  const result = await structuredCompletion(
    "generating-quiz",
    `Create 5-7 multiple-choice questions grounded in the lecture. Return only a JSON array.
Every item must have {"question":"...","options":["...","...","...","..."],
"correctAnswer":0,"explanation":"...","citationSegmentIds":["..."]}.
Cite only supplied segment IDs.`,
    segmentPrompt(segments),
    quizSchema,
  );
  assertAllowedCitations(result, segments);
  return result;
}
