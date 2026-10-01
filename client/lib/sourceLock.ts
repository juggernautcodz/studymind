import { useQuery } from "@tanstack/react-query";
import { Platform } from "react-native";
import { getApiUrl, getAuthHeaders } from "@/lib/query-client";

export interface CreateImageSourceInput {
  courseId: string;
  topicId: string;
  title: string;
  extractedText: string;
  mimeType?: string;
  whiteboardImageId?: string;
}

export interface CreatedSource {
  id: string;
}

export interface UploadWhiteboardImageInput {
  courseId: string;
  topicId: string;
  imageUri: string;
  uploadId: string;
  ocrText: string;
  mimeType?: string;
}

export interface UploadedWhiteboardImage {
  id: string;
  mimeType: string;
}

export interface SourceLockSourceSummary {
  id: string;
  kind: string;
  title: string;
  topicId: string | null;
  currentRevision: number;
  createdAt: string;
  updatedAt: string;
  revisions: Array<{
    id: string;
    revision: number;
    contentHash: string;
    contentLength: number;
    createdAt: string;
    _count: { segments: number };
  }>;
}

export interface SourceLockSourceDetail {
  id: string;
  kind: string;
  title: string;
  topicId: string | null;
  recordingId: string | null;
  whiteboardImageId: string | null;
  originUri: string | null;
  mimeType: string | null;
  currentRevision: number;
  createdAt: string;
  updatedAt: string;
  revisions: Array<{
    id: string;
    revision: number;
    contentHash: string;
    contentLength: number;
    createdAt: string;
    generationRun: {
      id: string;
      operation: string;
      provider: string | null;
      model: string | null;
      createdAt: string;
    } | null;
    segments: Array<{
      id: string;
      position: number;
      content: string;
      locatorLabel: string | null;
      pageNumber: number | null;
      startSeconds: number | null;
      endSeconds: number | null;
      charStart: number | null;
      charEnd: number | null;
      regionX: number | null;
      regionY: number | null;
      regionWidth: number | null;
      regionHeight: number | null;
    }>;
  }>;
}

interface SourcesResponse {
  sources: SourceLockSourceSummary[];
}

interface SourceDetailResponse {
  source: SourceLockSourceDetail;
}

export const courseSourcesQueryKey = (courseId: string) =>
  ["course-sources", courseId] as const;

export const sourceDetailQueryKey = (courseId: string, sourceId: string) =>
  ["course-source", courseId, sourceId] as const;

async function fetchCourseSources(
  courseId: string,
): Promise<SourceLockSourceSummary[]> {
  const authHeaders = await getAuthHeaders();
  if (!authHeaders.Authorization) throw new Error("Authentication required");

  const response = await fetch(
    new URL(
      `/api/courses/${encodeURIComponent(courseId)}/sources`,
      getApiUrl(),
    ).toString(),
    {
      method: "GET",
      headers: authHeaders,
      credentials: "include",
    },
  );

  const payload = (await response
    .json()
    .catch(() => null)) as SourcesResponse | null;
  if (!response.ok || !payload || !Array.isArray(payload.sources)) {
    throw new Error(errorMessage(payload, "Could not load course sources"));
  }

  return payload.sources;
}

export function useCourseSources(courseId: string) {
  return useQuery({
    queryKey: courseSourcesQueryKey(courseId),
    queryFn: () => fetchCourseSources(courseId),
    enabled: courseId.length > 0,
    staleTime: 30_000,
  });
}

async function fetchSourceDetail(
  courseId: string,
  sourceId: string,
): Promise<SourceLockSourceDetail> {
  const authHeaders = await getAuthHeaders();
  if (!authHeaders.Authorization) throw new Error("Authentication required");

  const response = await fetch(
    new URL(
      `/api/courses/${encodeURIComponent(courseId)}/sources/${encodeURIComponent(sourceId)}`,
      getApiUrl(),
    ).toString(),
    {
      method: "GET",
      headers: authHeaders,
      credentials: "include",
    },
  );

  const payload = (await response
    .json()
    .catch(() => null)) as SourceDetailResponse | null;
  if (!response.ok || !payload?.source) {
    throw new Error(errorMessage(payload, "Could not load source details"));
  }

  return payload.source;
}

export function useSourceDetail(courseId: string, sourceId: string) {
  return useQuery({
    queryKey: sourceDetailQueryKey(courseId, sourceId),
    queryFn: () => fetchSourceDetail(courseId, sourceId),
    enabled: courseId.length > 0 && sourceId.length > 0,
    staleTime: 30_000,
  });
}

export function sourceOriginalImageUrl(courseId: string, sourceId: string) {
  return new URL(
    `/api/courses/${encodeURIComponent(courseId)}/sources/${encodeURIComponent(sourceId)}/original-image`,
    getApiUrl(),
  ).toString();
}

const MAX_SEGMENT_CHARACTERS = 20_000;
const MAX_SOURCE_CHARACTERS = 250_000;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WHITEBOARD_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

function errorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;

  const error = (payload as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return fallback;
}

function ocrSegments(extractedText: string) {
  if (extractedText.length > MAX_SOURCE_CHARACTERS) {
    throw new Error("Extracted image text is too large to save as a source");
  }

  return Array.from(
    { length: Math.ceil(extractedText.length / MAX_SEGMENT_CHARACTERS) },
    (_, index) => {
      const content = extractedText.slice(
        index * MAX_SEGMENT_CHARACTERS,
        (index + 1) * MAX_SEGMENT_CHARACTERS,
      );
      return {
        content,
        locatorLabel: index === 0 ? "OCR text" : `OCR text (part ${index + 1})`,
      };
    },
  );
}

/**
 * Uploads a captured original image once its destination topic is known. The
 * uploadId is deliberately supplied by the caller so a capture keeps the same
 * id through destination selection and an accidental duplicate submission is
 * replay-safe on the server.
 */
export async function uploadWhiteboardImage(
  input: UploadWhiteboardImageInput,
): Promise<UploadedWhiteboardImage> {
  if (
    !input.courseId ||
    !input.topicId ||
    !input.imageUri ||
    !input.uploadId ||
    !input.ocrText.trim()
  ) {
    throw new Error("Original image details are incomplete");
  }

  const authHeaders = await getAuthHeaders();
  if (!authHeaders.Authorization) throw new Error("Authentication required");

  const mimeType = input.mimeType || "image/jpeg";
  const form = new FormData();
  form.append("uploadId", input.uploadId);
  form.append("ocrText", input.ocrText);

  if (Platform.OS === "web") {
    const imageResponse = await fetch(input.imageUri);
    if (!imageResponse.ok) throw new Error("Could not read original image");
    form.append("image", await imageResponse.blob(), "whiteboard-image");
  } else {
    form.append("image", {
      uri: input.imageUri,
      name: "whiteboard-image",
      type: mimeType,
    } as unknown as Blob);
  }

  const response = await fetch(
    new URL(
      `/api/courses/${encodeURIComponent(input.courseId)}/topics/${encodeURIComponent(input.topicId)}/whiteboard-images`,
      getApiUrl(),
    ).toString(),
    {
      method: "POST",
      // Do not set Content-Type: fetch/RN supplies the multipart boundary.
      headers: authHeaders,
      credentials: "include",
      body: form,
    },
  );

  const payload = (await response.json().catch(() => null)) as {
    whiteboardImage?: { id?: unknown; mimeType?: unknown };
  } | null;
  if (!response.ok) {
    throw new Error(errorMessage(payload, "Could not preserve original image"));
  }

  const whiteboardImage = payload?.whiteboardImage;
  if (
    !whiteboardImage ||
    typeof whiteboardImage.id !== "string" ||
    !UUID_V4_PATTERN.test(whiteboardImage.id) ||
    typeof whiteboardImage.mimeType !== "string" ||
    !WHITEBOARD_IMAGE_MIME_TYPES.has(whiteboardImage.mimeType)
  ) {
    throw new Error("Original image upload response was invalid");
  }

  return { id: whiteboardImage.id, mimeType: whiteboardImage.mimeType };
}

/**
 * Creates the first durable SourceLock revision for OCR text from a camera or
 * gallery image. This deliberately uses one direct request: the current
 * SourceLock create API has no idempotency key, so a transport retry could
 * create a second source after an ambiguous response.
 */
export async function createImageSource(
  input: CreateImageSourceInput,
): Promise<CreatedSource> {
  const extractedText = input.extractedText.trim();
  if (
    !input.courseId ||
    !input.topicId ||
    !input.title.trim() ||
    !extractedText
  ) {
    throw new Error("Image source details are incomplete");
  }

  const authHeaders = await getAuthHeaders();
  if (!authHeaders.Authorization) throw new Error("Authentication required");

  const response = await fetch(
    new URL(
      `/api/courses/${encodeURIComponent(input.courseId)}/sources`,
      getApiUrl(),
    ).toString(),
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      credentials: "include",
      body: JSON.stringify({
        kind: "WHITEBOARD_IMAGE",
        title: input.title.trim().slice(0, 200),
        topicId: input.topicId,
        mimeType: input.mimeType || "image/jpeg",
        segments: ocrSegments(extractedText),
        generation: { operation: "image-ocr" },
        ...(input.whiteboardImageId
          ? { whiteboardImageId: input.whiteboardImageId }
          : {}),
      }),
    },
  );

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(errorMessage(payload, "Could not save image source"));
  }

  const sourceId = (payload as { source?: { id?: unknown } } | null)?.source
    ?.id;
  if (typeof sourceId !== "string" || !sourceId) {
    throw new Error("Image source response was invalid");
  }

  return { id: sourceId };
}
