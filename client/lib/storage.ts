import AsyncStorage from "@react-native-async-storage/async-storage";
import { v4 as uuidv4 } from "uuid";
import type {
  User,
  Semester,
  Course,
  Topic,
  Recording,
  Transcript,
  Notes,
  Flashcard,
  Quiz,
  QuizQuestion,
  QuizAttempt,
  ExamAttempt,
  WhiteboardImage,
  MindmapNode,
  UsageStats,
} from "@/types";

const KEYS = {
  USER: "studymind_user",
  SEMESTERS: "studymind_semesters",
  COURSES: "studymind_courses",
  TOPICS: "studymind_topics",
  RECORDINGS: "studymind_recordings",
  TRANSCRIPTS: "studymind_transcripts",
  NOTES: "studymind_notes",
  FLASHCARDS: "studymind_flashcards",
  QUIZZES: "studymind_quizzes",
  QUIZ_QUESTIONS: "studymind_quiz_questions",
  WHITEBOARD_IMAGES: "studymind_whiteboard_images",
  MINDMAP_NODES: "studymind_mindmap_nodes",
  USAGE_STATS: "studymind_usage_stats",
  AUTH_TOKEN: "studymind_auth_token",
  QUIZ_ATTEMPTS: "studymind_quiz_attempts",
  EXAM_ATTEMPTS: "studymind_exam_attempts",
  RECENT_TOPICS: "studymind_recent_topics",
};

// USER/AUTH_TOKEN describe "who's currently signed in on this device" and
// stay global. Every other key holds actual study content and must be
// namespaced per account, or one account's data is readable by the next
// account that logs in on the same device.
let currentUserId: string | null = null;

export function setActiveUser(userId: string | null): void {
  currentUserId = userId;
}

function scopeKey(key: string): string {
  if (key === KEYS.USER || key === KEYS.AUTH_TOKEN) return key;
  return currentUserId ? `${currentUserId}:${key}` : key;
}

async function getItems<T>(key: string): Promise<T[]> {
  try {
    const data = await AsyncStorage.getItem(scopeKey(key));
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

async function setItems<T>(key: string, items: T[]): Promise<void> {
  await AsyncStorage.setItem(scopeKey(key), JSON.stringify(items));
}

async function getItem<T>(key: string): Promise<T | null> {
  try {
    const data = await AsyncStorage.getItem(scopeKey(key));
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

async function setItem<T>(key: string, item: T): Promise<void> {
  await AsyncStorage.setItem(scopeKey(key), JSON.stringify(item));
}

export const storage = {
  async getUser(): Promise<User | null> {
    return getItem<User>(KEYS.USER);
  },

  async setUser(user: User): Promise<void> {
    await setItem(KEYS.USER, user);
  },

  async clearUser(): Promise<void> {
    await AsyncStorage.removeItem(KEYS.USER);
    await AsyncStorage.removeItem(KEYS.AUTH_TOKEN);
  },

  async getAuthToken(): Promise<string | null> {
    return AsyncStorage.getItem(KEYS.AUTH_TOKEN);
  },

  async setAuthToken(token: string): Promise<void> {
    await AsyncStorage.setItem(KEYS.AUTH_TOKEN, token);
  },

  async getSemesters(): Promise<Semester[]> {
    return getItems<Semester>(KEYS.SEMESTERS);
  },

  async hasContent(): Promise<boolean> {
    const semesters = await this.getSemesters();
    return semesters.length > 0;
  },

  // Only called when this device's local storage is empty for the active
  // user, to pull down content already created on another device — never
  // overwrites existing local data.
  async hydrateFromServer(data: {
    semesters: Semester[];
    courses: Course[];
    topics: Topic[];
  }): Promise<void> {
    await setItems(KEYS.SEMESTERS, data.semesters);
    await setItems(KEYS.COURSES, data.courses);
    await setItems(KEYS.TOPICS, data.topics);
  },

  async createSemester(
    data: Omit<Semester, "id" | "createdAt">,
  ): Promise<Semester> {
    const semesters = await this.getSemesters();
    const semester: Semester = {
      ...data,
      id: uuidv4(),
      createdAt: new Date().toISOString(),
    };
    await setItems(KEYS.SEMESTERS, [...semesters, semester]);
    return semester;
  },

  async updateSemester(
    id: string,
    data: Partial<Semester>,
  ): Promise<Semester | null> {
    const semesters = await this.getSemesters();
    const index = semesters.findIndex((s) => s.id === id);
    if (index === -1) return null;
    semesters[index] = { ...semesters[index], ...data };
    await setItems(KEYS.SEMESTERS, semesters);
    return semesters[index];
  },

  async deleteSemester(id: string): Promise<void> {
    const semesters = await this.getSemesters();
    await setItems(
      KEYS.SEMESTERS,
      semesters.filter((s) => s.id !== id),
    );
    const courses = await this.getCourses();
    const courseIds = courses
      .filter((c) => c.semesterId === id)
      .map((c) => c.id);
    await setItems(
      KEYS.COURSES,
      courses.filter((c) => c.semesterId !== id),
    );
    for (const courseId of courseIds) {
      await this.deleteCourseData(courseId);
    }
  },

  async getCourses(): Promise<Course[]> {
    return getItems<Course>(KEYS.COURSES);
  },

  async getCoursesBySemester(semesterId: string): Promise<Course[]> {
    const courses = await this.getCourses();
    return courses.filter((c) => c.semesterId === semesterId);
  },

  async getCourse(id: string): Promise<Course | null> {
    const courses = await this.getCourses();
    return courses.find((c) => c.id === id) || null;
  },

  async createCourse(data: Omit<Course, "id" | "createdAt">): Promise<Course> {
    const courses = await this.getCourses();
    const course: Course = {
      ...data,
      id: uuidv4(),
      createdAt: new Date().toISOString(),
    };
    await setItems(KEYS.COURSES, [...courses, course]);
    return course;
  },

  async updateCourse(
    id: string,
    data: Partial<Course>,
  ): Promise<Course | null> {
    const courses = await this.getCourses();
    const index = courses.findIndex((c) => c.id === id);
    if (index === -1) return null;
    courses[index] = { ...courses[index], ...data };
    await setItems(KEYS.COURSES, courses);
    return courses[index];
  },

  async deleteCourse(id: string): Promise<void> {
    const courses = await this.getCourses();
    await setItems(
      KEYS.COURSES,
      courses.filter((c) => c.id !== id),
    );
    await this.deleteCourseData(id);
  },

  async deleteCourseData(courseId: string): Promise<void> {
    const topics = await this.getTopics();
    const topicIds = topics
      .filter((t) => t.courseId === courseId)
      .map((t) => t.id);
    await setItems(
      KEYS.TOPICS,
      topics.filter((t) => t.courseId !== courseId),
    );

    for (const topicId of topicIds) {
      await this.deleteTopicData(topicId);
    }

    const nodes = await this.getMindmapNodes(courseId);
    await setItems(
      KEYS.MINDMAP_NODES,
      (await getItems<MindmapNode>(KEYS.MINDMAP_NODES)).filter(
        (n) => n.courseId !== courseId,
      ),
    );

    const quizAttempts = await getItems<QuizAttempt>(KEYS.QUIZ_ATTEMPTS);
    await setItems(
      KEYS.QUIZ_ATTEMPTS,
      quizAttempts.filter((a) => a.courseId !== courseId),
    );

    const examAttempts = await getItems<ExamAttempt>(KEYS.EXAM_ATTEMPTS);
    await setItems(
      KEYS.EXAM_ATTEMPTS,
      examAttempts.filter((a) => a.courseId !== courseId),
    );
  },

  async getTopics(): Promise<Topic[]> {
    return getItems<Topic>(KEYS.TOPICS);
  },

  async getTopicsByCourse(courseId: string): Promise<Topic[]> {
    const topics = await this.getTopics();
    return topics
      .filter((t) => t.courseId === courseId)
      .sort((a, b) => a.orderIndex - b.orderIndex);
  },

  async getTopic(id: string): Promise<Topic | null> {
    const topics = await this.getTopics();
    return topics.find((t) => t.id === id) || null;
  },

  async createTopic(data: Omit<Topic, "id" | "createdAt">): Promise<Topic> {
    const topics = await this.getTopics();
    const topic: Topic = {
      ...data,
      id: uuidv4(),
      createdAt: new Date().toISOString(),
    };
    await setItems(KEYS.TOPICS, [...topics, topic]);
    return topic;
  },

  async updateTopic(id: string, data: Partial<Topic>): Promise<Topic | null> {
    const topics = await this.getTopics();
    const index = topics.findIndex((t) => t.id === id);
    if (index === -1) return null;
    topics[index] = { ...topics[index], ...data };
    if (data.status && __DEV__) {
      console.log(`[storage] Topic "${topics[index].name}" (${id}) status -> ${data.status}`);
    }
    await setItems(KEYS.TOPICS, topics);
    return topics[index];
  },

  async recoverStuckTopics(): Promise<number> {
    const topics = await this.getTopics();
    const STUCK_THRESHOLD_MS = 5 * 60 * 1000;
    const now = Date.now();
    let recovered = 0;
    const updated = topics.map((t) => {
      if (t.status === "transcribing") {
        const topicAge = now - new Date(t.createdAt).getTime();
        if (topicAge > STUCK_THRESHOLD_MS) {
          if (__DEV__) console.log(`[storage] Recovering stuck topic "${t.name}" (${t.id}) from transcribing -> pending`);
          recovered++;
          return { ...t, status: "pending" as const };
        }
      }
      return t;
    });
    if (recovered > 0) {
      await setItems(KEYS.TOPICS, updated);
    }
    return recovered;
  },

  async deleteTopic(id: string): Promise<void> {
    const topics = await this.getTopics();
    await setItems(
      KEYS.TOPICS,
      topics.filter((t) => t.id !== id),
    );
    await this.deleteTopicData(id);
  },

  async deleteTopicData(topicId: string): Promise<void> {
    const recordings = await getItems<Recording>(KEYS.RECORDINGS);
    await setItems(
      KEYS.RECORDINGS,
      recordings.filter((r) => r.topicId !== topicId),
    );

    const transcripts = await getItems<Transcript>(KEYS.TRANSCRIPTS);
    await setItems(
      KEYS.TRANSCRIPTS,
      transcripts.filter((t) => t.topicId !== topicId),
    );

    const notes = await getItems<Notes>(KEYS.NOTES);
    await setItems(
      KEYS.NOTES,
      notes.filter((n) => n.topicId !== topicId),
    );

    const flashcards = await getItems<Flashcard>(KEYS.FLASHCARDS);
    await setItems(
      KEYS.FLASHCARDS,
      flashcards.filter((f) => f.topicId !== topicId),
    );

    const quizzes = await getItems<Quiz>(KEYS.QUIZZES);
    const quizIds = quizzes
      .filter((q) => q.topicId === topicId)
      .map((q) => q.id);
    await setItems(
      KEYS.QUIZZES,
      quizzes.filter((q) => q.topicId !== topicId),
    );

    const questions = await getItems<QuizQuestion>(KEYS.QUIZ_QUESTIONS);
    await setItems(
      KEYS.QUIZ_QUESTIONS,
      questions.filter((q) => !quizIds.includes(q.quizId)),
    );

    const images = await getItems<WhiteboardImage>(KEYS.WHITEBOARD_IMAGES);
    await setItems(
      KEYS.WHITEBOARD_IMAGES,
      images.filter((i) => i.topicId !== topicId),
    );

    const quizAttempts = await getItems<QuizAttempt>(KEYS.QUIZ_ATTEMPTS);
    await setItems(
      KEYS.QUIZ_ATTEMPTS,
      quizAttempts.filter((a) => a.topicId !== topicId),
    );
  },

  async getNotes(topicId: string): Promise<Notes | null> {
    const notes = await getItems<Notes>(KEYS.NOTES);
    return notes.find((n) => n.topicId === topicId) || null;
  },

  async saveNotes(data: Omit<Notes, "id" | "createdAt">): Promise<Notes> {
    const notes = await getItems<Notes>(KEYS.NOTES);
    const existing = notes.find((n) => n.topicId === data.topicId);

    if (existing) {
      const mergedSections = [...(existing.sections || [])];
      for (const newSection of data.sections || []) {
        const existingSection = mergedSections.find(
          (s) => s.heading === newSection.heading,
        );
        if (existingSection) {
          const existingBullets = new Set(existingSection.bullets);
          for (const bullet of newSection.bullets) {
            if (!existingBullets.has(bullet)) {
              existingSection.bullets.push(bullet);
            }
          }
        } else {
          mergedSections.push(newSection);
        }
      }
      existing.sections = mergedSections;
      existing.title = data.title || existing.title;
      existing.updatedAt = new Date().toISOString();
      await setItems(KEYS.NOTES, notes);
      return existing;
    }

    const note: Notes = {
      ...data,
      id: uuidv4(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    notes.push(note);
    await setItems(KEYS.NOTES, notes);
    return note;
  },

  async updateNotes(topicId: string, updatedNotes: Partial<Notes>): Promise<Notes | null> {
    const notes = await getItems<Notes>(KEYS.NOTES);
    const index = notes.findIndex((n) => n.topicId === topicId);
    if (index === -1) return null;
    notes[index] = { ...notes[index], ...updatedNotes, updatedAt: new Date().toISOString() };
    await setItems(KEYS.NOTES, notes);
    return notes[index];
  },

  async exportAllNotes(): Promise<string> {
    const [semesters, courses, topics, notes] = await Promise.all([
      this.getSemesters(),
      this.getCourses(),
      this.getTopics(),
      getItems<Notes>(KEYS.NOTES),
    ]);
    const backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      semesters,
      courses,
      topics,
      notes,
    };
    return JSON.stringify(backup, null, 2);
  },

  async importNotes(backup: unknown): Promise<{ imported: number; skipped: number }> {
    if (!backup || typeof backup !== "object") throw new Error("Invalid backup");
    const b = backup as Record<string, unknown>;
    if (!Array.isArray(b.notes)) throw new Error("Invalid backup: missing notes array");

    const existingNotes = await getItems<Notes>(KEYS.NOTES);
    const existingTopicIds = new Set(existingNotes.map((n) => n.topicId));

    let imported = 0;
    let skipped = 0;

    for (const note of b.notes as Notes[]) {
      if (!note.topicId || !Array.isArray(note.sections)) { skipped++; continue; }
      if (existingTopicIds.has(note.topicId)) { skipped++; continue; }
      existingNotes.push({ ...note, id: note.id || uuidv4() });
      existingTopicIds.add(note.topicId);
      imported++;
    }

    if (imported > 0) {
      await setItems(KEYS.NOTES, existingNotes);
    }

    return { imported, skipped };
  },

  async getFlashcards(topicId: string): Promise<Flashcard[]> {
    const flashcards = await getItems<Flashcard>(KEYS.FLASHCARDS);
    return flashcards
      .filter((f) => f.topicId === topicId)
      .sort((a, b) => a.orderIndex - b.orderIndex);
  },

  async getAllFlashcards(): Promise<Flashcard[]> {
    return getItems<Flashcard>(KEYS.FLASHCARDS);
  },

  async getAllNotes(): Promise<Notes[]> {
    return getItems<Notes>(KEYS.NOTES);
  },

  async getAllQuizzes(): Promise<Quiz[]> {
    return getItems<Quiz>(KEYS.QUIZZES);
  },

  async getRecentTopicIds(): Promise<string[]> {
    return (await getItem<string[]>(KEYS.RECENT_TOPICS)) || [];
  },

  async recordTopicVisit(topicId: string): Promise<void> {
    const ids = await this.getRecentTopicIds();
    const next = [topicId, ...ids.filter((id) => id !== topicId)].slice(0, 20);
    await setItem(KEYS.RECENT_TOPICS, next);
  },

  async saveFlashcards(
    topicId: string,
    cards: Omit<Flashcard, "id" | "topicId">[],
  ): Promise<Flashcard[]> {
    const flashcards = await getItems<Flashcard>(KEYS.FLASHCARDS);
    const existingForTopic = flashcards.filter((f) => f.topicId === topicId);
    const maxOrder = existingForTopic.reduce(
      (max, f) => Math.max(max, f.orderIndex),
      -1,
    );
    const newCards: Flashcard[] = cards.map((card, index) => ({
      ...card,
      id: uuidv4(),
      topicId,
      orderIndex: maxOrder + 1 + index,
    }));
    await setItems(KEYS.FLASHCARDS, [...flashcards, ...newCards]);
    return newCards;
  },

  async cacheServerFlashcards(cards: Flashcard[]): Promise<void> {
    const flashcards = await getItems<Flashcard>(KEYS.FLASHCARDS);
    const incomingIds = new Set(cards.map((card) => card.id));
    await setItems(KEYS.FLASHCARDS, [
      ...flashcards.filter((card) => !incomingIds.has(card.id)),
      ...cards,
    ]);
  },

  async getQuiz(
    topicId: string,
  ): Promise<{ quiz: Quiz; questions: QuizQuestion[] } | null> {
    const quizzes = await getItems<Quiz>(KEYS.QUIZZES);
    const quiz = quizzes.find((q) => q.topicId === topicId);
    if (!quiz) return null;
    const questions = await getItems<QuizQuestion>(KEYS.QUIZ_QUESTIONS);
    return {
      quiz,
      questions: questions
        .filter((q) => q.quizId === quiz.id)
        .sort((a, b) => a.orderIndex - b.orderIndex),
    };
  },

  async saveQuiz(
    topicId: string,
    questions: Omit<QuizQuestion, "id" | "quizId" | "orderIndex">[],
  ): Promise<{ quiz: Quiz; questions: QuizQuestion[] }> {
    const quizzes = await getItems<Quiz>(KEYS.QUIZZES);
    const existing = quizzes.find((q) => q.topicId === topicId);

    const quiz: Quiz = existing || {
      id: uuidv4(),
      topicId,
      createdAt: new Date().toISOString(),
    };

    if (!existing) {
      await setItems(KEYS.QUIZZES, [...quizzes, quiz]);
    }

    const allQuestions = await getItems<QuizQuestion>(KEYS.QUIZ_QUESTIONS);
    const existingForQuiz = allQuestions.filter((q) => q.quizId === quiz.id);
    const maxOrder = existingForQuiz.reduce(
      (max, q) => Math.max(max, q.orderIndex),
      -1,
    );
    const newQuestions: QuizQuestion[] = questions.map((q, index) => ({
      ...q,
      id: uuidv4(),
      quizId: quiz.id,
      orderIndex: maxOrder + 1 + index,
    }));
    await setItems(KEYS.QUIZ_QUESTIONS, [...allQuestions, ...newQuestions]);

    return { quiz, questions: newQuestions };
  },

  async cacheServerQuiz(
    quiz: Quiz,
    questions: QuizQuestion[],
  ): Promise<void> {
    const quizzes = await getItems<Quiz>(KEYS.QUIZZES);
    const allQuestions = await getItems<QuizQuestion>(KEYS.QUIZ_QUESTIONS);
    const incomingQuestionIds = new Set(questions.map((question) => question.id));
    await Promise.all([
      setItems(KEYS.QUIZZES, [
        ...quizzes.filter((existing) => existing.id !== quiz.id),
        quiz,
      ]),
      setItems(KEYS.QUIZ_QUESTIONS, [
        ...allQuestions.filter(
          (question) => !incomingQuestionIds.has(question.id),
        ),
        ...questions,
      ]),
    ]);
  },

  async getNotesByTopics(topicIds: string[]): Promise<Notes[]> {
    const notes = await getItems<Notes>(KEYS.NOTES);
    return notes.filter((n) => topicIds.includes(n.topicId));
  },

  async getFlashcardsByTopics(topicIds: string[]): Promise<Flashcard[]> {
    const flashcards = await getItems<Flashcard>(KEYS.FLASHCARDS);
    return flashcards
      .filter((f) => topicIds.includes(f.topicId))
      .sort((a, b) => a.orderIndex - b.orderIndex);
  },

  async getQuizByTopics(
    topicIds: string[],
  ): Promise<{ quiz: Quiz; questions: QuizQuestion[] } | null> {
    const quizzes = await getItems<Quiz>(KEYS.QUIZZES);
    const matchingQuizzes = quizzes.filter((q) =>
      topicIds.includes(q.topicId),
    );
    if (matchingQuizzes.length === 0) return null;
    const allQuestions = await getItems<QuizQuestion>(KEYS.QUIZ_QUESTIONS);
    const quizIds = new Set(matchingQuizzes.map((q) => q.id));
    const questions = allQuestions
      .filter((q) => quizIds.has(q.quizId))
      .sort((a, b) => a.orderIndex - b.orderIndex);
    return { quiz: matchingQuizzes[0], questions };
  },

  async getWhiteboardImagesByTopics(
    topicIds: string[],
  ): Promise<WhiteboardImage[]> {
    const images = await getItems<WhiteboardImage>(KEYS.WHITEBOARD_IMAGES);
    return images.filter((i) => topicIds.includes(i.topicId));
  },

  async getWhiteboardImages(topicId: string): Promise<WhiteboardImage[]> {
    const images = await getItems<WhiteboardImage>(KEYS.WHITEBOARD_IMAGES);
    return images.filter((i) => i.topicId === topicId);
  },

  async saveWhiteboardImage(
    data: Omit<WhiteboardImage, "id" | "createdAt">,
  ): Promise<WhiteboardImage> {
    const images = await getItems<WhiteboardImage>(KEYS.WHITEBOARD_IMAGES);
    const image: WhiteboardImage = {
      ...data,
      id: uuidv4(),
      createdAt: new Date().toISOString(),
    };
    await setItems(KEYS.WHITEBOARD_IMAGES, [...images, image]);
    return image;
  },

  async getTranscript(topicId: string): Promise<Transcript | null> {
    const transcripts = await getItems<Transcript>(KEYS.TRANSCRIPTS);
    return transcripts.find((t) => t.topicId === topicId) || null;
  },

  async saveTranscript(
    data: Omit<Transcript, "id" | "createdAt">,
  ): Promise<Transcript> {
    const transcripts = await getItems<Transcript>(KEYS.TRANSCRIPTS);
    const existingIndex = transcripts.findIndex(
      (transcript) => transcript.recordingId === data.recordingId,
    );
    if (existingIndex >= 0) {
      const transcript = { ...transcripts[existingIndex], ...data };
      transcripts[existingIndex] = transcript;
      await setItems(KEYS.TRANSCRIPTS, transcripts);
      return transcript;
    }
    const transcript: Transcript = {
      ...data,
      id: uuidv4(),
      createdAt: new Date().toISOString(),
    };
    await setItems(KEYS.TRANSCRIPTS, [...transcripts, transcript]);
    return transcript;
  },

  async getMindmapNodes(courseId: string): Promise<MindmapNode[]> {
    const nodes = await getItems<MindmapNode>(KEYS.MINDMAP_NODES);
    return nodes.filter((n) => n.courseId === courseId);
  },

  async createMindmapNode(
    data: Omit<MindmapNode, "id" | "createdAt">,
  ): Promise<MindmapNode> {
    const nodes = await getItems<MindmapNode>(KEYS.MINDMAP_NODES);
    const node: MindmapNode = {
      ...data,
      id: uuidv4(),
      createdAt: new Date().toISOString(),
    };
    await setItems(KEYS.MINDMAP_NODES, [...nodes, node]);
    return node;
  },

  async updateMindmapNode(
    id: string,
    data: Partial<MindmapNode>,
  ): Promise<MindmapNode | null> {
    const nodes = await getItems<MindmapNode>(KEYS.MINDMAP_NODES);
    const index = nodes.findIndex((n) => n.id === id);
    if (index === -1) return null;
    nodes[index] = { ...nodes[index], ...data };
    await setItems(KEYS.MINDMAP_NODES, nodes);
    return nodes[index];
  },

  async deleteMindmapNode(id: string): Promise<void> {
    const nodes = await getItems<MindmapNode>(KEYS.MINDMAP_NODES);
    const toDelete = new Set<string>([id]);

    const findChildren = (parentId: string) => {
      nodes.forEach((n) => {
        if (n.parentId === parentId && !toDelete.has(n.id)) {
          toDelete.add(n.id);
          findChildren(n.id);
        }
      });
    };
    findChildren(id);

    await setItems(
      KEYS.MINDMAP_NODES,
      nodes.filter((n) => !toDelete.has(n.id)),
    );
  },

  async getUsageStats(): Promise<UsageStats> {
    const stats = await getItem<UsageStats>(KEYS.USAGE_STATS);
    return (
      stats || {
        transcriptionMinutesUsed: 0,
        storageBytesUsed: 0,
        recordingsCountThisMonth: 0,
      }
    );
  },

  async updateUsageStats(data: Partial<UsageStats>): Promise<UsageStats> {
    const current = await this.getUsageStats();
    const updated = { ...current, ...data };
    await setItem(KEYS.USAGE_STATS, updated);
    return updated;
  },

  async getQuizAttempts(): Promise<QuizAttempt[]> {
    return getItems<QuizAttempt>(KEYS.QUIZ_ATTEMPTS);
  },

  async getQuizAttemptsByCourse(courseId: string): Promise<QuizAttempt[]> {
    const attempts = await this.getQuizAttempts();
    return attempts.filter((a) => a.courseId === courseId);
  },

  async getPassedQuizCountByCourse(courseId: string): Promise<number> {
    const attempts = await this.getQuizAttemptsByCourse(courseId);
    const passedTopics = new Set(
      attempts.filter((a) => a.passed).map((a) => a.topicId),
    );
    return passedTopics.size;
  },

  async saveQuizAttempt(
    data: Omit<QuizAttempt, "id" | "completedAt">,
  ): Promise<QuizAttempt> {
    const attempts = await this.getQuizAttempts();
    const attempt: QuizAttempt = {
      ...data,
      id: uuidv4(),
      completedAt: new Date().toISOString(),
    };
    await setItems(KEYS.QUIZ_ATTEMPTS, [...attempts, attempt]);
    return attempt;
  },

  async getExamAttempts(): Promise<ExamAttempt[]> {
    return getItems<ExamAttempt>(KEYS.EXAM_ATTEMPTS);
  },

  async getExamAttemptsByCourse(courseId: string): Promise<ExamAttempt[]> {
    const attempts = await this.getExamAttempts();
    return attempts.filter((a) => a.courseId === courseId);
  },

  async saveExamAttempt(
    data: Omit<ExamAttempt, "id" | "completedAt">,
  ): Promise<ExamAttempt> {
    const attempts = await this.getExamAttempts();
    const attempt: ExamAttempt = {
      ...data,
      id: uuidv4(),
      completedAt: new Date().toISOString(),
    };
    await setItems(KEYS.EXAM_ATTEMPTS, [...attempts, attempt]);
    return attempt;
  },

  async clearAll(): Promise<void> {
    await AsyncStorage.multiRemove(Object.values(KEYS).map(scopeKey));
  },
};
