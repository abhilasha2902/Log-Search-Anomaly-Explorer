import { Router } from "express";
import type { Pool } from "pg";
import { requireAuth } from "../auth/middleware.js";
import { asyncHandler } from "../http.js";
import { assertOwnedProject } from "../projects/routes.js";
import { searchConfig } from "./config.js";
import { decodeCursor, encodeCursor } from "./cursor.js";
import { queryWithTimeout } from "./db.js";
import { buildLogsSql } from "./queries.js";
import { createTimeseriesHandler } from "./timeseries.js";
import { buildFilters, logsQuerySchema, projectIdSchema } from "./schema.js";

interface LogRow {
  id: string;
  ts_iso: string;
  service: string;
  level: string;
  message: string;
  attrs: Record<string, unknown>;
}

export function createSearchRouter(pool: Pool): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    "/:id/logs",
    asyncHandler(async (req, res) => {
      const projectId = projectIdSchema.safeParse(req.params.id);
      const query = logsQuerySchema.safeParse(req.query);
      if (!projectId.success || !query.success) {
        res.status(422).json({
          error: "invalid_query",
          details: {
            ...(projectId.success ? {} : { id: "must be a UUID" }),
            ...(query.success ? {} : query.error.flatten().fieldErrors),
          },
        });
        return;
      }

      // Parse before touching the DB so bad input costs nothing; the parser reads
      // `now` once per request and everything below uses that same instant.
      const now = new Date();
      const filters = buildFilters(query.data, now, 2);
      const cursor = query.data.cursor ? decodeCursor(query.data.cursor) : null;

      if (!(await assertOwnedProject(pool, projectId.data, req.user!.id))) {
        res.status(404).json({ error: "project_not_found" });
        return;
      }

      // One extra row tells us whether another page exists.
      const { sql, params } = buildLogsSql(projectId.data, filters, cursor, query.data.limit + 1);

      const result = await queryWithTimeout<LogRow>(
        pool,
        searchConfig().statementTimeoutMs,
        sql,
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

  router.get("/:id/stats/timeseries", createTimeseriesHandler(pool));

  return router;
}
