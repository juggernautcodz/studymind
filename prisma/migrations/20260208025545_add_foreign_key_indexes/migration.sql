-- CreateIndex
CREATE INDEX "Course_userId_idx" ON "Course"("userId");

-- CreateIndex
CREATE INDEX "Course_semesterId_idx" ON "Course"("semesterId");

-- CreateIndex
CREATE INDEX "Exam_userId_idx" ON "Exam"("userId");

-- CreateIndex
CREATE INDEX "Flashcard_lectureId_idx" ON "Flashcard"("lectureId");

-- CreateIndex
CREATE INDEX "FlashcardStat_userId_idx" ON "FlashcardStat"("userId");

-- CreateIndex
CREATE INDEX "Job_status_idx" ON "Job"("status");

-- CreateIndex
CREATE INDEX "Lecture_userId_idx" ON "Lecture"("userId");

-- CreateIndex
CREATE INDEX "Lecture_topicId_idx" ON "Lecture"("topicId");

-- CreateIndex
CREATE INDEX "MindmapNode_userId_idx" ON "MindmapNode"("userId");

-- CreateIndex
CREATE INDEX "MindmapNode_courseId_idx" ON "MindmapNode"("courseId");

-- CreateIndex
CREATE INDEX "MindmapNode_parentId_idx" ON "MindmapNode"("parentId");

-- CreateIndex
CREATE INDEX "Purchase_userId_idx" ON "Purchase"("userId");

-- CreateIndex
CREATE INDEX "Quiz_lectureId_idx" ON "Quiz"("lectureId");

-- CreateIndex
CREATE INDEX "QuizAttempt_userId_idx" ON "QuizAttempt"("userId");

-- CreateIndex
CREATE INDEX "QuizAttempt_quizId_idx" ON "QuizAttempt"("quizId");

-- CreateIndex
CREATE INDEX "QuizQuestion_quizId_idx" ON "QuizQuestion"("quizId");

-- CreateIndex
CREATE INDEX "Recording_lectureId_idx" ON "Recording"("lectureId");

-- CreateIndex
CREATE INDEX "Semester_userId_idx" ON "Semester"("userId");

-- CreateIndex
CREATE INDEX "Topic_userId_idx" ON "Topic"("userId");

-- CreateIndex
CREATE INDEX "Topic_courseId_idx" ON "Topic"("courseId");

-- CreateIndex
CREATE INDEX "WhiteboardImage_lectureId_idx" ON "WhiteboardImage"("lectureId");
