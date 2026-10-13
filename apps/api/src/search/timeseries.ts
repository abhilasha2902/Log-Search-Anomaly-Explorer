import type { Pool } from "pg";
import { assertOwnedProject } from "../projects/routes.js";
import { asyncHandler } from "../http.js";
import { searchConfig } from "./config.js";
import { queryWithTimeout } from "./db.js";
import { buildTimeseriesSql } from "./queries.js";
import { buildFilters, filterQuerySchema, projectIdSchema } from "./schema.js";
import { QueryError } from "./types.js";

/** One bucket per minute, so 24 hours is at most 1,440 buckets. */
export const TIMESERIES_MAX_RANGE_MS = 24 * 3_600_000;
export const TIMESERIES_DEFAULT_RANGE_MS = 3_600_000;

interface BucketRow {
  t: string;
  count: number;
}

export function createTimeseriesHandler(pool: Pool) {
  return asyncHandler(async (req, res) => {
    const projectId = projectIdSchema.safeParse(req.params.id);
    const query = filterQuerySchema.safeParse(req.query);
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

    const now = new Date();
    let filters = buildFilters(query.data, now, 2);
    if (filters.filters.from === null) {
      // No lower bound given: default to the hour before the upper bound (or before now).
      const end = filters.filters.to ?? now;
      const from = new Date(end.getTime() - TIMESERIES_DEFAULT_RANGE_MS).toISOString();
      filters = buildFilters({ ...query.data, from }, now, 2);
    }
    const from = filters.filters.from!;
    const to = filters.filters.to ?? now;
    if (to.getTime() - from.getTime() > TIMESERIES_MAX_RANGE_MS) {
      throw new QueryError("the chart supports time ranges of up to 24 hours");
    }

    if (!(await assertOwnedProject(pool, projectId.data, req.user!.id))) {
      res.status(404).json({ error: "project_not_found" });
      return;
    }

    const { sql, params } = buildTimeseriesSql(projectId.data, filters);
    const result = await queryWithTimeout<BucketRow>(
      pool,
      searchConfig().statementTimeoutMs,
      sql,
      params,
    );
    res.status(200).json({
      from: from.toISOString(),
      to: to.toISOString(),
      buckets: result.rows.map((row) => ({ t: row.t, count: row.count })),
    });
  });
}
