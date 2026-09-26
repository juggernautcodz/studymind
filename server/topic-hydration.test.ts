import assert from "node:assert/strict";
import { after, before, test } from "node:test";

process.env.DATABASE_URL =
  "postgresql://test:test@127.0.0.1:1/studymind_topic_hydration_test";

let prisma: any;
let exportTopic: (topicId: string, userId: string) => Promise<any>;
let originalFindFirst: unknown;
let queries: any[] = [];

before(async () => {
  const [{ default: prismaClient }, syncModule] = await Promise.all([
    import("./db"),
    import("./lib/sync"),
  ]);
  prisma = prismaClient;
  exportTopic = syncModule.exportTopic;
  originalFindFirst = prisma.topic.findFirst;
  prisma.topic.findFirst = async (query: any) => {
    queries.push(query);
    if (
      query.where.id !== "owned-topic" ||
      query.where.userId !== "owner" ||
      query.where.course?.userId !== "owner"
    ) {
      return null;
    }
    return {
      id: "owned-topic",
      userId: "owner",
      courseId: "course-1",
      name: "Owned Topic",
      orderIndex: 0,
      transcript: "Owned transcript",
      notes: "# Owned notes",
      status: "completed",
      createdAt: new Date("2026-09-24T00:00:00.000Z"),
      updatedAt: new Date("2026-09-25T00:00:00.000Z"),
      flashcards: [
        {
          id: "card-1",
          topicId: "owned-topic",
          front: "Front",
          back: "Back",
          orderIndex: 0,
          stats: [],
        },
      ],
      quizzes: [],
      recordings: [],
      whiteboardImages: [],
      sources: [
        {
          id: "source-1",
          title: "Owned Source",
          kind: "TEXT",
          currentRevision: 1,
          updatedAt: new Date("2026-09-25T00:00:00.000Z"),
          revisions: [
            {
              revision: 1,
              segments: [
                {
                  id: "segment-1",
                  position: 0,
                  content: "Owned source content",
                  locatorLabel: null,
                },
              ],
            },
          ],
        },
      ],
    };
  };
});

after(async () => {
  if (!prisma) return;
  prisma.topic.findFirst = originalFindFirst;
  await prisma.$disconnect();
});

test("topic hydration scopes both topic and course to the authenticated owner", async () => {
  queries = [];
  const topic = await exportTopic("owned-topic", "owner");
  assert.equal(topic.id, "owned-topic");
  assert.equal(topic.flashcards[0].id, "card-1");
  assert.equal(
    topic.sources[0].revisions[0].segments[0].content,
    "Owned source content",
  );
  assert.deepEqual(queries[0].where, {
    id: "owned-topic",
    userId: "owner",
    course: { userId: "owner" },
  });
});

test("another user cannot hydrate an owned topic", async () => {
  const topic = await exportTopic("owned-topic", "other-user");
  assert.equal(topic, null);
});
