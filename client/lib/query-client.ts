import { QueryClient, QueryFunction } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";

let onAuthExpired: (() => void) | null = null;

export function setAuthExpiredCallback(cb: () => void) {
  onAuthExpired = cb;
}

export function clearAuthExpiredCallback() {
  onAuthExpired = null;
}

export function isNetworkError(err: unknown): boolean {
  const msg = (err as any)?.message ?? "";
  return (
    msg.includes("Network request failed") ||
    msg.includes("Failed to fetch") ||
    msg.includes("Unable to resolve host") ||
    msg.includes("net::ERR_")
  );
}

export function getApiUrl(): string {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }

  if (process.env.EXPO_PUBLIC_DOMAIN) {
    let domain = process.env.EXPO_PUBLIC_DOMAIN;
    domain = domain.replace(/:5000$/, "");
    return `https://${domain}`;
  }

  if (__DEV__) {
    console.warn(
      "[API] No EXPO_PUBLIC_API_URL or EXPO_PUBLIC_DOMAIN set — falling back to localhost",
    );
    return "http://localhost:5000";
  }

  console.error(
    "[API] EXPO_PUBLIC_API_URL is required for production builds. Set it in your EAS build profile or app.config.ts extras.",
  );
  return "";
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
  try {
    const token = await AsyncStorage.getItem("studymind_auth_token");
    if (token) {
      return { Authorization: `Bearer ${token}` };
    }
  } catch {}
  return {};
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    if (res.status === 401) {
      try {
        const token = await AsyncStorage.getItem("studymind_auth_token");
        if (token && onAuthExpired) {
          onAuthExpired();
        }
      } catch {}
    }
    let text = res.statusText;
    try {
      text = (await res.text()) || res.statusText;
    } catch {}
    throw new Error(`${res.status}: ${text}`);
  }
}

async function fetchWithRetry(
  url: string | URL,
  options: RequestInit,
  retries = 2,
  delayMs = 1000,
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.status >= 500 && attempt < retries) {
        await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
        continue;
      }
      return res;
    } catch (err) {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  return fetch(url, options);
}

export async function apiRequest(
  method: string,
  route: string,
  data?: unknown | undefined,
): Promise<Response> {
  const baseUrl = getApiUrl();
  const url = new URL(route, baseUrl);
  const authHeaders = await getAuthHeaders();

  const headers: Record<string, string> = {
    ...authHeaders,
    ...(data ? { "Content-Type": "application/json" } : {}),
  };

  const res = await fetchWithRetry(url.toString(), {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const baseUrl = getApiUrl();
    const url = new URL(queryKey.join("/") as string, baseUrl);
    const authHeaders = await getAuthHeaders();

    const res = await fetchWithRetry(url.toString(), {
      headers: authHeaders,
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: (failureCount, error) => {
        const msg = (error as Error)?.message || "";
        if (msg.startsWith("401:") || msg.startsWith("404:")) return false;
        return failureCount < 2;
      },
    },
    mutations: {
      retry: false,
    },
  },
});
