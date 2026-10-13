import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api, setUnauthorizedHandler } from "../api/client.ts";
import type { User } from "../api/client.ts";

interface AuthState {
  user: User | null;
  /** True until the first "who am I?" check has finished. */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Any 401 from the API means the session is gone: forget the user, and the
    // protected routes redirect to /login.
    setUnauthorizedHandler(() => setUser(null));
    let cancelled = false;
    api
      .me()
      .then((me) => {
        if (!cancelled) setUser({ id: me.id });
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      setUnauthorizedHandler(null);
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const me = await api.login(email, password);
    setUser({ id: me.id });
  }, []);

  const register = useCallback(
    async (email: string, password: string) => {
      await api.register(email, password);
      await login(email, password);
    },
    [login],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout }),
    [user, loading, login, register, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}
