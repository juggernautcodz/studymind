import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import { storage } from "@/lib/storage";
import { getApiUrl, setAuthExpiredCallback, clearAuthExpiredCallback, queryClient } from "@/lib/query-client";
import { registerPushTokenWithServer } from "@/lib/notifications";
import type { User } from "@/types";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, name: string) => Promise<void>;
  loginWithToken: (token: string, userData: { id: string; email: string; name: string | null }) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (data: Partial<User>) => Promise<void>;
  deleteAccount: () => Promise<void>;
  getAuthToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadUser();
  }, []);

  useEffect(() => {
    setAuthExpiredCallback(() => {
      storage.clearUser().catch(() => {});
      setUser(null);
    });
    return () => clearAuthExpiredCallback();
  }, []);

  const getAuthToken = async (): Promise<string | null> => {
    return await storage.getAuthToken();
  };

  const loadUser = async () => {
    try {
      const token = await storage.getAuthToken();

      if (token) {
        try {
          const baseUrl = getApiUrl();
          const response = await fetch(`${baseUrl}/api/auth/me`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });

          if (response.ok) {
            const data = await response.json();
            const loadedUser: User = {
              id: data.user.id,
              email: data.user.email,
              name: data.user.name || data.user.email.split("@")[0],
              plan: data.user.plan || "FREE",
              createdAt: data.user.createdAt || new Date().toISOString(),
            };

            await storage.setUser(loadedUser);
            setUser(loadedUser);
          } else {
            await storage.clearUser();
            setUser(null);
          }
        } catch (error) {
          console.log("Backend not available, using local auth");
          const savedUser = await storage.getUser();
          setUser(savedUser);
        }
      } else {
        const savedUser = await storage.getUser();
        setUser(savedUser);
      }
    } catch (error) {
      console.error("Failed to load user:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (email: string, password: string) => {
    const baseUrl = getApiUrl();
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      let errorMsg = "Login failed";
      try {
        const error = await response.json();
        errorMsg = error.error || errorMsg;
      } catch {}
      throw new Error(errorMsg);
    }

    const data = await response.json();

    const loggedInUser: User = {
      id: data.user.id,
      email: data.user.email,
      name: data.user.name || data.user.email.split("@")[0],
      plan: data.user.plan || "FREE",
      createdAt: data.user.createdAt || new Date().toISOString(),
    };

    await storage.setUser(loggedInUser);
    await storage.setAuthToken(data.token);
    // staleTime: Infinity means cached queries never self-refetch — without
    // clearing here, a different account's data can keep showing after
    // switching who's logged in on the same device.
    queryClient.clear();
    setUser(loggedInUser);
    registerPushTokenWithServer(data.token).catch(() => {});
  };

  const signup = async (email: string, password: string, name: string) => {
    const baseUrl = getApiUrl();
    const response = await fetch(`${baseUrl}/api/auth/signup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password, name }),
    });

    if (!response.ok) {
      let errorMsg = "Signup failed";
      try {
        const error = await response.json();
        errorMsg = error.error || errorMsg;
      } catch {}
      throw new Error(errorMsg);
    }

    const data = await response.json();

    const newUser: User = {
      id: data.user.id,
      email: data.user.email,
      name: data.user.name || name,
      plan: data.user.plan || "FREE",
      createdAt: data.user.createdAt || new Date().toISOString(),
    };

    await storage.setUser(newUser);
    await storage.setAuthToken(data.token);
    queryClient.clear();
    setUser(newUser);
    registerPushTokenWithServer(data.token).catch(() => {});
  };

  const logout = async () => {
    await storage.clearUser();
    queryClient.clear();
    setUser(null);
  };

  const loginWithToken = async (
    token: string,
    userData: { id: string; email: string; name: string | null },
  ) => {
    const user: User = {
      id: userData.id,
      email: userData.email,
      name: userData.name || userData.email.split("@")[0],
      plan: "FREE",
      createdAt: new Date().toISOString(),
    };
    await storage.setUser(user);
    await storage.setAuthToken(token);
    queryClient.clear();
    setUser(user);
    registerPushTokenWithServer(token).catch(() => {});
  };

  const updateUser = async (data: Partial<User>) => {
    if (!user) return;

    const updatedUser = { ...user, ...data };
    await storage.setUser(updatedUser);
    setUser(updatedUser);
  };

  const deleteAccount = async () => {
    try {
      const token = await storage.getAuthToken();
      const baseUrl = getApiUrl();
      const headers: Record<string, string> = {};

      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const response = await fetch(
        new URL("/api/auth/account", baseUrl).toString(),
        {
          method: "DELETE",
          headers,
        },
      );

      if (!response.ok) {
        throw new Error("Server deletion failed");
      }
    } catch (error) {
      console.log("Backend account deletion failed, clearing locally");
    }

    await storage.clearAll();
    queryClient.clear();
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        signup,
        loginWithToken,
        logout,
        updateUser,
        deleteAccount,
        getAuthToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}