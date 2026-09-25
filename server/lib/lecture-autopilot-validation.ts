import { z } from "zod";

const id = z.string().min(1).max(100);

export const lectureAutopilotParams = z.object({
  courseId: id,
  topicId: id,
});

export const lectureAutopilotJobParams = z.object({
  jobId: z.string().length(64),
});

export const lectureAutopilotMaterials = z.object({
  notes: z.boolean().default(true),
  flashcards: z.boolean().default(true),
  quiz: z.boolean().default(true),
});

export const lectureAutopilotBody = z.object({
  audioBase64: z
    .string()
    .min(1, "audioBase64 is required")
    .max(60_000_000, "Audio payload is too large"),
  durationMinutes: z.number().finite().positive().max(480),
  materials: lectureAutopilotMaterials.default({
    notes: true,
    flashcards: true,
    quiz: true,
  }),
});

export const lectureAutopilotRetryBody = lectureAutopilotBody.pick({
  audioBase64: true,
});

export type LectureAutopilotInput = z.infer<typeof lectureAutopilotBody>;
