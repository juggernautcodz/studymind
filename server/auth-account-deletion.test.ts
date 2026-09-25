import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import express from "express";
import jwt from "jsonwebtoken";

process.env.SESSION_SECRET = "phase-8-account-deletion-test-secret";
process.env.DATABASE_URL =
  "postgresql://test:test@127.0.0.1:1/studymind_auth_deletion_test";

let server: Server;
let baseUrl: string;
let prisma: any;
let originalFindUnique: unknown;
let originalTransaction: unknown;
let transactionCount = 0;
let deletedUserIds: string[] = [];

function fakeTransactionClient() {
  const deletionDelegate = {
    deleteMany: async () => ({ count: 0 }),
  };
  return {
    quizAttempt: deletionDelegate,
    quizQuestion: deletionDelegate,
    quiz: deletionDelegate,
    flashcardStat: deletionDelegate,
    flashcard: deletionDelegate,
    recording: deletionDelegate,
    whiteboardImage: deletionDelegate,
    mindmapNode: deletionDelegate,
    topic: deletionDelegate,
    course: deletionDelegate,
    semester: deletionDelegate,
    exam: deletionDelegate,
    job: deletionDelegate,
    purchase: deletionDelegate,
    subscriptionStatus: deletionDelegate,
    usage: deletionDelegate,
    entitlement: deletionDelegate,
    user: {
      delete: async ({ where }: { where: { id: string } }) => {
        deletedUserIds.push(where.id);
        return { id: where.id };
      },
    },
  };
}

before(async () => {
  const originalSetInterval = globalThis.setInterval;
  globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
    const timer = originalSetInterval(...args);
    timer.unref();
    return timer;
  }) as typeof setInterval;
  const [{ default: authRouter }, { default: prismaClient }] =
    await Promise.all([import("./auth"), import("./db")]).finally(() => {
      globalThis.setInterval = originalSetInterval;
    });
  prisma = prismaClient;
  originalFindUnique = prisma.user.findUnique;
  originalTransaction = prisma.$transaction;

  prisma.user.findUnique = async ({ where }: { where: { id: string } }) =>
    where.id === "authenticated-user"
      ? { id: where.id, email: "owner@example.com" }
      : null;
  prisma.$transaction = async (
    operation: (tx: unknown) => Promise<unknown>,
  ) => {
    transactionCount += 1;
    return operation(fakeTransactionClient());
  };

  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
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
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await prisma.$disconnect();
});

beforeEach(() => {
  transactionCount = 0;
  deletedUserIds = [];
});

test("authenticated account deletion deletes only the token owner", async () => {
  const token = jwt.sign(
    { userId: "authenticated-user" },
    process.env.SESSION_SECRET!,
    { expiresIn: "5m" },
  );
  const response = await fetch(`${baseUrl}/api/auth/account`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });

  assert.equal(response.status, 200);
  assert.equal(transactionCount, 1);
  assert.deepEqual(deletedUserIds, ["authenticated-user"]);
});

test("missing authentication cannot delete account or study data", async () => {
  for (const path of ["account", "data"]) {
    const response = await fetch(`${baseUrl}/api/auth/${path}`, {
      method: "DELETE",
    });
    assert.equal(response.status, 401);
  }

  assert.equal(transactionCount, 0);
  assert.deepEqual(deletedUserIds, []);
});

test("invalid and guest tokens cannot fall back to shared guest deletion", async () => {
  for (const token of ["not-a-jwt", "guest-token"]) {
    const response = await fetch(`${baseUrl}/api/auth/account`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 401);
  }

  assert.equal(transactionCount, 0);
  assert.deepEqual(deletedUserIds, []);
});

test("expired authentication cannot delete an account", async () => {
  const token = jwt.sign(
    { userId: "authenticated-user" },
    process.env.SESSION_SECRET!,
    { expiresIn: -1 },
  );
  const response = await fetch(`${baseUrl}/api/auth/account`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });

  assert.equal(response.status, 401);
  assert.equal(transactionCount, 0);
  assert.deepEqual(deletedUserIds, []);
});
