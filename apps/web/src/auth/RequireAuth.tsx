import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./useAuth.tsx";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="muted center-text">Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
