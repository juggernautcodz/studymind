import { Router, Response, NextFunction } from "express";
import prisma from "./db";
import { authMiddleware, AuthRequest, guestOrAuthMiddleware } from "./auth";
import { checkUsageLimits, incrementUsage } from "./middleware";
import { rateLimit } from "./lib/rate-limit";
import { validateBody, validateParams } from "./lib/validate";
import {
  topicIdParams,
  quizIdParams,
  jobIdParams,
  ocrExtractBody,
  summarizeBody,
  notesToFlashcardsBody,
  notesToQuizBody,
  quizSubmitBody,
  videoExtractBody,
  videoUrlBody,
} from "./lib/validation-schemas";
import {
  ANONYMOUS_USER_ID,
  AI_RATE_LIMIT,
  TRANSCRIPTION_RATE_LIMIT,
} from "./constants";
import OpenAI from "openai";
import {
  speechToText,
  ensureCompatibleFormat,
} from "./replit_integrations/audio/client";

const router = Router();

const aiRateLimit = rateLimit("ai-general", AI_RATE_LIMIT);
const transcriptionRateLimit = rateLimit(
  "ai-transcription",
  TRANSCRIPTION_RATE_LIMIT,
);

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const USE_REAL_AI = !!(
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY &&
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
);

console.log(
  `[AI Providers] USE_REAL_AI = ${USE_REAL_AI}, IS_PRODUCTION = ${IS_PRODUCTION}`,
);
if (USE_REAL_AI) {
  console.log("[AI Providers] Real AI transcription and generation enabled");
} else if (IS_PRODUCTION) {
  console.error(
    "[AI Providers] WARNING: Production mode without AI keys — AI endpoints will return 503",
  );
} else {
  console.log("[AI Providers] Running in mock mode (dev only)");
}

const openai = USE_REAL_AI
  ? new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    })
  : null;

const AI_UNAVAILABLE_RESPONSE = {
  error: "AI temporarily unavailable",
  code: "AI_UNAVAILABLE",
};

function requireAI(req: AuthRequest, res: Response, next: NextFunction) {
  if (!USE_REAL_AI && IS_PRODUCTION) {
    res.status(503).json(AI_UNAVAILABLE_RESPONSE);
    return;
  }
  next();
}

const MOCK_TRANSCRIPTIONS = [
  "Today we're going to discuss the fundamental principles of cellular biology. The cell is the basic unit of life, and understanding its structure is crucial for biology students. Let's start with the cell membrane, which is a phospholipid bilayer that controls what enters and exits the cell.",
  "In this lecture, we'll explore the French Revolution and its impact on modern democracy. The revolution began in 1789 with the storming of the Bastille. Key figures include Robespierre, Danton, and Napoleon Bonaparte.",
  "Welcome to Introduction to Calculus. Today we'll cover derivatives and their applications. The derivative represents the rate of change of a function. Remember, the derivative of x^n is nx^(n-1).",
  "This session focuses on organic chemistry reactions. We'll study nucleophilic substitution reactions, specifically SN1 and SN2 mechanisms. Understanding the difference between these mechanisms is essential for predicting reaction outcomes.",
  "Today's topic is macroeconomics and GDP calculation. Gross Domestic Product measures the total value of goods and services produced in a country. We use the formula GDP = C + I + G + (X-M).",
];

const generateMockNotes = (transcript: string): string => {
  const lines = transcript.split(". ");
  const keyPoints = lines
    .slice(0, 5)
    .map((line, i) => `${i + 1}. ${line.trim()}`);

  return `# Lecture Notes

## Key Concepts
${keyPoints.join("\n")}

## Summary
This lecture covered important topics related to the subject matter. The main takeaways include understanding fundamental concepts and their practical applications.

## Important Terms
- Term 1: Definition based on lecture content
- Term 2: Another key concept explained
- Term 3: Additional terminology covered

## Review Questions
1. What are the main concepts discussed in this lecture?
2. How do these concepts relate to previous material?
3. What are the practical applications?
`;
};

const generateMockFlashcards = (
  transcript: string,
): Array<{ front: string; back: string }> => {
  return [
    {
      front: "What is the main topic of this lecture?",
      back: "The lecture covers fundamental concepts and their applications in the field.",
    },
    {
      front: "Define the primary concept discussed",
      back: "The primary concept refers to the foundational principle that underlies the subject matter.",
    },
    {
      front: "What are the key components?",
      back: "The key components include structure, function, and interaction between elements.",
    },
    {
      front: "How does this relate to previous topics?",
      back: "This builds upon earlier material by extending concepts and introducing new applications.",
    },
    {
      front: "What is the practical application?",
      back: "These concepts are applied in real-world scenarios to solve problems and make decisions.",
    },
  ];
};

const generateMockQuiz = (
  transcript: string,
): Array<{
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
}> => {
  return [
    {
      question: "What is the main focus of this lecture?",
      options: [
        "Historical events",
        "Scientific principles",
        "Mathematical concepts",
        "All of the above",
      ],
      correctAnswer: 3,
      explanation:
        "The lecture covers various aspects including historical context, scientific principles, and mathematical foundations.",
    },
    {
      question: "Which of the following best describes the core concept?",
      options: [
        "A simple definition",
        "A complex theory",
        "A practical application",
        "A fundamental principle",
      ],
      correctAnswer: 3,
      explanation:
        "The core concept is a fundamental principle that forms the basis for understanding the subject.",
    },
    {
      question: "How are these concepts typically applied?",
      options: [
        "In theoretical research only",
        "In practical scenarios",
        "Never applied",
        "Only in exams",
      ],
      correctAnswer: 1,
      explanation:
        "These concepts have practical applications in real-world scenarios.",
    },
    {
      question: "What prerequisite knowledge is helpful?",
      options: [
        "None required",
        "Basic understanding of the field",
        "Advanced expertise",
        "Professional experience",
      ],
      correctAnswer: 1,
      explanation:
        "A basic understanding of the field helps in grasping these concepts more effectively.",
    },
  ];
};

async function generateNotesWithAI(transcript: string): Promise<string> {
  if (!openai) return generateMockNotes(transcript);

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are an expert academic note-taker. Create comprehensive, well-structured lecture notes from the provided transcript. Include:
- Main headings and subheadings
- Key concepts with clear explanations
- Important definitions and terms
- Summary of main points
- Review questions for self-study
Use Markdown formatting.`,
        },
        {
          role: "user",
          content: `Create detailed study notes from this lecture transcript:\n\n${transcript}`,
        },
      ],
      max_tokens: 2000,
      temperature: 0.7,
    });

    return (
      response.choices[0]?.message?.content || generateMockNotes(transcript)
    );
  } catch (error) {
    console.error("AI notes generation failed:", error);
    if (IS_PRODUCTION) throw error;
    return generateMockNotes(transcript);
  }
}

async function generateFlashcardsWithAI(
  transcript: string,
): Promise<Array<{ front: string; back: string }>> {
  if (!openai) return generateMockFlashcards(transcript);

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are an expert educational content creator. Create flashcards from the lecture transcript.
Each flashcard should:
- Have a clear, focused question on the front
- Have a concise, accurate answer on the back
- Cover key concepts, definitions, and important facts
- Be suitable for spaced repetition study

Return a JSON array of objects with "front" and "back" properties.
Example: [{"front": "What is...?", "back": "It is..."}]
Return ONLY valid JSON, no markdown or explanation.`,
        },
        {
          role: "user",
          content: `Create 8-12 flashcards from this lecture:\n\n${transcript}`,
        },
      ],
      max_tokens: 1500,
      temperature: 0.7,
    });

    const content = response.choices[0]?.message?.content || "[]";
    const cleanContent = content.replace(/```json\n?|\n?```/g, "").trim();
    const flashcards = JSON.parse(cleanContent);
    return Array.isArray(flashcards)
      ? flashcards
      : generateMockFlashcards(transcript);
  } catch (error) {
    console.error("AI flashcard generation failed:", error);
    if (IS_PRODUCTION) throw error;
    return generateMockFlashcards(transcript);
  }
}

async function generateQuizWithAI(transcript: string): Promise<
  Array<{
    question: string;
    options: string[];
    correctAnswer: number;
    explanation: string;
  }>
> {
  if (!openai) return generateMockQuiz(transcript);

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are an expert educational assessment creator. Create a multiple-choice quiz from the lecture transcript.
Each question should:
- Test understanding of key concepts
- Have 4 answer options
- Have one clearly correct answer
- Include an explanation for the correct answer

Return a JSON array of objects with:
- "question": the question text
- "options": array of 4 answer choices
- "correctAnswer": index of correct answer (0-3)
- "explanation": why this answer is correct

Return ONLY valid JSON, no markdown or explanation.`,
        },
        {
          role: "user",
          content: `Create a 5-7 question quiz from this lecture:\n\n${transcript}`,
        },
      ],
      max_tokens: 2000,
      temperature: 0.7,
    });

    const content = response.choices[0]?.message?.content || "[]";
    const cleanContent = content.replace(/```json\n?|\n?```/g, "").trim();
    const quiz = JSON.parse(cleanContent);
    return Array.isArray(quiz) ? quiz : generateMockQuiz(transcript);
  } catch (error) {
    console.error("AI quiz generation failed:", error);
    if (IS_PRODUCTION) throw error;
    return generateMockQuiz(transcript);
  }
}

router.post(
  "/transcription/request",
  guestOrAuthMiddleware,
  requireAI,
  transcriptionRateLimit,
  checkUsageLimits("recording"),
  checkUsageLimits("transcription"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { topicId, durationMinutes = 5, audioBase64 } = req.body;

      if (!topicId) {
        return res.status(400).json({ error: "topicId is required" });
      }

      const topic = await prisma.topic.findFirst({
        where: { id: topicId, userId: req.user?.id ?? ANONYMOUS_USER_ID },
      });

      if (!topic) {
        return res.status(404).json({ error: "Topic not found" });
      }

      const job = await prisma.job.create({
        data: {
          type: "transcription",
          status: "processing",
          input: JSON.stringify({ topicId, durationMinutes }),
        },
      });

      (async () => {
        try {
          let transcript: string;

          if (audioBase64 && USE_REAL_AI) {
            const rawBuffer = Buffer.from(audioBase64, "base64");
            const { buffer: audioBuffer, format } =
              await ensureCompatibleFormat(rawBuffer);
            transcript = await speechToText(audioBuffer, format);
          } else {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            transcript =
              MOCK_TRANSCRIPTIONS[
                Math.floor(Math.random() * MOCK_TRANSCRIPTIONS.length)
              ];
          }

          await prisma.topic.update({
            where: { id: topicId },
            data: { transcript },
          });

          await prisma.job.update({
            where: { id: job.id },
            data: {
              status: "completed",
              output: JSON.stringify({ transcript }),
            },
          });

          await incrementUsage(
            req.user?.id ?? ANONYMOUS_USER_ID,
            "transcription",
            durationMinutes,
          );
          await incrementUsage(
            req.user?.id ?? ANONYMOUS_USER_ID,
            "recording",
            1,
          );
        } catch (error) {
          console.error("Transcription processing error:", error);
          await prisma.job.update({
            where: { id: job.id },
            data: {
              status: "failed",
              error:
                error instanceof Error ? error.message : "Transcription failed",
            },
          });
        }
      })();

      res.json({
        jobId: job.id,
        status: "processing",
        message: USE_REAL_AI
          ? "Transcription started"
          : "Transcription started (mock)",
      });
    } catch (error) {
      console.error("Transcription request error:", error);
      res.status(500).json({ error: "Failed to start transcription" });
    }
  },
);

router.post(
  "/transcription/upload",
  guestOrAuthMiddleware,
  requireAI,
  transcriptionRateLimit,
  checkUsageLimits("recording"),
  checkUsageLimits("transcription"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { audioBase64, durationMinutes = 5 } = req.body || {};

      if (!audioBase64) {
        return res.status(400).json({ error: "audioBase64 is required" });
      }

      const userId = req.user?.id ?? ANONYMOUS_USER_ID;

      const job = await prisma.job.create({
        data: {
          userId,
          type: "transcription",
          status: "processing",
          input: JSON.stringify({ durationMinutes }),
        },
      });

      (async () => {
        try {
          let transcript: string;

          if (USE_REAL_AI) {
            const rawBuffer = Buffer.from(audioBase64, "base64");
            const { buffer: audioBuffer, format } =
              await ensureCompatibleFormat(rawBuffer);
            transcript = await speechToText(audioBuffer, format);
          } else {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            transcript =
              MOCK_TRANSCRIPTIONS[
                Math.floor(Math.random() * MOCK_TRANSCRIPTIONS.length)
              ];
          }

          await prisma.job.update({
            where: { id: job.id },
            data: {
              status: "completed",
              output: JSON.stringify({ transcript }),
            },
          });

          await incrementUsage(userId, "transcription", durationMinutes);
          await incrementUsage(userId, "recording", 1);
        } catch (error) {
          console.error("Transcription upload processing error:", error);
          await prisma.job.update({
            where: { id: job.id },
            data: {
              status: "failed",
              error:
                error instanceof Error ? error.message : "Transcription failed",
            },
          });
        }
      })();

      res.json({
        jobId: job.id,
        status: "processing",
        message: USE_REAL_AI
          ? "Transcription started"
          : "Transcription started (mock)",
      });
    } catch (error) {
      console.error("Transcription upload error:", error);
      const details = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        error: "Failed to start transcription",
        details,
      });
    }
  },
);

router.post(
  "/transcription/attach",
  guestOrAuthMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const { jobId, topicId } = req.body || {};

      if (!jobId || !topicId) {
        return res
          .status(400)
          .json({ error: "jobId and topicId are required" });
      }

      const userId = req.user?.id ?? ANONYMOUS_USER_ID;

      const job = await prisma.job.findFirst({
        where: { id: jobId, userId },
      });
      if (!job) {
        return res.status(404).json({ error: "Job not found" });
      }
      if (job.status !== "completed") {
        return res
          .status(400)
          .json({ error: "Job not completed yet", status: job.status });
      }

      const topic = await prisma.topic.findFirst({
        where: { id: topicId, userId },
      });
      if (!topic) {
        return res.status(404).json({ error: "Topic not found" });
      }

      let transcript = "";
      try {
        const output = JSON.parse(job.output || "{}");
        transcript = output.transcript || "";
      } catch {}

      if (!transcript) {
        return res
          .status(400)
          .json({ error: "Job has no transcript output" });
      }

      await prisma.topic.update({
        where: { id: topicId },
        data: { transcript, status: "completed" },
      });

      res.json({ success: true, topicId, transcript });
    } catch (error) {
      console.error("Transcription attach error:", error);
      res.status(500).json({
        error: "Failed to attach transcription",
      });
    }
  },
);

router.post(
  "/topics/:topicId/notes/generate",
  guestOrAuthMiddleware,
  requireAI,
  aiRateLimit,
  validateParams(topicIdParams),
  async (req: AuthRequest, res: Response) => {
    try {
      const topicId = req.params.topicId as string;

      const topic = await prisma.topic.findFirst({
        where: { id: topicId, userId: req.user?.id ?? ANONYMOUS_USER_ID },
      });

      if (!topic) {
        return res.status(404).json({ error: "Topic not found" });
      }

      const transcript =
        topic.transcript || "Default lecture content for note generation.";
      const notes = await generateNotesWithAI(transcript);

      await prisma.topic.update({
        where: { id: topicId },
        data: { notes },
      });

      res.json({
        notes,
        message: USE_REAL_AI
          ? "Notes generated successfully"
          : "Notes generated successfully (mock)",
      });
    } catch (error) {
      console.error("Generate notes error:", error);
      res.status(500).json({ error: "Failed to generate notes" });
    }
  },
);

router.post(
  "/topics/:topicId/flashcards/generate",
  guestOrAuthMiddleware,
  requireAI,
  aiRateLimit,
  validateParams(topicIdParams),
  async (req: AuthRequest, res: Response) => {
    try {
      const topicId = req.params.topicId as string;

      const topic = await prisma.topic.findFirst({
        where: { id: topicId, userId: req.user?.id ?? ANONYMOUS_USER_ID },
      });

      if (!topic) {
        return res.status(404).json({ error: "Topic not found" });
      }

      const transcript = topic.transcript || "Default content";
      const aiFlashcards = await generateFlashcardsWithAI(transcript);

      const flashcards = await Promise.all(
        aiFlashcards.map((fc, index) =>
          prisma.flashcard.create({
            data: {
              topicId,
              front: fc.front,
              back: fc.back,
              orderIndex: index,
            },
          }),
        ),
      );

      res.json({
        flashcards,
        message: USE_REAL_AI
          ? "Flashcards generated successfully"
          : "Flashcards generated successfully (mock)",
      });
    } catch (error) {
      console.error("Generate flashcards error:", error);
      res.status(500).json({ error: "Failed to generate flashcards" });
    }
  },
);

router.post(
  "/topics/:topicId/quizzes/generate",
  guestOrAuthMiddleware,
  requireAI,
  aiRateLimit,
  validateParams(topicIdParams),
  checkUsageLimits("quiz"),
  async (req: AuthRequest, res: Response) => {
    try {
      const topicId = req.params.topicId as string;

      const topic = await prisma.topic.findFirst({
        where: { id: topicId, userId: req.user?.id ?? ANONYMOUS_USER_ID },
      });

      if (!topic) {
        return res.status(404).json({ error: "Topic not found" });
      }

      const transcript = topic.transcript || "Default content";
      const aiQuestions = await generateQuizWithAI(transcript);

      const quiz = await prisma.quiz.create({
        data: {
          topicId,
          title: `Quiz: ${topic.name}`,
        },
      });

      const questions = await Promise.all(
        aiQuestions.map((q, index) =>
          prisma.quizQuestion.create({
            data: {
              quizId: quiz.id,
              question: q.question,
              options: JSON.stringify(q.options),
              correctAnswer: q.correctAnswer,
              explanation: q.explanation,
              orderIndex: index,
            },
          }),
        ),
      );

      res.json({
        quiz: { ...quiz, questions },
        message: USE_REAL_AI
          ? "Quiz generated successfully"
          : "Quiz generated successfully (mock)",
      });
    } catch (error) {
      console.error("Generate quiz error:", error);
      res.status(500).json({ error: "Failed to generate quiz" });
    }
  },
);

router.post(
  "/quizzes/:quizId/submit",
  guestOrAuthMiddleware,
  validateParams(quizIdParams),
  validateBody(quizSubmitBody),
  async (req: AuthRequest, res: Response) => {
    try {
      const quizId = req.params.quizId as string;
      const { answers } = req.body;

      const quiz = await prisma.quiz.findFirst({
        where: {
          id: quizId,
          topic: { userId: req.user?.id ?? ANONYMOUS_USER_ID },
        },
        include: { questions: true },
      });

      if (!quiz) {
        return res.status(404).json({ error: "Quiz not found" });
      }

      let score = 0;
      const results = quiz.questions.map((q: any) => {
        const userAnswer = answers[q.id];
        const isCorrect = userAnswer === q.correctAnswer;
        if (isCorrect) score++;
        return {
          questionId: q.id,
          userAnswer,
          correctAnswer: q.correctAnswer,
          isCorrect,
          explanation: q.explanation,
        };
      });

      const attempt = await prisma.quizAttempt.create({
        data: {
          userId: req.user?.id ?? ANONYMOUS_USER_ID,
          quizId,
          score,
          totalQuestions: quiz.questions.length,
          answers: JSON.stringify(answers),
        },
      });

      res.json({
        attempt,
        score,
        totalQuestions: quiz.questions.length,
        percentage: (score / quiz.questions.length) * 100,
        results,
      });
    } catch (error) {
      console.error("Submit quiz error:", error);
      res.status(500).json({ error: "Failed to submit quiz" });
    }
  },
);

router.get(
  "/jobs/:jobId",
  guestOrAuthMiddleware,
  validateParams(jobIdParams),
  async (req: AuthRequest, res: Response) => {
    try {
      const jobId = req.params.jobId as string;
      const userId = req.user?.id ?? ANONYMOUS_USER_ID;

      const job = await prisma.job.findFirst({
        where: { id: jobId, userId },
      });

      if (!job) {
        return res.status(404).json({ error: "Job not found" });
      }

      res.json({
        job: {
          id: job.id,
          type: job.type,
          status: job.status,
          output: job.output ? JSON.parse(job.output) : null,
          error: job.error,
          createdAt: job.createdAt,
        },
      });
    } catch (error) {
      console.error("Get job error:", error);
      res.status(500).json({ error: "Failed to get job status" });
    }
  },
);

router.post(
  "/ocr/extract",
  guestOrAuthMiddleware,
  requireAI,
  aiRateLimit,
  validateBody(ocrExtractBody),
  async (req: AuthRequest, res: Response) => {
    try {
      const { imageBase64, topicId, fileType } = req.body;

      if (!imageBase64) {
        return res.status(400).json({ error: "imageBase64 is required" });
      }

      const base64SizeMB = (imageBase64.length * 3) / 4 / 1024 / 1024;
      if (base64SizeMB > 40) {
        return res.status(400).json({
          error: "File is too large. Please use a smaller file (under 40MB).",
        });
      }

      let extractedText = "";

      if (openai) {
        try {
          if (fileType === "pdf") {
            const pdfText = Buffer.from(imageBase64, "base64").toString(
              "utf-8",
            );
            const cleanText = pdfText
              .replace(/[^\x20-\x7E\n\r\t]/g, " ")
              .replace(/\s{3,}/g, "\n")
              .trim();

            if (cleanText.length > 50) {
              const response = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                  {
                    role: "system",
                    content:
                      "You are a study assistant. Extract and organize the meaningful text content from the following document. Format it clearly with proper structure, headings, and bullet points where appropriate.",
                  },
                  {
                    role: "user",
                    content: cleanText.substring(0, 10000),
                  },
                ],
                max_tokens: 2000,
              });
              extractedText =
                response.choices[0]?.message?.content ||
                cleanText.substring(0, 2000);
            } else {
              extractedText =
                cleanText || "Could not extract readable text from this PDF.";
            }
          } else {
            const response = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: "Extract all text visible in this image. If it's a whiteboard or handwritten notes, transcribe everything you can read. Format the output clearly with proper structure.",
                    },
                    {
                      type: "image_url",
                      image_url: {
                        url: `data:image/jpeg;base64,${imageBase64}`,
                        detail: "auto",
                      },
                    },
                  ],
                },
              ],
              max_tokens: 2000,
            });
            extractedText = response.choices[0]?.message?.content || "";
          }
        } catch (error: any) {
          console.error(
            "OCR extraction failed:",
            error?.status,
            error?.message,
          );
          if (error?.status === 413) {
            return res.status(400).json({
              error:
                "Image is too large for processing. Please use a smaller or lower-resolution image.",
            });
          }
        }
      }

      if (!extractedText) {
        extractedText =
          "Could not extract text. Please ensure AI services are available and try again.";
      }

      if (topicId) {
        try {
          await prisma.whiteboardImage.create({
            data: {
              topicId,
              filename: `whiteboard_${Date.now()}.jpg`,
              filepath: `/uploads/whiteboards/${Date.now()}.jpg`,
              ocrText: extractedText,
            },
          });
        } catch (dbError: any) {
          console.log(
            "Skipping DB save for whiteboard image (topic may be local-only):",
            dbError?.code,
          );
        }
      }

      res.json({
        text: extractedText,
        message: USE_REAL_AI
          ? "OCR extraction completed"
          : "OCR extraction completed (mock)",
      });
    } catch (error) {
      console.error("OCR extraction error:", error);
      res.status(500).json({ error: "Failed to extract text from image" });
    }
  },
);

router.post(
  "/summarize",
  guestOrAuthMiddleware,
  requireAI,
  aiRateLimit,
  validateBody(summarizeBody),
  async (req: AuthRequest, res: Response) => {
    try {
      const { text } = req.body;

      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "Text is required" });
      }

      let summary = "";

      if (openai) {
        try {
          const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: `You are a study assistant. Summarize the following notes or textbook content into a clear, concise summary that captures the key concepts. Format with:
              
1. A brief overview paragraph
2. Key concepts as bullet points
3. Important terms and definitions
4. Main takeaways

Keep the summary focused and student-friendly.`,
              },
              {
                role: "user",
                content: text,
              },
            ],
            max_tokens: 1000,
          });

          summary = response.choices[0]?.message?.content || "";
        } catch (error) {
          console.error("Summarization failed:", error);
        }
      }

      if (!summary) {
        const words = text.split(/\s+/);
        const keyPhrases = words.slice(0, Math.min(50, words.length)).join(" ");
        summary = `## Summary

**Overview:** ${keyPhrases}...

**Key Concepts:**
- Main concept from the notes
- Supporting ideas and details
- Important relationships between topics

**Important Terms:**
- **Term 1:** Definition based on the content
- **Term 2:** Another key term explained

**Takeaways:**
This content covers essential material for understanding the subject. Focus on the key concepts and their applications.`;
      }

      res.json({ summary });
    } catch (error) {
      console.error("Summarization error:", error);
      res.status(500).json({ error: "Failed to summarize text" });
    }
  },
);

router.post(
  "/notes-to-flashcards",
  guestOrAuthMiddleware,
  requireAI,
  aiRateLimit,
  validateBody(notesToFlashcardsBody),
  async (req: AuthRequest, res: Response) => {
    try {
      const { text, topicId } = req.body;

      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "Text is required" });
      }

      let flashcards: Array<{ front: string; back: string; quote?: string }> =
        [];

      if (openai) {
        try {
          const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: `You are a study assistant creating flashcards from notes. Generate 5-10 flashcards that cover the key concepts. Return as JSON array with "front" (question), "back" (answer), and "quote" fields. Focus on:
- Key definitions and terms
- Important concepts and their explanations
- Cause and effect relationships
- Comparisons between concepts

"quote" must be copied verbatim (word-for-word, no paraphrasing) from the
source text below — the exact sentence or short passage that "back" is
based on, so the student can see where the answer came from.

Return ONLY valid JSON array, no markdown.`,
              },
              {
                role: "user",
                content: text,
              },
            ],
            max_tokens: 1500,
          });

          const content = response.choices[0]?.message?.content || "[]";
          const cleaned = content.replace(/```json\n?|\n?```/g, "").trim();
          flashcards = JSON.parse(cleaned);

          // The model is asked for a verbatim quote, but LLMs still drift
          // (paraphrase, drop punctuation) often enough that a fabricated
          // "citation" would be worse than none — verify against the
          // source text (whitespace/case-normalized) and drop it if it
          // doesn't actually appear there.
          const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
          const normalizedText = normalize(text);
          flashcards = flashcards.map((card) => {
            if (card.quote && normalizedText.includes(normalize(card.quote))) {
              return card;
            }
            return { front: card.front, back: card.back };
          });
        } catch (error) {
          console.error("Flashcard generation failed:", error);
        }
      }

      if (flashcards.length === 0) {
        flashcards = generateMockFlashcards(text);
      }

      if (topicId) {
        try {
          for (const card of flashcards) {
            await prisma.flashcard.create({
              data: {
                topicId,
                front: card.front,
                back: card.back,
              },
            });
          }
        } catch (dbError: any) {
          console.log(
            "Skipping DB save for flashcards (topic may be local-only):",
            dbError?.code,
          );
        }
      }

      res.json({
        flashcards,
        count: flashcards.length,
        message: USE_REAL_AI
          ? "Flashcards generated from notes"
          : "Flashcards generated (mock)",
      });
    } catch (error) {
      console.error("Notes to flashcards error:", error);
      res
        .status(500)
        .json({ error: "Failed to generate flashcards from notes" });
    }
  },
);

router.post(
  "/notes-to-quiz",
  guestOrAuthMiddleware,
  requireAI,
  aiRateLimit,
  validateBody(notesToQuizBody),
  async (req: AuthRequest, res: Response) => {
    try {
      const { text, topicId } = req.body;

      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "Text is required" });
      }

      let questions: Array<{
        question: string;
        options: string[];
        correctAnswer: number;
        explanation: string;
      }> = [];

      if (openai) {
        try {
          const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: `You are a study assistant creating quiz questions from notes. Generate 4-6 multiple choice questions. Return as JSON array with:
- "question": the question text
- "options": array of 4 answer choices
- "correctAnswer": index (0-3) of correct answer
- "explanation": brief explanation of why the answer is correct

Focus on testing comprehension of key concepts. Return ONLY valid JSON array, no markdown.`,
              },
              {
                role: "user",
                content: text,
              },
            ],
            max_tokens: 1500,
          });

          const content = response.choices[0]?.message?.content || "[]";
          const cleaned = content.replace(/```json\n?|\n?```/g, "").trim();
          questions = JSON.parse(cleaned);
        } catch (error) {
          console.error("Quiz generation failed:", error);
        }
      }

      if (questions.length === 0) {
        questions = generateMockQuiz(text);
      }

      if (topicId) {
        try {
          const quiz = await prisma.quiz.create({
            data: {
              topicId,
              title: "Notes Quiz",
            },
          });

          for (let i = 0; i < questions.length; i++) {
            const q = questions[i];
            await prisma.quizQuestion.create({
              data: {
                quizId: quiz.id,
                question: q.question,
                options: JSON.stringify(q.options),
                correctAnswer: q.correctAnswer,
                explanation: q.explanation,
                orderIndex: i,
              },
            });
          }
        } catch (dbError: any) {
          console.log(
            "Skipping DB save for quiz (topic may be local-only):",
            dbError?.code,
          );
        }
      }

      res.json({
        questions,
        count: questions.length,
        message: USE_REAL_AI
          ? "Quiz generated from notes"
          : "Quiz generated (mock)",
      });
    } catch (error) {
      console.error("Notes to quiz error:", error);
      res.status(500).json({ error: "Failed to generate quiz from notes" });
    }
  },
);

router.post(
  "/video/extract",
  guestOrAuthMiddleware,
  requireAI,
  transcriptionRateLimit,
  validateBody(videoExtractBody),
  async (req: AuthRequest, res: Response) => {
    try {
      const { videoBase64, topicId } = req.body;

      if (!videoBase64) {
        return res.status(400).json({ error: "videoBase64 is required" });
      }

      let extractedText = "";

      if (openai) {
        try {
          const videoBuffer = Buffer.from(videoBase64, "base64");
          const tmpPath = `/tmp/video_${Date.now()}.mp4`;
          const tmpAudioPath = `/tmp/audio_${Date.now()}.wav`;
          const fs = await import("fs");
          fs.writeFileSync(tmpPath, videoBuffer);

          const { execSync } = await import("child_process");
          try {
            execSync(
              `ffmpeg -i ${tmpPath} -vn -acodec pcm_s16le -ar 16000 -ac 1 ${tmpAudioPath} -y 2>/dev/null`,
            );
            const audioBuffer = fs.readFileSync(tmpAudioPath);
            const audioFile = new File([audioBuffer], "audio.wav", {
              type: "audio/wav",
            });

            const transcription = await openai.audio.transcriptions.create({
              model: "whisper-1",
              file: audioFile,
            });
            extractedText = transcription.text || "";

            try {
              fs.unlinkSync(tmpPath);
            } catch {}
            try {
              fs.unlinkSync(tmpAudioPath);
            } catch {}
          } catch (ffmpegError) {
            console.error(
              "FFmpeg extraction failed, trying direct transcription:",
              ffmpegError,
            );
            const videoFile = new File([videoBuffer], "video.mp4", {
              type: "video/mp4",
            });
            const transcription = await openai.audio.transcriptions.create({
              model: "whisper-1",
              file: videoFile,
            });
            extractedText = transcription.text || "";
            try {
              fs.unlinkSync(tmpPath);
            } catch {}
          }

          if (extractedText) {
            const summaryRes = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              messages: [
                {
                  role: "system",
                  content:
                    "Summarize this video transcription into clear study notes. Include key points, important details, and main takeaways. Format with bullet points and section headers.",
                },
                { role: "user", content: extractedText },
              ],
              max_tokens: 1500,
            });
            const summary = summaryRes.choices[0]?.message?.content || "";
            extractedText = `## Video Summary\n\n${summary}\n\n---\n\n## Full Transcript\n\n${extractedText}`;
          }
        } catch (error) {
          console.error("Video extraction failed:", error);
        }
      }

      if (!extractedText) {
        extractedText =
          "Video processing requires AI integration. The video was received but could not be processed without the AI service.";
      }

      if (topicId) {
        try {
          await prisma.whiteboardImage.create({
            data: {
              topicId,
              filename: `video_${Date.now()}.mp4`,
              filepath: `/uploads/videos/${Date.now()}.mp4`,
              ocrText: extractedText,
            },
          });
        } catch (dbError: any) {
          console.log(
            "Skipping DB save for video extract (topic may be local-only):",
            dbError?.code,
          );
        }
      }

      res.json({
        text: extractedText,
        message: USE_REAL_AI
          ? "Video processed successfully"
          : "Video processed (mock)",
      });
    } catch (error) {
      console.error("Video extraction error:", error);
      res.status(500).json({ error: "Failed to process video" });
    }
  },
);

router.post(
  "/video/url-extract",
  guestOrAuthMiddleware,
  requireAI,
  transcriptionRateLimit,
  validateBody(videoUrlBody),
  async (req: AuthRequest, res: Response) => {
    try {
      const { videoUrl, topicId } = req.body;

      if (!videoUrl || typeof videoUrl !== "string") {
        return res.status(400).json({ error: "videoUrl is required" });
      }

      const trimmedUrl = videoUrl.trim();
      if (!/^https?:\/\/.+/i.test(trimmedUrl)) {
        return res.status(400).json({
          error: "Please provide a valid URL starting with http:// or https://",
        });
      }

      const { processVideoUrl, isProcessingError } = await import(
        "./video-processor"
      );
      const result = await processVideoUrl(trimmedUrl, openai);

      if (isProcessingError(result)) {
        return res.status(result.status).json({ error: result.message });
      }

      if (topicId) {
        try {
          await prisma.whiteboardImage.create({
            data: {
              topicId,
              filename: `video_url_${Date.now()}.txt`,
              filepath: trimmedUrl,
              ocrText: result.text,
            },
          });
        } catch (dbError: any) {
          console.log("[VideoURL] Skipping DB save:", dbError?.code);
        }
      }

      res.json({
        text: result.text,
        message: "Video URL processed successfully",
      });
    } catch (error) {
      console.error("[VideoURL] Unexpected error:", error);
      res.status(500).json({
        error: "An unexpected error occurred while processing the video.",
      });
    }
  },
);

export default router;
