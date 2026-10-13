import { Router } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import { asyncHandler } from "../http.js";
import { assertOwnedProject } from "../projects/routes.js";
import { decodeCursor, encodeCursor } from "../search/cursor.js";
import { projectIdSchema } from "../search/schema.js";

const MAX_LIMIT = 200;
const SAMPLES_PER_TEMPLATE = 3;
const templateIdSchema = z.string().regex(/^\d{1,18}$/);

const listQuerySchema = z.object({
  service: z.string().min(1).max(100).optional(),
  sort: z.enum(["count", "recent"]).default("count"),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(50),
  minutes: z.coerce.number().int().min(5).max(1440).default(60),
});

const eventsQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(50),
});

interface TemplateRow {
  id: string;
  service: string;
  template: string;
  first_seen: string;
  last_seen: string;
  total_count: string;
  example_event_ids: string[];
}

interface SampleRow {
  id: string;
  ts: string;
  level: string;
  message: string;
}

const MINUTE_MS = 60_000;

function invalidQuery(res: import("express").Response, details: unknown): void {
  res.status(422).json({ error: "invalid_query", details });
}

export function createTemplatesRouter(pool: Pool): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    "/:id/templates",
    asyncHandler(async (req, res) => {
      const projectId = projectIdSchema.safeParse(req.params.id);
      const query = listQuerySchema.safeParse(req.query);
      if (!projectId.success || !query.success) {
        invalidQuery(res, {
          ...(projectId.success ? {} : { id: "must be a UUID" }),
          ...(query.success ? {} : query.error.flatten().fieldErrors),
        });
        return;
      }
      if (!(await assertOwnedProject(pool, projectId.data, req.user!.id))) {
        res.status(404).json({ error: "project_not_found" });
        return;
      }
      const { service, sort, limit, minutes } = query.data;

      const templates = await pool.query<TemplateRow>(
        `SELECT id::text AS id, service, template,
                to_char(first_seen AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS first_seen,
                to_char(last_seen AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS last_seen,
                total_count::text AS total_count, example_event_ids::text[] AS example_event_ids
         FROM log_templates
         WHERE project_id = $1 AND ($2::text IS NULL OR service = $2)
         ORDER BY ${sort === "recent" ? "log_templates.last_seen DESC" : "log_templates.total_count DESC"}, id DESC
         LIMIT $3`,
        [projectId.data, service ?? null, limit],
      );

      // The sparkline window ends at the project's newest per-minute count (not "now"), so
      // it stays meaningful for data that is not live.
      const latest = await pool.query<{ end_ms: string | null }>(
        `SELECT (extract(epoch FROM max(c.minute)) * 1000)::bigint::text AS end_ms
         FROM template_minute_counts c JOIN log_templates t ON t.id = c.template_id
         WHERE t.project_id = $1`,
        [projectId.data],
      );
      const endMs = latest.rows[0]?.end_ms == null ? null : Number(latest.rows[0].end_ms);
      const startMs = endMs === null ? null : endMs - (minutes - 1) * MINUTE_MS;

      const ids = templates.rows.map((row) => row.id);
      const series = new Map<string, number[]>();
      if (endMs !== null && startMs !== null && ids.length > 0) {
        const counts = await pool.query<{ template_id: string; minute_ms: string; count: number }>(
          `SELECT template_id::text AS template_id,
                  (extract(epoch FROM minute) * 1000)::bigint::text AS minute_ms, count
           FROM template_minute_counts
           WHERE template_id = ANY($1::bigint[]) AND minute >= to_timestamp($2::double precision / 1000)
             AND minute <= to_timestamp($3::double precision / 1000)`,
          [ids, startMs, endMs],
        );
        for (const row of counts.rows) {
          let values = series.get(row.template_id);
          if (!values) {
            values = new Array<number>(minutes).fill(0);
            series.set(row.template_id, values);
          }
          values[Math.round((Number(row.minute_ms) - startMs) / MINUTE_MS)] = row.count;
        }
      }

      const sampleIds = [
        ...new Set(
          templates.rows.flatMap((r) => r.example_event_ids.slice(0, SAMPLES_PER_TEMPLATE)),
        ),
      ];
      const samples = new Map<string, SampleRow>();
      if (sampleIds.length > 0) {
        const rows = await pool.query<SampleRow>(
          `SELECT id::text AS id,
                  to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ts, level, message
           FROM log_events WHERE project_id = $1 AND id = ANY($2::bigint[])`,
          [projectId.data, sampleIds],
        );
        for (const row of rows.rows) samples.set(row.id, row);
      }

      res.status(200).json({
        window:
          endMs === null || startMs === null
            ? null
            : {
                start: new Date(startMs).toISOString(),
                end: new Date(endMs).toISOString(),
                minutes,
              },
        items: templates.rows.map((row) => ({
          id: row.id,
          service: row.service,
          template: row.template,
          firstSeen: row.first_seen,
          lastSeen: row.last_seen,
          totalCount: Number(row.total_count),
          sparkline: series.get(row.id) ?? new Array<number>(endMs === null ? 0 : minutes).fill(0),
          samples: row.example_event_ids
            .slice(0, SAMPLES_PER_TEMPLATE)
            .map((id) => samples.get(id))
            .filter((s): s is SampleRow => s !== undefined),
        })),
      });
    }),
  );

  router.get(
    "/:id/templates/:tid/events",
    asyncHandler(async (req, res) => {
      const projectId = projectIdSchema.safeParse(req.params.id);
      const templateId = templateIdSchema.safeParse(req.params.tid);
      const query = eventsQuerySchema.safeParse(req.query);
      if (!projectId.success || !templateId.success || !query.success) {
        invalidQuery(res, {
          ...(projectId.success ? {} : { id: "must be a UUID" }),
          ...(templateId.success ? {} : { tid: "must be a numeric id" }),
          ...(query.success ? {} : query.error.flatten().fieldErrors),
        });
        return;
      }
      if (!(await assertOwnedProject(pool, projectId.data, req.user!.id))) {
        res.status(404).json({ error: "project_not_found" });
        return;
      }
      const exists = await pool.query(
        "SELECT 1 FROM log_templates WHERE id = $1 AND project_id = $2",
        [templateId.data, projectId.data],
      );
      if (exists.rowCount === 0) {
        res.status(404).json({ error: "template_not_found" });
        return;
      }

      const cursor = query.data.cursor ? decodeCursor(query.data.cursor) : null;
      const params: unknown[] = [projectId.data, templateId.data];
      let cursorSql = "";
      if (cursor) {
        params.push(cursor.t, cursor.i);
        cursorSql = "AND (ts, id) < ($3::timestamptz, $4::bigint)";
      }
      params.push(query.data.limit + 1);

      const result = await pool.query<{
        id: string;
        ts_iso: string;
        service: string;
        level: string;
        message: string;
        attrs: Record<string, unknown>;
      }>(
        `SELECT id::text AS id,
                to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ts_iso,
                service, level, message, attrs
         FROM log_events
         WHERE project_id = $1 AND template_id = $2 ${cursorSql}
         ORDER BY ts DESC, id DESC
         LIMIT $${params.length}`,
        params,
      );

      const hasMore = result.rows.length > query.data.limit;
      const page = hasMore ? result.rows.slice(0, query.data.limit) : result.rows;
      const last = page[page.length - 1];
      res.status(200).json({
        items: page.map((row) => ({
          id: row.id,
          ts: row.ts_iso,
          service: row.service,
          level: row.level,
          message: row.message,
          attrs: row.attrs,
        })),
        nextCursor: hasMore && last ? encodeCursor({ t: last.ts_iso, i: last.id }) : null,
      });
    }),
  );

  return router;
}
