# Design Guidelines: Student Study App

## 1. Brand Identity

**Purpose**: Empower students to transform scattered lecture content into organized, actionable study materials.

**Aesthetic Direction**: Editorial/Academic Refined
- Clean, structured layouts inspired by well-designed textbooks and academic journals
- Generous whitespace for mental clarity during study sessions
- Typographic hierarchy that mirrors academic paper structure (h1 → h6)
- Trustworthy and focused, avoiding playful distractions
- Subtle depth through layered surfaces, not heavy shadows

**Memorable Element**: The mind-map visualization is the centerpiece—a visual brain dump that makes complex course structures tangible and navigable.

---

## 2. Navigation Architecture

**Root Navigation**: Persistent sidebar + main content area (web-first desktop layout, collapsible drawer on mobile)

**Information Architecture**:
- Dashboard (Home)
- Courses (organized by semesters)
- Mind Map (per course)
- Study Materials (notes/flashcards/quiz per lecture)
- Settings & Billing

**Screen List**:
1. Login/Signup
2. Dashboard (semester/course overview)
3. Course Detail (topics + lectures list)
4. Mind Map View (interactive graph)
5. Record Lecture
6. Lecture Detail (notes/flashcards/quiz tabs)
7. Whiteboard Upload
8. Settings/Profile
9. Billing/Upgrade

---

## 3. Screen-by-Screen Specifications

### Login/Signup
- **Layout**: Centered card, 400px max-width, vertically centered
- **Header**: None (standalone screen)
- **Components**: Email/password fields, primary CTA button, "Switch to signup/login" link below
- **Safe area**: Natural viewport centering

### Dashboard
- **Layout**: 
  - Sidebar: Fixed left, 240px wide (collapsible on mobile)
  - Main: Scrollable grid of semester cards
- **Header**: Page title "Dashboard" + "New Semester" button (top-right)
- **Components**: 
  - Semester cards (2-column grid on desktop, 1-column mobile)
  - Each card shows: semester name, course count, quick action menu (edit/delete)
- **Safe area**: 
  - Top: Spacing.xl
  - Sides: Spacing.xl
  - Bottom: Spacing.xl

### Course Detail
- **Layout**: 
  - Breadcrumb nav: Semester > Course
  - Two-column layout (Topics left, Lectures right)
- **Header**: Custom with course name + "Add Topic/Lecture" buttons
- **Components**:
  - Left panel: Accordion list of topics (expandable)
  - Right panel: Lecture cards (name, date, status badges for transcription/notes)
- **Safe area**: Top: Spacing.xl, Sides: Spacing.xl, Bottom: Spacing.xl

### Mind Map View
- **Layout**: Full-screen canvas
- **Header**: Transparent header with course name, back button (left), "Auto-generate" button (right)
- **Components**:
  - SVG/Canvas rendering area for nodes/edges
  - Floating detail drawer (right side, 360px) when node selected
  - Node cards: rounded rectangles with title, type badge, content count indicators
- **Safe area**: 
  - Top: headerHeight + Spacing.xl
  - Sides: 0 (full bleed canvas)
  - Bottom: Spacing.xl

### Record Lecture
- **Layout**: Centered flow, max-width 600px
- **Header**: "Record Lecture" title, cancel button (left)
- **Components**:
  - Waveform visualization (realtime audio feedback)
  - Large circular record/stop button (center)
  - Timer display
  - Upload file option (alternative to recording)
  - Status indicator when processing ("Transcribing...")
- **Safe area**: Top/Bottom/Sides: Spacing.xl

### Lecture Detail
- **Layout**: Tabbed interface
- **Header**: Lecture name + date, tab navigation (Notes/Flashcards/Quiz/Whiteboard)
- **Components**:
  - **Notes tab**: Structured document view (headings + bullets), scrollable
  - **Flashcards tab**: Card flip UI, prev/next buttons, progress (3/10)
  - **Quiz tab**: Question card, multiple choice options, submit button
  - **Whiteboard tab**: Image gallery + OCR text below each image
- **Safe area**: Top: Spacing.xl, Sides: Spacing.xl, Bottom: Spacing.xl

### Settings/Profile
- **Layout**: Form layout
- **Header**: "Settings"
- **Components**: User avatar (editable), email display, plan badge, logout button (destructive style)
- **Safe area**: Standard insets

### Billing/Upgrade
- **Layout**: Pricing table (3 tiers: Free/Base/Pro)
- **Header**: "Upgrade Plan"
- **Components**: Plan cards with feature lists, "Current Plan" badge, "Select Plan" CTAs
- **Safe area**: Standard insets

---

## 4. Color Palette

**Primary**: #2B4C7E (Deep Academic Blue) - primary actions, links, active states
**Primary Light**: #4A6FA5 (hover states)
**Secondary**: #8B5E3C (Warm Terracotta) - accents, success states
**Background**: #F8F9FA (Soft Gray) - page background
**Surface**: #FFFFFF (White) - cards, panels
**Surface Elevated**: #FFFFFF with subtle shadow
**Text Primary**: #1A1A1A (Near Black)
**Text Secondary**: #6B7280 (Medium Gray)
**Border**: #E5E7EB (Light Gray)
**Success**: #10B981 (Green) - completed transcriptions
**Warning**: #F59E0B (Amber) - usage limits
**Error**: #EF4444 (Red) - destructive actions
**Info**: #3B82F6 (Blue) - processing states

---

## 5. Typography

**Font**: Inter (Google Font) for all text—clean, legible, professional
**Type Scale**:
- **Display**: 32px/40px, Bold (dashboard headings)
- **H1**: 24px/32px, Bold (page titles)
- **H2**: 20px/28px, Semibold (section headings)
- **H3**: 18px/26px, Semibold (card titles)
- **Body**: 16px/24px, Regular (main content)
- **Body Small**: 14px/20px, Regular (metadata, captions)
- **Label**: 12px/16px, Medium, uppercase tracking (badges, labels)

---

## 6. Assets to Generate

1. **icon.png** - App icon featuring stylized brain/mind-map motif in Primary Blue
   - **WHERE USED**: Browser tab, mobile home screen

2. **splash-icon.png** - Simplified icon version for loading screen
   - **WHERE USED**: App launch screen

3. **empty-semesters.png** - Illustration of a calendar/book stack
   - **WHERE USED**: Dashboard when no semesters exist

4. **empty-courses.png** - Illustration of open notebook
   - **WHERE USED**: Semester view when no courses added

5. **empty-lectures.png** - Illustration of microphone + notes
   - **WHERE USED**: Course view when no lectures recorded

6. **empty-mindmap.png** - Subtle node/connection pattern
   - **WHERE USED**: Mind map view before any nodes created

7. **processing-animation.png** (or GIF) - Pulsing waveform or spinner
   - **WHERE USED**: Recording upload status screen

8. **default-avatar.png** - Simple academic cap or initials placeholder
   - **WHERE USED**: User profile (default before custom upload)

**Style for all assets**: Line-art style illustrations using Primary Blue and Secondary Terracotta, minimal detail, clean vector aesthetic.