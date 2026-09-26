import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { AuthRequest } from "./auth";

import express from "express";
import jwt from "jsonwebtoken";

process.env.SESSION_SECRET = "phase-8-guest-startup-test-secret";
process.env.DATABASE_URL =
  "postgresql://test:test@127.0.0.1:1/studymind_guest_startup_test";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "phase-8-test-key";

const ANONYMOUS_USER_ID = "anonymous-guest-user";

let prisma: any;
let originalFindUnique: unknown;
let originalTransaction: unknown;
let originalTopicFindFirst: unknown;
let originalSemesterFindMany: unknown;
let ensureAnonymousUserExists: () => Promise<void>;
let registerRoutes: (app: express.Express) => Promise<Server>;
let server: Server;
let baseUrl: string;
let guestExists = false;
let transactionCount = 0;
let guestCreateCount = 0;
let importMutationCount = 0;

async function withUnrefIntervals<T>(work: () => Promise<T>): Promise<T> {
  const originalSetInterval = globalThis.setInterval;
  globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
    const timer = originalSetInterval(...args);
    timer.unref();
    return timer;
  }) as typeof setInterval;
  try {
    return await work();
  } finally {
    globalThis.setInterval = originalSetInterval;
  }
}

function fakeTransactionClient() {
  return {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === ANONYMOUS_USER_ID && guestExists
          ? { id: ANONYMOUS_USER_ID }
          : null,
      create: async () => {
        guestExists = true;
        guestCreateCount += 1;
        return { id: ANONYMOUS_USER_ID };
      },
    },
    semester: {
      create: async () => ({ id: "guest-semester" }),
    },
    course: {
      create: async () => ({ id: "guest-course" }),
    },
    topic: {
      create: async () => ({ id: "guest-topic" }),
    },
    flashcard: {
      createMany: async () => ({ count: 1 }),
    },
  };
}

before(async () => {
  const { default: prismaClient } = await import("./db");
  prisma = prismaClient;
  originalFindUnique = prisma.user.findUnique;
  originalTransaction = prisma.$transaction;
  originalTopicFindFirst = prisma.topic.findFirst;
  originalSemesterFindMany = prisma.semester.findMany;

  prisma.user.findUnique = async ({ where }: { where: { id?: string } }) => {
    if (where.id === "authenticated-user") {
      return { id: "authenticated-user", email: "owner@example.com" };
    }
    if (where.id === ANONYMOUS_USER_ID && guestExists) {
      return { id: ANONYMOUS_USER_ID, email: "guest@studymind.local" };
    }
    return null;
  };
  prisma.$transaction = async (
    operation: (tx: unknown) => Promise<unknown>,
  ) => {
    transactionCount += 1;
    return operation(fakeTransactionClient());
  };
  prisma.topic.findFirst = async () =>
    guestExists
      ? {
          id: "guest-topic",
          name: "Introduction to Photosynthesis",
          course: {
            id: "guest-course",
            name: "My Course",
            semester: { id: "guest-semester", name: "My Semester" },
          },
        }
      : null;
  prisma.semester.findMany = async () => [];

  transactionCount = 0;
  guestCreateCount = 0;
  const [guestModule, authModule, studyModule, routesModule] =
    await withUnrefIntervals(() =>
      Promise.all([
        import("./guest-provisioning"),
        import("./auth"),
        import("./study"),
        import("./routes"),
      ]),
    );
  importMutationCount = transactionCount + guestCreateCount;
  ensureAnonymousUserExists = guestModule.ensureAnonymousUserExists;
  registerRoutes = routesModule.registerRoutes;

  const app = express();
  app.use(express.json());
  app.use("/api", studyModule.default);
  app.get(
    "/guest-probe",
    authModule.guestOrAuthMiddleware,
    (req: AuthRequest, res) => res.json({ user: req.user }),
  );
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (!prisma || !server) return;
  prisma.user.findUnique = originalFindUnique;
  prisma.$transaction = originalTransaction;
  prisma.topic.findFirst = originalTopicFindFirst;
  prisma.semester.findMany = originalSemesterFindMany;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await prisma.$disconnect();
});

beforeEach(() => {
  guestExists = false;
  transactionCount = 0;
  guestCreateCount = 0;
});

test("importing guest, auth, study, and route modules is database-read-only", () => {
  assert.equal(importMutationCount, 0);
});

test("route registration does not provision the guest identity", async () => {
  await withUnrefIntervals(() => registerRoutes(express()));
  assert.equal(transactionCount, 0);
  assert.equal(guestCreateCount, 0);
  assert.equal(guestExists, false);
});

test("explicit guest demo-data request provisions and returns demo content", async () => {
  const response = await fetch(`${baseUrl}/api/guest/demo-data`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).topicId, "guest-topic");
  assert.equal(transactionCount, 1);
  assert.equal(guestCreateCount, 1);
});

test("lazy guest provisioning is idempotent", async () => {
  await Promise.all([
    ensureAnonymousUserExists(),
    ensureAnonymousUserExists(),
    ensureAnonymousUserExists(),
  ]);
  await ensureAnonymousUserExists();
  assert.equal(transactionCount, 1);
  assert.equal(guestCreateCount, 1);
});

test("legacy guest middleware provisions only when guest mode is used", async () => {
  const response = await fetch(`${baseUrl}/guest-probe`, {
    headers: { Authorization: "Bearer guest-token" },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.id, ANONYMOUS_USER_ID);
  assert.equal(transactionCount, 1);
  assert.equal(guestCreateCount, 1);
});

test("valid authenticated requests do not provision the guest identity", async () => {
  const token = jwt.sign(
    { userId: "authenticated-user" },
    process.env.SESSION_SECRET!,
    { expiresIn: "5m" },
  );
  const response = await fetch(`${baseUrl}/guest-probe`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.id, "authenticated-user");
  assert.equal(transactionCount, 0);
  assert.equal(guestCreateCount, 0);
});
