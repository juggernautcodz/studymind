import assert from "node:assert/strict";
import { test } from "node:test";
import { PassThrough, Readable, Writable } from "node:stream";
import type { RequestError, Result } from "@replit/object-storage";
import {
  createOriginalImageStorage,
  OriginalImageStorageError,
} from "./lib/original-image-storage";

type FakeClient = {
  uploadFromBytes: (
    objectKey: string,
    bytes: Buffer,
    options: { compress: false },
  ) => Promise<Result<null, RequestError>>;
  downloadAsStream: (
    objectKey: string,
    options: { decompress: false },
  ) => Readable;
  exists: (objectKey: string) => Promise<Result<boolean, RequestError>>;
  delete: (
    objectKey: string,
    options: { ignoreNotFound: true },
  ) => Promise<Result<null, RequestError>>;
};

function successfulClient(overrides: Partial<FakeClient> = {}): FakeClient {
  return {
    uploadFromBytes: async () => ({ ok: true, value: null }),
    downloadAsStream: () => Readable.from([]),
    exists: async () => ({ ok: true, value: false }),
    delete: async () => ({ ok: true, value: null }),
    ...overrides,
  };
}

function collectWritable(chunks: Buffer[]): Writable {
  return new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
}

test("storage client is initialized lazily and only once", async () => {
  let factoryCalls = 0;
  const storage = createOriginalImageStorage({
    clientFactory: () => {
      factoryCalls += 1;
      return successfulClient();
    },
  });

  assert.equal(factoryCalls, 0);
  await storage.exists("original-images/v1/ab/image-id.jpg");
  await storage.deleteIfPresent("original-images/v1/ab/image-id.jpg");
  assert.equal(factoryCalls, 1);
});

test("uploadBytes preserves bytes and disables provider compression", async () => {
  const bytes = Buffer.from("original-image-bytes");
  let received: unknown;
  const storage = createOriginalImageStorage({
    clientFactory: () =>
      successfulClient({
        uploadFromBytes: async (objectKey, uploadBytes, options) => {
          received = { objectKey, uploadBytes, options };
          return { ok: true, value: null };
        },
      }),
  });

  await storage.uploadBytes("original-images/v1/ab/image-id.jpg", bytes);
  assert.deepEqual(received, {
    objectKey: "original-images/v1/ab/image-id.jpg",
    uploadBytes: bytes,
    options: { compress: false },
  });
});

test("exists returns the provider result and deleteIfPresent ignores missing objects", async () => {
  const calls: unknown[] = [];
  const storage = createOriginalImageStorage({
    clientFactory: () =>
      successfulClient({
        exists: async () => ({ ok: true, value: true }),
        delete: async (objectKey, options) => {
          calls.push({ objectKey, options });
          return { ok: true, value: null };
        },
      }),
  });

  assert.equal(await storage.exists("original-images/v1/ab/image-id.jpg"), true);
  await storage.deleteIfPresent("original-images/v1/ab/image-id.jpg");
  assert.deepEqual(calls, [
    {
      objectKey: "original-images/v1/ab/image-id.jpg",
      options: { ignoreNotFound: true },
    },
  ]);
});

test("provider results and initialization rejections become internal storage errors", async () => {
  const providerFailure = createOriginalImageStorage({
    clientFactory: () =>
      successfulClient({
        uploadFromBytes: async () => ({
          ok: false,
          error: { message: "bucket unavailable", statusCode: 503 },
        }),
      }),
  });
  const initializationFailure = createOriginalImageStorage({
    clientFactory: () => {
      throw new Error("default bucket initialization failed");
    },
  });

  await assert.rejects(
    providerFailure.uploadBytes("original-images/v1/ab/image-id.jpg", Buffer.from("x")),
    (error: unknown) =>
      error instanceof OriginalImageStorageError &&
      error.operation === "upload" &&
      error.statusCode === 503,
  );
  await assert.rejects(
    initializationFailure.exists("original-images/v1/ab/image-id.jpg"),
    (error: unknown) =>
      error instanceof OriginalImageStorageError && error.operation === "exists",
  );
});

test("pipeTo disables decompression and completes the destination stream", async () => {
  const chunks: Buffer[] = [];
  let received: unknown;
  const storage = createOriginalImageStorage({
    clientFactory: () =>
      successfulClient({
        downloadAsStream: (objectKey, options) => {
          received = { objectKey, options };
          return Readable.from([Buffer.from("image-"), Buffer.from("bytes")]);
        },
      }),
  });

  await storage.pipeTo(
    "original-images/v1/ab/image-id.jpg",
    collectWritable(chunks),
  );
  assert.deepEqual(received, {
    objectKey: "original-images/v1/ab/image-id.jpg",
    options: { decompress: false },
  });
  assert.deepEqual(Buffer.concat(chunks), Buffer.from("image-bytes"));
});

test("pipeTo converts source stream failures to internal storage errors", async () => {
  const storage = createOriginalImageStorage({
    clientFactory: () =>
      successfulClient({
        downloadAsStream: () => {
          const stream = new PassThrough();
          queueMicrotask(() => stream.destroy(new Error("download interrupted")));
          return stream;
        },
      }),
  });

  await assert.rejects(
    storage.pipeTo(
      "original-images/v1/ab/image-id.jpg",
      collectWritable([]),
    ),
    (error: unknown) =>
      error instanceof OriginalImageStorageError && error.operation === "download",
  );
});
