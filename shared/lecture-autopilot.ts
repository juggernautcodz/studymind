export type LectureAutopilotStage =
  | "queued"
  | "transcribing"
  | "source-locking"
  | "generating-notes"
  | "generating-flashcards"
  | "generating-quiz"
  | "complete"
  | "failed";

export interface LectureAutopilotMaterials {
  notes: boolean;
  flashcards: boolean;
  quiz: boolean;
}

export interface LectureAutopilotFlashcardDto {
  id: string;
  front: string;
  back: string;
  orderIndex: number;
}

export interface LectureAutopilotQuizQuestionDto {
  id: string;
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string | null;
  orderIndex: number;
}

export interface LectureAutopilotResultDto {
  courseId: string;
  topicId: string;
  recording: {
    id: string;
    durationSeconds: number | null;
  };
  source: {
    id: string;
    revisionId: string;
    segmentIds: string[];
  };
  transcript: string;
  notes: string | null;
  flashcards: LectureAutopilotFlashcardDto[];
  quiz: {
    id: string;
    title: string;
    questions: LectureAutopilotQuizQuestionDto[];
  } | null;
}

export interface LectureAutopilotJobDto {
  id: string;
  type: "lecture-autopilot";
  status: LectureAutopilotStage;
  completedStages: LectureAutopilotStage[];
  failedStage: LectureAutopilotStage | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  result: LectureAutopilotResultDto | null;
}
