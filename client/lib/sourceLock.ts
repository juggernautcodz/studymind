import { getApiUrl, getAuthHeaders } from "@/lib/query-client";

export interface CreateImageSourceInput {
  courseId: string;
  topicId: string;
  title: string;
  extractedText: string;
  mimeType?: string;
}

export interface CreatedSource {
  id: string;
}

const MAX_SEGMENT_CHARACTERS = 20_000;
const MAX_SOURCE_CHARACTERS = 250_000;

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
