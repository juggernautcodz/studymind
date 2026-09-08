import { getApiUrl } from "./query-client";
import { storage } from "./storage";
import type { Topic, Semester, Course } from "@/types";

async function getHeaders(
  authToken: string | null,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }
  return headers;
}

async function parseJsonSafe(response: Response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

export async function ensureSemesterOnServer(
  semesterId: string,
  authToken: string | null,
): Promise<string | null> {
  try {
    const semester = await storage
      .getSemesters()
      .then((s) => s.find((sem) => sem.id === semesterId));

    if (!semester) {
      console.error("[ServerSync] Semester not found locally:", semesterId);
      return null;
    }

    const apiUrl = getApiUrl().replace(/\/+$/, "");
    const headers = await getHeaders(authToken);

    const response = await fetch(`${apiUrl}/api/semesters`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: semester.id,
        name: semester.name,
        startDate: semester.startDate || null,
        endDate: semester.endDate || null,
      }),
    });

    const data = await parseJsonSafe(response);

    if (!response.ok) {
      console.error(
        "[ServerSync] Failed to sync semester:",
        response.status,
        data,
      );
      return null;
    }

    return data?.semester?.id || data?.id || semester.id;
  } catch (error) {
    console.error("[ServerSync] Failed to sync semester:", error);
    return null;
  }
}

export async function ensureCourseOnServer(
  courseId: string,
  authToken: string | null,
): Promise<string | null> {
  try {
    const course = await storage.getCourse(courseId);
    if (!course) {
      console.error("[ServerSync] Course not found locally:", courseId);
      return null;
    }

    const serverSemesterId = await ensureSemesterOnServer(
      course.semesterId,
      authToken,
    );

    if (!serverSemesterId) {
      console.error("[ServerSync] Cannot sync course - semester sync failed");
      return null;
    }

    const apiUrl = getApiUrl().replace(/\/+$/, "");
    const headers = await getHeaders(authToken);

    const response = await fetch(`${apiUrl}/api/courses`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: course.id,
        name: course.name,
        semesterId: serverSemesterId,
        color: course.color || null,
      }),
    });

    const data = await parseJsonSafe(response);

    if (!response.ok) {
      console.error(
        "[ServerSync] Failed to sync course:",
        response.status,
        data,
      );
      return null;
    }

    return data?.course?.id || data?.id || course.id;
  } catch (error) {
    console.error("[ServerSync] Failed to sync course:", error);
    return null;
  }
}

export async function syncTopicToServer(
  topic: { id?: string; name: string; courseId: string },
  authToken: string | null,
): Promise<string | null> {
  try {
    const serverCourseId = await ensureCourseOnServer(topic.courseId, authToken);

    if (!serverCourseId) {
      console.error("[ServerSync] Cannot sync topic - course sync failed");
      return null;
    }

    const apiUrl = getApiUrl().replace(/\/+$/, "");
    const headers = await getHeaders(authToken);

    const response = await fetch(`${apiUrl}/api/topics`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: topic.id,
        name: topic.name,
        courseId: serverCourseId,
      }),
    });

    const data = await parseJsonSafe(response);

    if (!response.ok) {
      console.error(
        "[ServerSync] Failed to create topic on server:",
        response.status,
        data,
      );
      return null;
    }

    return data?.topic?.id || data?.id || null;
  } catch (error) {
    console.error("[ServerSync] Server sync error:", error);
    return null;
  }
}

// Local storage is per-device (see storage.ts) and only ever pushed to the
// server, never pulled — so a second device signing into the same account
// saw an empty local store and independently created its own "My Studies"
// default setup, duplicating whatever the first device already made. Call
// this on login/session-restore, before anything else reads local storage,
// to pull down existing content first.
export async function hydrateFromServerIfEmpty(
  authToken: string | null,
): Promise<void> {
  if (await storage.hasContent()) return;

  try {
    const apiUrl = getApiUrl().replace(/\/+$/, "");
    const headers = await getHeaders(authToken);

    const [semestersRes, coursesRes, topicsRes] = await Promise.all([
      fetch(`${apiUrl}/api/semesters`, { headers }),
      fetch(`${apiUrl}/api/courses`, { headers }),
      fetch(`${apiUrl}/api/topics`, { headers }),
    ]);

    if (!semestersRes.ok || !coursesRes.ok || !topicsRes.ok) return;

    const semestersData = await parseJsonSafe(semestersRes);
    const coursesData = await parseJsonSafe(coursesRes);
    const topicsData = await parseJsonSafe(topicsRes);

    const rawSemesters: any[] = semestersData?.semesters || [];
    if (rawSemesters.length === 0) return;

    const semesters: Semester[] = rawSemesters.map((s) => ({
      id: s.id,
      userId: s.userId,
      name: s.name,
      startDate: s.startDate || "",
      endDate: s.endDate || "",
      createdAt: s.createdAt,
    }));

    const courses: Course[] = (coursesData?.courses || []).map((c: any) => ({
      id: c.id,
      userId: c.userId,
      semesterId: c.semesterId,
      name: c.name,
      code: c.code || "",
      color: c.color || "#4F46E5",
      createdAt: c.createdAt,
    }));

    const topics: Topic[] = (topicsData?.topics || []).map((t: any) => ({
      id: t.id,
      userId: t.userId,
      courseId: t.courseId,
      name: t.name,
      orderIndex: t.orderIndex ?? 0,
      status: t.status || "pending",
      createdAt: t.createdAt,
    }));

    await storage.hydrateFromServer({ semesters, courses, topics });
  } catch (error) {
    console.error("[ServerSync] Failed to hydrate from server:", error);
  }
}

export async function createTopicWithServerSync(
  topicData: Omit<Topic, "id" | "createdAt" | "serverId">,
  authToken: string | null,
): Promise<Topic> {
  const localTopic = await storage.createTopic(topicData);

  const serverId = await syncTopicToServer(
    {
      id: localTopic.id,
      name: localTopic.name,
      courseId: localTopic.courseId,
    },
    authToken,
  );

  if (serverId) {
    await storage.updateTopic(localTopic.id, { serverId });
    return { ...localTopic, serverId };
  }

  console.warn("Topic created locally but not synced to server");
  return localTopic;
}

export async function ensureTopicOnServer(
  topic: Topic,
  authToken: string | null,
): Promise<string | null> {
  if (topic.serverId) return topic.serverId;

  const serverId = await syncTopicToServer(
    {
      id: topic.id,
      name: topic.name,
      courseId: topic.courseId,
    },
    authToken,
  );

  if (serverId) {
    await storage.updateTopic(topic.id, { serverId });
  }

  return serverId;
}