import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Pool } from "pg";
import { createApiKeyAuth } from "./middleware.js";
import { ingestBatchSchema } from "./schema.js";
import { asyncHandler } from "../http.js";
import { withTransaction } from "../db.js";
import { TemplateMiner } from "../templates/service.js";

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
  const miner = new TemplateMiner(pool);

  router.post(
    "/",
    asyncHandler(apiKeyAuth),
    limiter,
    asyncHandler(async (req, res) => {
      const parsed = ingestBatchSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json({ error: "invalid_body", details: parsed.error.flatten() });
        return;
      }
      const events = parsed.data;
      const projectId = req.projectId as string; // set by apiKeyAuth

      // Group lines into templates first (in memory + template rows); then store the events
      // and the per-template statistics together so counts never disagree with the rows.
      const prepared = await miner.prepare(projectId, events);

      const rows: string[] = [];
      const params: unknown[] = [];
      events.forEach((event, index) => {
        const base = index * 7;
        const p = (n: number) => `$${base + n}`;
        rows.push(`(${[1, 2, 3, 4, 5, 6, 7].map(p).join(", ")})`);
        params.push(
          projectId,
          event.ts,
          event.service,
          event.level,
          event.message,
          event.attrs,
          prepared.templateIds[index],
        );
      });

      const accepted = await withTransaction(pool, async (client) => {
        // A multi-row INSERT returns ids in VALUES order, which finalize relies on for examples.
        const result = await client.query<{ id: string }>(
          `INSERT INTO log_events (project_id, ts, service, level, message, attrs, template_id)
           VALUES ${rows.join(", ")} RETURNING id::text AS id`,
          params,
        );
        await miner.finalize(
          client,
          prepared,
          result.rows.map((row) => row.id),
        );
        return result.rowCount;
      });

      res.status(200).json({ accepted });
    }),
  );

  return router;
}
