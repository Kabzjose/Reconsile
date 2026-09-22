"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, setAuthToken } from "./api";
import type { AuthResult } from "./types";

interface Session {
  token: string;
  user: { id: string; email: string };
  business: { id: string; name: string };
}

interface AuthContextValue {
  session: Session | null;
  /** True until we've checked localStorage for an existing session, once, on first load. */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (businessName: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const STORAGE_KEY = "reconcile.session";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Session;
        setAuthToken(parsed.token);
        setSession(parsed);
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
    setLoading(false);
  }, []);

  const apply = useCallback((result: AuthResult) => {
    const next: Session = { token: result.token, user: result.user, business: result.business };
    setAuthToken(next.token);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSession(next);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      apply(await api.post<AuthResult>("/api/auth/login", { email, password }));
    },
    [apply],
  );

  const register = useCallback(
    async (businessName: string, email: string, password: string) => {
      apply(await api.post<AuthResult>("/api/auth/register", { businessName, email, password }));
    },
    [apply],
  );

  const logout = useCallback(() => {
    setAuthToken(null);
    window.localStorage.removeItem(STORAGE_KEY);
    setSession(null);
  }, []);

  return <AuthContext.Provider value={{ session, loading, login, register, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

/** A 401 mid-session means the token expired or the account is gone: send them back to log in. */
export function useAuthGuard() {
  const { session, loading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !session) router.replace("/login");
  }, [loading, session, router]);

  const handleError = useCallback(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 401) {
        logout();
        router.replace("/login");
      }
    },
    [logout, router],
  );

  return { session, loading, handleError };
}
