import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import { storage, setActiveUser } from "@/lib/storage";
import { getApiUrl, setAuthExpiredCallback, clearAuthExpiredCallback, queryClient } from "@/lib/query-client";
import { registerPushTokenWithServer } from "@/lib/notifications";
import { hydrateFromServerIfEmpty } from "@/lib/serverSync";
import { deleteAccountAfterServerConfirmation } from "@/lib/accountDeletion";
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
      setActiveUser(null);
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

            setActiveUser(loadedUser.id);
            await storage.setUser(loadedUser);
            await hydrateFromServerIfEmpty(token);
            setUser(loadedUser);
          } else {
            setActiveUser(null);
            await storage.clearUser();
            setUser(null);
          }
        } catch (error) {
          console.log("Backend not available, using local auth");
          const savedUser = await storage.getUser();
          setActiveUser(savedUser?.id ?? null);
          setUser(savedUser);
        }
      } else {
        setActiveUser(null);
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

    // storage.* content keys are namespaced per user id (see
    // client/lib/storage.ts) — switch the active namespace before writing,
    // so this account reads/writes only its own data.
    setActiveUser(loggedInUser.id);
    await storage.setUser(loggedInUser);
    await storage.setAuthToken(data.token);
    await hydrateFromServerIfEmpty(data.token);
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

    setActiveUser(newUser.id);
    await storage.setUser(newUser);
    await storage.setAuthToken(data.token);
    queryClient.clear();
    setUser(newUser);
    registerPushTokenWithServer(data.token).catch(() => {});
  };

  const logout = async () => {
    // Detach from this account's namespace without deleting its data — it's
    // still there under its own key prefix next time this account logs in.
    await storage.clearUser();
    setActiveUser(null);
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
    setActiveUser(user.id);
    await storage.setUser(user);
    await storage.setAuthToken(token);
    await hydrateFromServerIfEmpty(token);
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
    await deleteAccountAfterServerConfirmation({
      getAuthToken: () => storage.getAuthToken(),
      deleteFromServer: (token) =>
        fetch(new URL("/api/auth/account", getApiUrl()).toString(), {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }),
      clearLocalAccount: () => storage.clearAll(),
      detachActiveUser: () => setActiveUser(null),
      clearQueryCache: () => queryClient.clear(),
      clearUserState: () => setUser(null),
    });
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
