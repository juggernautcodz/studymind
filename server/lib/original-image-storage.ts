import {
  Client,
  type RequestError,
  type Result,
  StreamRequestError,
} from "@replit/object-storage";
import { pipeline } from "node:stream/promises";
import type { Readable, Writable } from "node:stream";

type StorageOperation = "upload" | "download" | "exists" | "delete";

interface ReplitObjectStorageClient {
  uploadFromBytes(
    objectKey: string,
    bytes: Buffer,
    options: { compress: false },
  ): Promise<Result<null, RequestError>>;
  downloadAsStream(
    objectKey: string,
    options: { decompress: false },
  ): Readable;
  exists(objectKey: string): Promise<Result<boolean, RequestError>>;
  delete(
    objectKey: string,
    options: { ignoreNotFound: true },
  ): Promise<Result<null, RequestError>>;
}

export interface OriginalImageStorage {
  uploadBytes(objectKey: string, bytes: Buffer): Promise<void>;
  pipeTo(objectKey: string, destination: Writable): Promise<void>;
  exists(objectKey: string): Promise<boolean>;
  deleteIfPresent(objectKey: string): Promise<void>;
}

export class OriginalImageStorageError extends Error {
  readonly operation: StorageOperation;
  readonly statusCode?: number;
  readonly cause?: unknown;

  constructor(
    operation: StorageOperation,
    message: string,
    cause?: unknown,
    statusCode?: number,
  ) {
    super(`Original image storage ${operation} failed: ${message}`);
    this.name = "OriginalImageStorageError";
    this.operation = operation;
    this.cause = cause;
    this.statusCode = statusCode;
  }
}

export interface OriginalImageStorageOptions {
  clientFactory?: () => ReplitObjectStorageClient;
}

function requestErrorDetails(error: unknown): {
  message: string;
  statusCode?: number;
} {
  if (error instanceof StreamRequestError) {
    const requestError = error.getRequestError();
    return {
      message: requestError.message,
      statusCode: requestError.statusCode,
    };
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return {
      message: error.message,
      statusCode:
        "statusCode" in error && typeof error.statusCode === "number"
          ? error.statusCode
          : undefined,
    };
  }

  return { message: "unknown provider error" };
}

function toStorageError(
  operation: StorageOperation,
  error: unknown,
): OriginalImageStorageError {
  if (error instanceof OriginalImageStorageError) {
    return error;
  }

  const { message, statusCode } = requestErrorDetails(error);
  return new OriginalImageStorageError(operation, message, error, statusCode);
}

function requireSuccessfulResult<T>(
  operation: StorageOperation,
  result: Result<T, RequestError>,
): T {
  if (!result.ok) {
    throw toStorageError(operation, result.error);
  }

  return result.value;
}

export function createOriginalImageStorage(
  options: OriginalImageStorageOptions = {},
): OriginalImageStorage {
  const clientFactory = options.clientFactory ?? (() => new Client());
  let client: ReplitObjectStorageClient | undefined;

  const getClient = (): ReplitObjectStorageClient => {
    client ??= clientFactory();
    return client;
  };

  return {
    async uploadBytes(objectKey, bytes) {
      try {
        const result = await getClient().uploadFromBytes(objectKey, bytes, {
          compress: false,
        });
        requireSuccessfulResult("upload", result);
      } catch (error) {
        throw toStorageError("upload", error);
      }
    },

    async pipeTo(objectKey, destination) {
      try {
        const source = getClient().downloadAsStream(objectKey, {
          decompress: false,
        });
        await pipeline(source, destination);
      } catch (error) {
        throw toStorageError("download", error);
      }
    },

    async exists(objectKey) {
      try {
        const result = await getClient().exists(objectKey);
        return requireSuccessfulResult("exists", result);
      } catch (error) {
        throw toStorageError("exists", error);
      }
    },

    async deleteIfPresent(objectKey) {
      try {
        const result = await getClient().delete(objectKey, {
          ignoreNotFound: true,
        });
        requireSuccessfulResult("delete", result);
      } catch (error) {
        throw toStorageError("delete", error);
      }
    },
  };
}

// This remains lazy: importing server code must not initialize the Replit client.
export const originalImageStorage = createOriginalImageStorage();
