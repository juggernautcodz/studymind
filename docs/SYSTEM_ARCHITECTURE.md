# StudyMind System Architecture

## Overview

StudyMind is an AI-powered study system that transforms lecture content into comprehensive study materials through an automated pipeline: **Capture → Understanding → Practice → Retention → Exam Readiness**.

---

## 1. System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND (Expo/React Native)                   │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   │
│  │   Capture    │ │    Study     │ │    Exam      │ │   Settings   │   │
│  │   Module     │ │    Module    │ │    Module    │ │    Module    │   │
│  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └──────────────┘   │
│         │                │                │                              │
│  ┌──────▼───────────────▼────────────────▼──────────────────────────┐  │
│  │                    Local Storage (AsyncStorage)                    │  │
│  │          • User data, offline cache, study progress               │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ REST API
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           BACKEND (Express.js)                           │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   │
│  │  Auth API    │ │  Content API │ │   AI API     │ │ Adaptive API │   │
│  │  /api/auth   │ │  /api/*      │ │   /api/ai    │ │ /api/adaptive│   │
│  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └──────┬───────┘   │
│         │                │                │                │            │
│  ┌──────▼────────────────▼────────────────▼────────────────▼────────┐  │
│  │                        AI Provider Layer                          │  │
│  │    ┌─────────────────────┐    ┌─────────────────────┐            │  │
│  │    │   Real AI (OpenAI)  │◄──►│   Mock AI (Fallback)│            │  │
│  │    └─────────────────────┘    └─────────────────────┘            │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          DATA LAYER (Prisma + SQLite)                    │
├─────────────────────────────────────────────────────────────────────────┤
│  User │ Semester │ Course │ Topic │ Lecture │ Flashcard │ Quiz │ Job   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Data Models

### Hierarchy

```
User
  └── Semester (e.g., "Fall 2025")
        └── Course (e.g., "Biology 101")
              └── Topic (e.g., "Cell Structure")
                    └── Lecture (e.g., "Lecture 3: Mitochondria")
                          ├── Recording (audio file)
                          ├── Transcript (speech-to-text)
                          ├── Notes (structured sections)
                          ├── Flashcards (question/answer pairs)
                          ├── Quiz (multiple choice questions)
                          └── WhiteboardImages (OCR captures)
```

### Core Models

| Model | Description | Key Fields |
|-------|-------------|------------|
| **User** | Account with plan tier | id, email, name, plan |
| **Semester** | Academic term | id, userId, name, startDate, endDate |
| **Course** | Subject being studied | id, semesterId, name, color |
| **Topic** | Unit within course | id, courseId, name, orderIndex |
| **Lecture** | Single class session | id, topicId, title, transcript, notes, status |
| **Recording** | Audio file | id, lectureId, filepath, durationSeconds |
| **Flashcard** | Study card | id, lectureId, front, back, orderIndex |
| **FlashcardStat** | Spaced repetition data | id, flashcardId, easeFactor, interval, nextReview |
| **Quiz** | Test set | id, lectureId, title |
| **QuizQuestion** | Single question | id, quizId, question, options, correctAnswer |
| **QuizAttempt** | User's quiz result | id, quizId, score, answers |
| **WhiteboardImage** | OCR capture | id, lectureId, filepath, ocrText |
| **Job** | Async processing job | id, type, status, input, output, error |

---

## 3. AI Pipeline Architecture

### Pipeline Flow

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   CAPTURE   │───►│ TRANSCRIBE  │───►│   NOTES     │───►│ FLASHCARDS  │
│   (Audio)   │    │ (Speech→Text)│   │ (Structured)│    │ (Q&A pairs) │
└─────────────┘    └─────────────┘    └─────────────┘    └──────┬──────┘
                                                                │
                   ┌─────────────┐    ┌─────────────┐          ▼
                   │    OCR      │───►│  SUMMARIZE  │    ┌─────────────┐
                   │ (Image→Text)│    │   (Notes)   │    │    QUIZ     │
                   └─────────────┘    └─────────────┘    │ (MCQ tests) │
                                                         └─────────────┘
```

### Pipeline Jobs

Each step is a trackable **Job** with:
- `status`: pending → processing → completed | failed
- `input`: JSON input parameters
- `output`: JSON result data
- `error`: Error message if failed

### AI Provider Pattern

```typescript
// Automatic fallback to mock when AI unavailable
const USE_REAL_AI = !!(process.env.AI_INTEGRATIONS_OPENAI_API_KEY);

async function generateNotes(transcript: string): Promise<string> {
  if (!openai) return generateMockNotes(transcript);  // Fallback
  
  try {
    const response = await openai.chat.completions.create({...});
    return response.choices[0]?.message?.content || generateMockNotes(transcript);
  } catch (error) {
    return generateMockNotes(transcript);  // Graceful degradation
  }
}
```

### Available AI Operations

| Operation | Endpoint | Input | Output |
|-----------|----------|-------|--------|
| Transcription | `POST /api/ai/transcription/request` | audioBase64, lectureId | transcript text |
| Notes | `POST /api/ai/lectures/:id/notes/generate` | lectureId | structured notes |
| Flashcards | `POST /api/ai/lectures/:id/flashcards/generate` | lectureId | flashcard array |
| Quiz | `POST /api/ai/lectures/:id/quizzes/generate` | lectureId | quiz with questions |
| OCR | `POST /api/ai/ocr/extract` | imageBase64 | extracted text |
| Summarize | `POST /api/ai/summarize` | text | summary |
| Notes→Flashcards | `POST /api/ai/notes-to-flashcards` | text, lectureId | flashcard array |
| Notes→Quiz | `POST /api/ai/notes-to-quiz` | text, lectureId | quiz questions |

---

## 4. Study & Retention Engine

### Spaced Repetition (SM-2 Algorithm)

```typescript
// FlashcardStat tracks learning progress
interface FlashcardStat {
  easeFactor: number;    // 1.3 - 2.5+ (difficulty multiplier)
  interval: number;      // Days until next review
  nextReview: Date;      // When card is due
  timesCorrect: number;  // Success count
  timesWrong: number;    // Failure count
}

// After each review:
if (correct) {
  easeFactor += 0.1;
  interval = Math.round(interval * easeFactor);
} else {
  easeFactor = Math.max(1.3, easeFactor - 0.2);
  interval = 1;  // Reset
}
```

### Study Today Planner

Endpoint: `GET /api/adaptive/study-today`

Returns:
- **dueFlashcards**: Cards with nextReview ≤ today
- **weakFlashcards**: Cards with high failure rate
- **weakTopics**: Topics with quiz accuracy < 70%
- **studyStats**: Summary counts

### Progress Tracking

- Per-flashcard: timesCorrect, timesWrong, successRate
- Per-quiz: score, totalQuestions, percentage
- Per-topic: Aggregate quiz accuracy
- Streak tracking: Daily study consistency

---

## 5. Content Capture Systems

### Audio Recording

```typescript
// Client-side capture with expo-av
const recording = new Audio.Recording();
await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
await recording.startAsync();
// ... recording ...
await recording.stopAndUnloadAsync();
const uri = recording.getURI();

// Convert to base64 for API
const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
```

### Image Capture + OCR

```typescript
// Capture whiteboard/slide
const result = await ImagePicker.launchCameraAsync({
  mediaTypes: ImagePicker.MediaTypeOptions.Images,
  quality: 0.8,
});

// Extract text via OCR
const response = await fetch('/api/ai/ocr/extract', {
  method: 'POST',
  body: JSON.stringify({ imageBase64, lectureId })
});
```

### Supported Input Types

| Type | Source | Processing |
|------|--------|------------|
| Audio | Live recording, file upload | Transcription → Notes → Flashcards → Quiz |
| Images | Camera, gallery | OCR → Summary → Flashcards |
| Text | Manual input, paste | Direct to Flashcards/Quiz |

---

## 6. Offline-First Architecture

### Local Storage Strategy

```typescript
// AsyncStorage for persistence
storage.setUser(user);           // Cache user data
storage.getSemesters();          // Retrieve offline
storage.createLecture(data);     // Local-first creation

// Sync pattern (planned)
// 1. Write locally first
// 2. Queue for sync when online
// 3. Resolve conflicts on reconnect
```

### Offline Capabilities

| Feature | Offline Support |
|---------|----------------|
| View content | Full - cached locally |
| Study flashcards | Full - local stats |
| Take quizzes | Full - local scoring |
| Record audio | Full - local storage |
| AI processing | Requires connection |

---

## 7. Build Phases

### Phase 1: Core Infrastructure (Complete)

- [x] User authentication (local + backend)
- [x] Data hierarchy (Semester → Course → Topic → Lecture)
- [x] Local storage with AsyncStorage
- [x] Backend API with Express + Prisma
- [x] AI provider abstraction with mock fallback

### Phase 2: Content Capture (Complete)

- [x] Audio recording with expo-audio
- [x] Image capture with expo-image-picker
- [x] OCR text extraction
- [x] Transcription pipeline

### Phase 3: AI Processing (Complete)

- [x] Transcription (speech-to-text)
- [x] Notes generation (structured format)
- [x] Flashcard generation
- [x] Quiz generation
- [x] Job tracking with status/retry

### Phase 4: Study Features (Complete)

- [x] Flashcard study mode
- [x] Spaced repetition (SM-2)
- [x] Quiz/Exam mode
- [x] Study Today planner
- [x] Progress tracking

### Phase 5: Polish & UX (In Progress)

- [x] Internationalization (12 languages)
- [x] Toast notifications
- [x] Mind map visualization
- [x] Export to PDF
- [ ] Push notifications for study reminders
- [ ] Streak tracking UI

### Phase 6: Production Readiness

- [ ] Backend sync for multi-device
- [ ] Conflict resolution
- [ ] Performance optimization
- [ ] Error monitoring (Sentry)

---

## 8. Technical Decisions & Tradeoffs

### Decision: Local-First with Optional Sync

**Choice**: Store all data locally, sync to backend when available

**Pros**:
- Works fully offline
- Fast response times
- Reduces server costs
- Better UX on poor connections

**Cons**:
- Multi-device sync complexity
- Data conflict potential
- Storage limits on device

### Decision: AI Provider Abstraction

**Choice**: Real AI (OpenAI) with mock fallback

**Pros**:
- App works without API keys
- Easy local development
- Graceful degradation
- Testable without costs

**Cons**:
- Mock quality is limited
- Two code paths to maintain

### Decision: SQLite for Backend

**Choice**: SQLite with Prisma ORM

**Pros**:
- Simple deployment
- No external database service
- Fast for development
- Easy schema migrations

**Cons**:
- Single-server only
- No horizontal scaling
- Limited concurrent writes

### Decision: Expo Managed Workflow

**Choice**: Expo Go compatible (no native modules)

**Pros**:
- Easy testing on devices
- Faster development cycle
- No Xcode/Android Studio
- OTA updates possible

**Cons**:
- Limited native access
- Larger app size
- Expo Go limitations

---

## 9. API Reference

### Authentication

```
POST /api/auth/signup     { email, password, name }
POST /api/auth/login      { email, password }
GET  /api/auth/me         Authorization: Bearer <token>
```

### Content CRUD

```
GET    /api/semesters
POST   /api/semesters     { name, startDate, endDate }
GET    /api/courses/:semesterId
POST   /api/courses       { semesterId, name, color }
GET    /api/topics/:courseId
POST   /api/topics        { courseId, name }
GET    /api/lectures/:topicId
POST   /api/lectures      { topicId, title }
```

### AI Processing

```
POST /api/ai/transcription/request    { lectureId, audioBase64 }
POST /api/ai/lectures/:id/notes/generate
POST /api/ai/lectures/:id/flashcards/generate
POST /api/ai/lectures/:id/quizzes/generate
POST /api/ai/ocr/extract              { imageBase64 }
POST /api/ai/summarize                { text }
POST /api/ai/notes-to-flashcards      { text, lectureId }
POST /api/ai/notes-to-quiz            { text, lectureId }
```

### Study & Adaptive

```
GET  /api/adaptive/study-today
GET  /api/adaptive/stats
POST /api/adaptive/flashcards/:id/answer  { correct: boolean }
POST /api/quizzes/:id/submit              { answers: {} }
```

---

## 10. Quality Bar

### Free Tier Must Provide

- Full study workflow (capture → study)
- Local storage without limits
- Mock AI fallback
- Basic spaced repetition
- Quiz mode

### PRO Adds Power

- Real AI processing
- Higher usage limits
- Advanced analytics
- Cloud sync (future)
- Priority support

### UX Principles

- No feature dumping - every screen has one primary action
- No hidden background work - all processing visible
- Graceful failures - toast errors with retry
- Offline tolerant - works without connection
- Student-safe - no data loss, undo available
