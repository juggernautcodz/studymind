import { z } from "zod";

export const topicIdParams = z.object({
  topicId: z.string().min(1, "topicId is required"),
});

export const quizIdParams = z.object({
  quizId: z.string().min(1, "quizId is required"),
});

export const jobIdParams = z.object({
  jobId: z.string().min(1, "jobId is required"),
});

export const ocrExtractBody = z.object({
  imageBase64: z.string().min(1, "imageBase64 is required"),
  topicId: z.string().optional(),
  fileType: z.string().optional(),
});

export const summarizeBody = z.object({
  text: z.string().min(1, "Text is required").max(50000, "Text too long"),
});

export const notesToFlashcardsBody = z.object({
  text: z.string().min(1, "Text is required").max(50000, "Text too long"),
  topicId: z.string().optional(),
});

export const notesToQuizBody = z.object({
  text: z.string().min(1, "Text is required").max(50000, "Text too long"),
  topicId: z.string().optional(),
});

export const quizSubmitBody = z.object({
  answers: z.record(z.string(), z.number()),
  submissionId: z.string().uuid().optional(),
});

export const videoExtractBody = z.object({
  videoBase64: z.string().min(1, "videoBase64 is required"),
  topicId: z.string().optional(),
});

export const videoUrlBody = z.object({
  videoUrl: z.string().url("A valid URL is required"),
  topicId: z.string().optional(),
});

export const createSemesterBody = z.object({
  name: z
    .string()
    .min(1, "Semester name is required")
    .max(200, "Name too long"),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export const createCourseBody = z.object({
  semesterId: z.string().min(1, "Semester ID is required"),
  name: z.string().min(1, "Course name is required").max(200, "Name too long"),
  color: z.string().optional(),
});

export const createTopicBody = z.object({
  courseId: z.string().min(1, "Course ID is required"),
  name: z.string().min(1, "Topic name is required").max(200, "Name too long"),
});
