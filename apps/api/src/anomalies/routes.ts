import { Router } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import { asyncHandler } from "../http.js";
import { assertOwnedProject } from "../projects/routes.js";
import { projectIdSchema } from "../search/schema.js";
import { severityFor, type AnomalyType } from "./severity.js";

const MAX_LIMIT = 500;

const querySchema = z
  .object({
    type: z.enum(["new_template", "rate_spike"]).optional(),
    // Anomalies whose window overlaps [from, to).
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(100),
  })
  .refine((q) => !q.from || !q.to || q.from < q.to, { message: "from must be before to" });

interface Row {
  id: string;
  type: AnomalyType;
  score: number;
  detected_at: string;
  window_start: string;
  window_end: string;
  template_id: string;
  service: string;
  template: string;
  example_level: string | null;
}

const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;

export function createAnomaliesRouter(pool: Pool): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    "/:id/anomalies",
    asyncHandler(async (req, res) => {
      const projectId = projectIdSchema.safeParse(req.params.id);
      const query = querySchema.safeParse(req.query);
      if (!projectId.success || !query.success) {
        res.status(422).json({
          error: "invalid_query",
          details: {
            ...(projectId.success ? {} : { id: "must be a UUID" }),
            ...(query.success ? {} : query.error.flatten()),
          },
        });
        return;
      }
      if (!(await assertOwnedProject(pool, projectId.data, req.user!.id))) {
        res.status(404).json({ error: "project_not_found" });
        return;
      }
      const { type, from, to, limit } = query.data;

      const result = await pool.query<Row>(
        `SELECT a.id::text AS id, a.type, a.score,
                to_char(a.detected_at AT TIME ZONE 'UTC', ${ISO}) AS detected_at,
                to_char(a.window_start AT TIME ZONE 'UTC', ${ISO}) AS window_start,
                to_char(a.window_end AT TIME ZONE 'UTC', ${ISO}) AS window_end,
                t.id::text AS template_id, t.service, t.template, e.level AS example_level
         FROM anomalies a
         JOIN log_templates t ON t.id = a.template_id
         LEFT JOIN log_events e ON e.id = t.example_event_ids[1]
         WHERE a.project_id = $1
           AND ($2::text IS NULL OR a.type = $2)
           AND ($3::timestamptz IS NULL OR a.window_end > $3)
           AND ($4::timestamptz IS NULL OR a.window_start < $4)
         ORDER BY a.window_start DESC, a.id DESC
         LIMIT $5`,
        [projectId.data, type ?? null, from ?? null, to ?? null, limit],
      );

      res.status(200).json({
        items: result.rows.map((row) => ({
          id: row.id,
          type: row.type,
          severity: severityFor(row.type, row.score, row.example_level),
          score: row.score,
          detectedAt: row.detected_at,
          windowStart: row.window_start,
          windowEnd: row.window_end,
          template: { id: row.template_id, service: row.service, template: row.template },
        })),
      });
    }),
  );

  return router;
}
