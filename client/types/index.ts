export type Plan = "FREE" | "BASE" | "PRO";

export interface User {
  id: string;
  email: string;
  name: string;
  plan: Plan;
  createdAt: string;
}

export interface Semester {
  id: string;
  userId: string;
  name: string;
  startDate: string;
  endDate: string;
  createdAt: string;
}

export interface Course {
  id: string;
  userId: string;
  semesterId: string;
  name: string;
  code: string;
  color: string;
  createdAt: string;
}

export interface Topic {
  id: string;
  serverId?: string;
  userId: string;
  courseId: string;
  name: string;
  orderIndex: number;
  status: "pending" | "transcribing" | "completed";
  createdAt: string;
}

export interface Recording {
  id: string;
  topicId: string;
  filePath: string;
  durationSeconds: number;
  createdAt: string;
}

export interface Transcript {
  id: string;
  recordingId: string;
  topicId: string;
  text: string;
  timestamps: { start: number; end: number; text: string }[];
  createdAt: string;
}

export interface NotesSection {
  heading: string;
  bullets: string[];
  pinned?: boolean;
}

export interface Notes {
  id: string;
  topicId: string;
  title: string;
  sections: NotesSection[];
  createdAt: string;
  updatedAt?: string;
  favorite?: boolean;
}

export interface Flashcard {
  id: string;
  topicId: string;
  question: string;
  answer: string;
  orderIndex: number;
}

export interface Quiz {
  id: string;
  topicId: string;
  createdAt: string;
}

export interface QuizQuestion {
  id: string;
  quizId: string;
  question: string;
  options: string[];
  correctIndex: number;
  orderIndex: number;
}

export interface QuizAttempt {
  id: string;
  topicId: string;
  courseId: string;
  score: number;
  totalQuestions: number;
  passed: boolean;
  completedAt: string;
}

export interface ExamAttempt {
  id: string;
  courseId: string;
  score: number;
  totalQuestions: number;
  grade: string;
  completedAt: string;
}

export const QUIZZES_TO_UNLOCK_EXAM = 3;
export const QUIZ_PASS_THRESHOLD = 0.6;
export const EXAM_QUESTION_COUNT = 20;

export interface WhiteboardImage {
  id: string;
  topicId: string;
  imagePath: string;
  ocrText: string;
  createdAt: string;
}

export interface MindmapNode {
  id: string;
  userId: string;
  courseId: string;
  parentId: string | null;
  nodeType: "course" | "topic" | "concept";
  title: string;
  depth: number;
  orderIndex: number;
  linkedItemId?: string;
  createdAt: string;
}

export interface Job {
  id: string;
  userId: string;
  type: "TRANSCRIBE" | "NOTES" | "FLASHCARDS" | "QUIZ" | "OCR" | "MINDMAP";
  status: "pending" | "processing" | "completed" | "failed";
  inputJson: Record<string, unknown>;
  outputJson: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UsageStats {
  transcriptionMinutesUsed: number;
  storageBytesUsed: number;
  recordingsCountThisMonth: number;
}

export const PLAN_LIMITS = {
  FREE: { recordings: 2, transcriptionMinutes: 30 },
  BASE: { recordings: 20, transcriptionMinutes: 300 },
  PRO: { recordings: 200, transcriptionMinutes: 3000 },
};

export const COURSE_COLORS = [
  "#2B4C7E",
  "#8B5E3C",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
  "#EC4899",
  "#06B6D4",
];
