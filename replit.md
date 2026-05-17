# replit.md

## Overview

StudyMind is a cross-platform study application built with React Native (Expo) and Express.js. The app helps students transform recordings into organized study materials including AI-generated notes, flashcards, and quizzes. Content is organized hierarchically: Semester → Course → Topic → Content. All content (transcript, notes, flashcards, quizzes, recordings, whiteboard images) belongs directly to Topics. The application includes mind-map visualization for course navigation and image capture with OCR capabilities. The app supports 12 major languages for full internationalization. Topic screens feature a tabbed interface (Notes, Cards, Quiz) showing content directly. Course screens aggregate content from all topics within that course.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React Native with Expo SDK 55 (new architecture enabled)
- **Navigation**: React Navigation v7 with native stack and bottom tab navigators
- **State Management**: React Query for server state, React Context for auth state
- **Styling**: React Native StyleSheet with a custom theme system supporting light/dark modes
- **Animations**: React Native Reanimated for fluid animations and gestures
- **Path Aliases**: `@/` maps to `./client`, `@shared/` maps to `./shared`
- **Internationalization**: i18n-js with expo-localization for multi-language support

### Backend Architecture
- **Framework**: Express.js 5 with TypeScript
- **API Pattern**: RESTful endpoints prefixed with `/api`
- **Storage**: In-memory storage adapter (`MemStorage`) with interface for database swap
- **File Handling**: Multer for file uploads

### Data Layer
- **ORM**: Prisma with SQLite for app data
- **Schema Location**: `prisma/schema.prisma`
- **Migrations**: `prisma/migrations/` directory
- **Validation**: Zod schemas for API request/response
- **Client Storage**: AsyncStorage for local persistence and entitlement caching

### AI Integration Pattern
- **Design**: Provider-based architecture with real AI via Replit AI Integrations + mock fallback
- **Real AI**: Uses OpenAI through Replit AI Integrations (`server/ai-providers.ts`)
- **Mock Mode**: Falls back to mock implementations when AI unavailable (`client/lib/mockAI.ts`)
- **Providers**: Transcription, Notes, Flashcards, Quiz, OCR, Summarization
- **Auto-Detection**: `USE_REAL_AI` flag detects Replit AI Integrations availability
- **Audio Conversion**: Auto-converts WebM/MP4/OGG to WAV via ffmpeg for transcription

### Notes/Image Capture (OCR)
- **Location**: Camera and Gallery buttons in Add Content row (CourseScreen, TopicScreen)
- **Features**:
  - Camera capture or gallery selection for notes/textbook images
  - OCR text extraction from captured images
  - AI-powered summarization of extracted text
  - Generate flashcards directly from captured content
  - Generate quizzes directly from captured content
- **API Endpoints**:
  - `POST /api/ai/summarize` - Summarize OCR text into study-friendly format
  - `POST /api/ai/notes-to-flashcards` - Generate flashcards from notes text
  - `POST /api/ai/notes-to-quiz` - Generate quiz questions from notes text

### Authentication
- **Current**: Local auth context with AsyncStorage persistence
- **Pattern**: JWT-ready with token storage infrastructure
- **Middleware**: `requireAuth` pattern prepared for server-side routes

### Billing/Plans (In-App Purchases)
- **Tiers**: FREE, BASE (lifetime), PRO (subscription)
- **Payment Method**: Platform-native IAP (iOS App Store / Google Play) - NO Stripe in mobile apps
- **Backend**: Receipt validation with stubs for development (`TEST_RECEIPT`, `TEST_TOKEN`)
- **Models**: SubscriptionStatus, Purchase, Entitlement, Usage (Prisma/SQLite)
- **Tracking**: Recording count (lifetime), transcription minutes (monthly), storage bytes
- **Frontend**: BillingContext for entitlement management, usePaywall hook for feature gating

#### IAP Products
- `com.studymind.base.lifetime` - $9.99 one-time (non-consumable)
- `com.studymind.pro.monthly` - $4.99/month (auto-renewing subscription)
- `com.studymind.pro.yearly` - $49.99/year (auto-renewing subscription)

#### API Endpoints
- `GET /api/billing/products` - List available IAP products
- `POST /api/billing/verify` - Validate purchase receipts
- `GET /api/billing/entitlements` - Get current plan and usage

#### Testing
- Use `TEST_RECEIPT` (iOS) or `TEST_TOKEN` (Android) for development
- See `docs/IAP-BILLING-README.md` for production implementation

## External Dependencies

### Database
- PostgreSQL via `DATABASE_URL` environment variable
- Drizzle Kit for migrations (`./migrations` directory)

### Upload-First Audio Flow
- **Purpose**: Upload audio files and transcribe without pre-selecting a topic
- **Endpoints**:
  - `POST /api/ai/transcription/upload` - Upload audio (base64), returns jobId; no topicId needed
  - `POST /api/ai/transcription/attach` - Attach completed job transcript to a topic
  - `GET /api/ai/jobs/:jobId` - Poll job status (ownership-checked)
- **Client Flow**: Pick audio file → upload → poll job → create topic (named from filename) → attach transcript → generate study materials
- **Security**: Job model has userId field; all job endpoints enforce ownership checks

### AI Services (Stubbed)
- Transcription service (speech-to-text)
- Notes generation (transcript → structured notes)
- Flashcard generation
- Quiz generation
- OCR service (image → text)

### Client-Side Libraries
- `expo-audio`: Audio recording
- `expo-image-picker`: Camera/gallery access for whiteboard capture
- `expo-file-system`: Local file management
- `expo-haptics`: Tactile feedback
- `expo-notifications`: Push notifications for study reminders
- `expo-sharing`: Export and share notes/flashcards as PDF
- `expo-print`: PDF generation for exports

### Search Feature
- **API**: `GET /api/search?q={query}` - Full-text search across lectures, notes, flashcards, topics, courses
- **Frontend**: SearchScreen with debounced input (`client/screens/SearchScreen.tsx`)
- **Access**: Search icon in Dashboard header opens modal search
- **Hook**: `useDebounce` hook for performant search (`client/hooks/useDebounce.ts`)

### Push Notifications
- **Service**: `client/lib/notifications.ts` - Registration, scheduling, and management
- **Settings**: NotificationSettingsScreen for user preferences
- **Types**: Daily study reminders, streak reminders, due cards notifications
- **Scheduling**: Uses expo-notifications for local scheduled notifications

### Export/Sharing
- **Service**: `client/lib/export.ts` - PDF and text export utilities
- **Formats**: PDF (styled HTML), plain text
- **Content**: Notes, flashcards, or combined study materials
- **Access**: Share button in lecture screen header

### Spaced Repetition
- **Algorithm**: SM-2 (SuperMemo 2) implementation in `server/adaptive.ts`
- **Tracking**: easeFactor, interval, nextReview dates per flashcard
- **Rating Scale**: 0-5 (Again, Hard, Good, Easy)
- **API**: `POST /api/flashcards/:id/review` with quality rating

### Help & FAQ
- **Location**: Settings tab → Help & FAQ (`client/screens/HelpScreen.tsx`)
- **Sections**:
  - Getting Started: Expandable FAQs for new users
  - What This App Can Do: Feature cards for all app capabilities
  - More Questions: Additional FAQs about plans, offline use, etc.
- **Access**: Settings → SUPPORT → Help & FAQ

### Internationalization (i18n)
- **Framework**: i18n-js with expo-localization for device language detection
- **Context**: LanguageContext (`client/contexts/LanguageContext.tsx`)
- **Translation Files**: `client/i18n/locales/` directory
- **Supported Languages**: English (en), Spanish (es), French (fr), German (de), Portuguese (pt), Italian (it), Chinese (zh), Japanese (ja), Korean (ko), Arabic (ar), Hindi (hi), Russian (ru)
- **Features**:
  - Auto-detects device language on first launch
  - User can manually select language in Settings → Language
  - Language preference persisted in AsyncStorage
  - RTL support for Arabic
- **Usage**: `const { t } = useLanguage(); t('key.path')`
- **Screen**: LanguageScreen (`client/screens/LanguageScreen.tsx`)

## UI Component Library

### Core Components (client/components/)
- **Button**: Variants (primary/secondary/ghost/destructive), sizes (sm/md/lg), loading states, icon support
- **Toast**: Context-based notification system with success/error/warning/info variants
- **LoadingState**: Animated loading spinner with customizable messages
- **ProcessingTimeline**: Multi-step progress indicator for lecture processing pipeline
- **SectionHeader**: Reusable section headers with icons and action buttons
- **StatusChip**: Compact status labels with variants (success/warning/error/info)
- **Card**: Elevated container with consistent styling
- **Badge**: Inline status indicators
- **BottomSheet**: Modal sheets for forms and actions
- **Input**: Styled text inputs with labels
- **ListItem**: Consistent list row component
- **EmptyState**: Placeholder for empty content areas

### UX Patterns
- **Next Best Action**: Dashboard intelligently suggests next steps based on user's content state
- **Quick Actions**: Add Content row on CourseScreen/TopicScreen: Record, Camera, Gallery, Upload, Clipboard
  - Dashboard has two rows: Add Content + Study Tools (Study, Exam, Mind Map, Search, Write)
- **Content Destination Picker**: Before saving/generating study materials from Clipboard/Upload/Camera/Gallery, a bottom sheet asks the user to choose:
  1. "Add to this topic" - merge/append into existing topic
  2. "Create new topic" - auto-create topic with source-based name (e.g., "Clipboard - Mar 14, 3:20 PM")
  3. "New section in this topic" - append with a labeled source section (e.g., heading "Clipboard (Mar 14, 3:20 PM)")
  - Component: `client/components/ContentDestinationSheet.tsx`
  - Integrated in: CourseScreen, TopicScreen
- **Cumulative Storage**: Notes, flashcards, and quiz questions append/merge instead of overwriting when content is added to the same topic
- **Course/Topic Tabs**: Topics, Notes, Cards, Quiz (no Scan tab)
- **Quick Record Flow**: 2 taps from Dashboard to start recording (Dashboard → select topic → auto-creates lecture → Record)
- **Quick Study Flow**: 1 tap from Dashboard to flashcard study
- **Processing Timeline**: Visual step-by-step progress during lecture processing
- **Status Chips**: Clear visual indicators for lecture states (New, Processing, Ready)
- **Primary CTAs**: Every screen has one obvious primary call-to-action
- **Premium Mind Map Drawer**: Animated slide-in drawer with stats, badges, and contextual actions
- **Icon-based Empty States**: EmptyState component supports icons with customizable colors
- **Outcome-focused Microcopy**: Clear, action-oriented language (e.g., "Your AI study assistant is ready")

### Design Tokens (client/constants/theme.ts)
- Spacing scale: xs, sm, md, lg, xl, 2xl, 3xl, 4xl
- Border radius: xs, sm, md, lg, xl, full
- Shadow definitions: sm, md, lg
- Color palette: link, success, warning, error, info, text, background variants

### Environment Variables
- `DATABASE_URL`: PostgreSQL connection string
- `EXPO_PUBLIC_API_URL`: Production API base URL (required for release builds)
- `EXPO_PUBLIC_DOMAIN`: API server domain for Replit dev (fallback for dev)
- `EXPO_PUBLIC_PRIVACY_POLICY_URL`: Hosted privacy policy URL
- `REPLIT_DEV_DOMAIN`: Development domain for Expo/CORS configuration

### Deployment (Web)
- **Build**: `node scripts/build.cjs` → runs `npx expo export --platform web` (output: `dist/`) + `npm run server:build` (output: `server_dist/index.mjs`)
- **Run**: `NODE_ENV=production node server_dist/index.mjs` → Express serves `dist/` for web + API routes + Expo Go manifests from `static-build/`
- **No Metro in production**: Build uses `expo export` (offline bundler), not Metro dev server
- **Health check**: `GET /api/health` → `{"status":"ok","timestamp":"..."}`
- **Port**: `process.env.PORT || 5000` with `0.0.0.0` binding
- **Deployment target**: Autoscale (Cloud Run)

### Build & Release (Android)
- **EAS config**: `eas.json` with development / preview / production profiles
- **Production build**: `eas build --platform android --profile production` → signed AAB
- **Version**: `expo.version` (user-visible) + `expo.android.versionCode` (auto-incremented by EAS)
- **Dev-mode guards**: DEV_MODE_PRO toggle hidden in release (`__DEV__`), TEST_RECEIPT/TEST_TOKEN rejected when `NODE_ENV=production`
- **Full guide**: `docs/BUILD-AND-RELEASE.md`