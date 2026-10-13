import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { Pool } from "pg";
import { hashPassword, verifyPassword } from "./hash.js";
import { signToken } from "./jwt.js";
import { authCookieOptions } from "./cookie.js";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

function authRateLimiter() {
  return rateLimit({
    windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS ?? 60_000),
    limit: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10),
    standardHeaders: true,
    legacyHeaders: false,
  });
}

export function createAuthRouter(pool: Pool): Router {
  const router = Router();
  const limiter = authRateLimiter();

  router.post("/register", limiter, async (req, res) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ error: "invalid_body", details: parsed.error.flatten() });
      return;
    }
    const { email, password } = parsed.data;

    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rowCount && existing.rowCount > 0) {
      res.status(409).json({ error: "email_taken" });
      return;
    }

    const passwordHash = await hashPassword(password);
    const result = await pool.query<{ id: string }>(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id",
      [email, passwordHash],
    );
    res.status(201).json({ id: result.rows[0].id, email });
  });

  router.post("/login", limiter, async (req, res) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ error: "invalid_body", details: parsed.error.flatten() });
      return;
    }
    const { email, password } = parsed.data;

    const result = await pool.query<{ id: string; password_hash: string }>(
      "SELECT id, password_hash FROM users WHERE email = $1",
      [email],
    );
    if (result.rowCount === 0) {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }

    const user = result.rows[0];
    const valid = await verifyPassword(user.password_hash, password);
    if (!valid) {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }

    const token = signToken(user.id);
    res.cookie("token", token, authCookieOptions());
    res.status(200).json({ id: user.id, email });
  });

  router.post("/logout", limiter, (_req, res) => {
    const { maxAge: _maxAge, ...clearOptions } = authCookieOptions();
    res.clearCookie("token", clearOptions);
    res.status(200).json({ ok: true });
  });

  return router;
}
