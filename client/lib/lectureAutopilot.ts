import type {
  LectureAutopilotJobDto,
  LectureAutopilotMaterials,
  LectureAutopilotStage,
} from "../../shared/lecture-autopilot";
import { getApiUrl, getAuthHeaders } from "./query-client";

interface StartLectureAutopilotInput {
  courseId: string;
  topicId: string;
  audioBase64: string;
  durationMinutes: number;
  materials: LectureAutopilotMaterials;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = await getAuthHeaders();
  const response = await fetch(new URL(path, getApiUrl()).toString(), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...headers,
      ...(init?.headers ?? {}),
    },
    credentials: "include",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message =
      body?.error?.message ??
      body?.message ??
      body?.error ??
      "Lecture Autopilot request failed";
    const error = new Error(message) as Error & {
      status?: number;
      type?: string;
    };
    error.status = response.status;
    error.type = body?.type;
    throw error;
  }
  return response.json() as Promise<T>;
}

export async function startLectureAutopilot(
  input: StartLectureAutopilotInput,
): Promise<LectureAutopilotJobDto> {
  const response = await request<{ job: LectureAutopilotJobDto }>(
    `/api/courses/${encodeURIComponent(input.courseId)}/topics/${encodeURIComponent(input.topicId)}/lecture-autopilot`,
    {
      method: "POST",
      body: JSON.stringify({
        audioBase64: input.audioBase64,
        durationMinutes: input.durationMinutes,
        materials: input.materials,
      }),
    },
  );
  return response.job;
}

export async function retryLectureAutopilot(
  jobId: string,
  audioBase64: string,
): Promise<LectureAutopilotJobDto> {
  const response = await request<{ job: LectureAutopilotJobDto }>(
    `/api/jobs/${encodeURIComponent(jobId)}/retry`,
    { method: "POST", body: JSON.stringify({ audioBase64 }) },
  );
  return response.job;
}

export async function getLectureAutopilotJob(
  jobId: string,
): Promise<LectureAutopilotJobDto> {
  const response = await request<{ job: LectureAutopilotJobDto }>(
    `/api/jobs/${encodeURIComponent(jobId)}`,
  );
  return response.job;
}

export async function pollLectureAutopilot(
  jobId: string,
  onStage: (stage: LectureAutopilotStage) => void,
  maxWaitMs = 8 * 60 * 1_000,
): Promise<LectureAutopilotJobDto> {
  const startedAt = Date.now();
  let delayMs = 1_500;

  while (Date.now() - startedAt < maxWaitMs) {
    const job = await getLectureAutopilotJob(jobId);
    onStage(job.status);
    if (job.status === "complete") return job;
    if (job.status === "failed") {
      throw new Error(job.error ?? "Lecture Autopilot failed");
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    delayMs = Math.min(delayMs + 500, 5_000);
  }

  throw new Error(
    "Lecture Autopilot is still processing. You can retry this job.",
  );
}
