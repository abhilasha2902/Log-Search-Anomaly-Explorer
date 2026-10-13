import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Pool } from "pg";
import { createApiKeyAuth } from "./middleware.js";
import { ingestBatchSchema } from "./schema.js";

function ingestRateLimiter() {
  return rateLimit({
    windowMs: Number(process.env.INGEST_RATE_LIMIT_WINDOW_MS ?? 60_000),
    limit: Number(process.env.INGEST_RATE_LIMIT_MAX ?? 1000),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.projectId ?? ipKeyGenerator(req.ip ?? "unknown"),
  });
}

export function createIngestRouter(pool: Pool): Router {
  const router = Router();
  const apiKeyAuth = createApiKeyAuth(pool);
  const limiter = ingestRateLimiter();

  router.post("/", apiKeyAuth, limiter, async (req, res) => {
    const parsed = ingestBatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ error: "invalid_body", details: parsed.error.flatten() });
      return;
    }
    const events = parsed.data;
    const projectId = req.projectId;

    const rows: string[] = [];
    const params: unknown[] = [];
    events.forEach((event, index) => {
      const base = index * 6;
      rows.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`,
      );
      params.push(projectId, event.ts, event.service, event.level, event.message, event.attrs);
    });

    const result = await pool.query(
      `INSERT INTO log_events (project_id, ts, service, level, message, attrs) VALUES ${rows.join(", ")}`,
      params,
    );

    res.status(200).json({ accepted: result.rowCount });
  });

  return router;
}
