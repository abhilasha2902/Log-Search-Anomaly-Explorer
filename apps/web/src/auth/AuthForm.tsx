import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client.ts";
import { useAuth } from "./useAuth.tsx";

interface Props {
  mode: "login" | "register";
}

function describeError(error: unknown, mode: Props["mode"]): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "Wrong email or password.";
    if (error.status === 409) return "That email is already registered.";
    if (error.status === 422) return "Enter a valid email and a password of at least 8 characters.";
    if (error.status === 429) return "Too many attempts. Wait a minute and try again.";
  }
  return mode === "login" ? "Could not sign in." : "Could not create the account.";
}

export function AuthForm({ mode }: Props) {
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const isLogin = mode === "login";

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await (isLogin ? login(email, password) : register(email, password));
      navigate("/", { replace: true });
    } catch (e) {
      setError(describeError(e, mode));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="card auth-form" onSubmit={onSubmit}>
        <h1>{isLogin ? "Sign in" : "Create account"}</h1>
        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete={isLogin ? "current-password" : "new-password"}
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button type="submit" className="primary" disabled={busy}>
          {isLogin ? "Sign in" : "Create account"}
        </button>
        <p className="muted">
          {isLogin ? (
            <>
              No account? <Link to="/register">Create one</Link>
            </>
          ) : (
            <>
              Already registered? <Link to="/login">Sign in</Link>
            </>
          )}
        </p>
      </form>
    </main>
  );
}
