import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import http from "node:http";

import { createOriginalImagesRouter } from "./original-images";

const privateKey = "original-images/v1/ab/private-object.jpg";
const sourceId = "source-1";

function sourceRecord(
  mimeType = "image/jpeg",
  overrides: Record<string, unknown> = {},
) {
  return {
    topicId: "topic",
    whiteboardImageId: "image-1",
    mimeType,
    whiteboardImage: {
      id: "image-1",
      topicId: "topic",
      filepath: privateKey,
      topic: {
        userId: "user",
        courseId: "course",
        course: { userId: "user" },
      },
    },
    ...overrides,
  };
}

function retrievalOptions(options: {
  userId?: string;
  source?: ReturnType<typeof sourceRecord> | null;
  sourceLookup?: (args: any) => Promise<any>;
  exists?: (key: string) => Promise<boolean>;
  pipeTo?: (key: string, destination: any) => Promise<void>;
  unauthenticated?: boolean;
}) {
  return {
    authenticate: options.unauthenticated
      ? (_req: any, res: any) =>
          res.status(401).json({ error: "Authentication required" })
      : (req: any, _res: any, next: () => void) => {
          req.user = { id: options.userId ?? "user", email: "user@example.com" };
          next();
        },
    db: {
      topic: { findFirst: async () => null },
      source: {
        findFirst:
          options.sourceLookup ?? (async () => options.source ?? sourceRecord()),
      },
      whiteboardImage: {
        findUnique: async () => null,
        create: async () => {
          throw new Error("not used");
        },
      },
    },
    storage: {
      uploadBytes: async () => {
        throw new Error("not used");
      },
      exists: options.exists ?? (async () => true),
      pipeTo:
        options.pipeTo ??
        (async (_key: string, destination: any) => {
          destination.end(Buffer.from("private image bytes"));
        }),
      deleteIfPresent: async () => {},
    },
  } as any;
}

async function withRetrievalRouter(
  options: Parameters<typeof createOriginalImagesRouter>[0],
  run: (baseUrl: string) => Promise<void>,
) {
  const app = express();
  app.use("/api", createOriginalImagesRouter(options));
  const server = await new Promise<http.Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

function retrievalUrl(baseUrl: string, courseId = "course", id = sourceId) {
  return `${baseUrl}/courses/${courseId}/sources/${id}/original-image`;
}

test("original image retrieval requires authentication before database or storage access", async () => {
  let sourceLookups = 0;
  let storageCalls = 0;
  await withRetrievalRouter(
    retrievalOptions({
      unauthenticated: true,
      sourceLookup: async () => {
        sourceLookups++;
        return sourceRecord();
      },
      exists: async () => {
        storageCalls++;
        return true;
      },
    }),
    async (baseUrl) => {
      const response = await fetch(retrievalUrl(baseUrl));
      assert.equal(response.status, 401);
    },
  );
  assert.equal(sourceLookups, 0);
  assert.equal(storageCalls, 0);
});

test("wrong course and user ownership return the same non-enumerating 404", async () => {
  const bodies: string[] = [];
  const run = async (userId: string, courseId: string) => {
    await withRetrievalRouter(
      retrievalOptions({
        userId,
        sourceLookup: async ({ where }: any) =>
          where.courseId === "course" && where.course.userId === "user"
            ? sourceRecord()
            : null,
      }),
      async (baseUrl) => {
        const response = await fetch(retrievalUrl(baseUrl, courseId));
        assert.equal(response.status, 404);
        bodies.push(await response.text());
      },
    );
  };

  await run("user", "foreign-course");
  await run("foreign-user", "course");
  assert.equal(bodies[0], bodies[1]);
  assert.equal(bodies[0].includes("foreign"), false);
  assert.equal(bodies[0].includes(privateKey), false);
});

test("a source without a linked whiteboard image returns a safe 404", async () => {
  await withRetrievalRouter(
    retrievalOptions({
      source: sourceRecord("image/jpeg", {
        whiteboardImageId: null,
        whiteboardImage: null,
      }),
    }),
    async (baseUrl) => {
      const response = await fetch(retrievalUrl(baseUrl));
      const body = await response.text();
      assert.equal(response.status, 404);
      assert.equal(body.includes(privateKey), false);
    },
  );
});

test("missing image metadata and missing stored objects return the same safe 404", async () => {
  const bodies: string[] = [];
  for (const options of [
    retrievalOptions({
      source: sourceRecord("image/jpeg", { whiteboardImage: null }),
    }),
    retrievalOptions({ exists: async () => false }),
  ]) {
    await withRetrievalRouter(options, async (baseUrl) => {
      const response = await fetch(retrievalUrl(baseUrl));
      assert.equal(response.status, 404);
      bodies.push(await response.text());
    });
  }
  assert.equal(bodies[0], bodies[1]);
  assert.equal(bodies[0].includes(privateKey), false);
});

test("retrieval streams supported image types with private no-store headers", async () => {
  for (const mimeType of [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
  ]) {
    const bytes = Buffer.from(`bytes:${mimeType}`);
    const storageKeys: string[] = [];
    await withRetrievalRouter(
      retrievalOptions({
        source: sourceRecord(mimeType),
        exists: async (key) => {
          storageKeys.push(key);
          return true;
        },
        pipeTo: async (key, destination) => {
          storageKeys.push(key);
          destination.end(bytes);
        },
      }),
      async (baseUrl) => {
        const response = await fetch(retrievalUrl(baseUrl));
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("content-type"), mimeType);
        assert.equal(
          response.headers.get("cache-control"),
          "private, no-store, max-age=0",
        );
        assert.equal(response.headers.get("pragma"), "no-cache");
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
        assert.equal([...response.headers.values()].join(" ").includes(privateKey), false);
      },
    );
    assert.deepEqual(storageKeys, [privateKey, privateKey]);
  }
});

test("storage failures are sanitized without object key or provider leakage", async () => {
  const providerSecret = `provider failure for bucket ${privateKey}`;
  for (const options of [
    retrievalOptions({
      exists: async () => {
        throw new Error(providerSecret);
      },
    }),
    retrievalOptions({
      pipeTo: async () => {
        throw new Error(providerSecret);
      },
    }),
  ]) {
    await withRetrievalRouter(options, async (baseUrl) => {
      const response = await fetch(retrievalUrl(baseUrl));
      const body = await response.text();
      assert.equal(response.status, 503);
      assert.equal(body.includes(privateKey), false);
      assert.equal(body.includes("provider"), false);
      assert.equal(body.includes("bucket"), false);
    });
  }
});

test("inconsistent source and image topic linkage is rejected before storage access", async () => {
  let storageCalls = 0;
  await withRetrievalRouter(
    retrievalOptions({
      source: sourceRecord("image/jpeg", {
        whiteboardImage: {
          ...sourceRecord().whiteboardImage,
          topicId: "different-topic",
        },
      }),
      exists: async () => {
        storageCalls++;
        return true;
      },
    }),
    async (baseUrl) => {
      const response = await fetch(retrievalUrl(baseUrl));
      assert.equal(response.status, 404);
    },
  );
  assert.equal(storageCalls, 0);
});
