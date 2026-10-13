import type { Cursor } from "./cursor.js";
import type { ParsedQuery } from "./types.js";

/**
 * The one place the log-search SELECT is built, so the route and the EXPLAIN
 * script measure exactly the same statement. `filters` must have been parsed with
 * startParam = 2 ($1 is the project id).
 */
export function buildLogsSql(
  projectId: string,
  filters: ParsedQuery,
  cursor: Cursor | null,
  limit: number,
): { sql: string; params: unknown[] } {
  const where = ["project_id = $1", ...filters.where];
  const params: unknown[] = [projectId, ...filters.params];
  if (cursor) {
    // Keyset pagination: "rows strictly after the last one I saw" in (ts, id) DESC order.
    where.push(`(ts, id) < ($${params.length + 1}::timestamptz, $${params.length + 2}::bigint)`);
    params.push(cursor.t, cursor.i);
  }
  params.push(limit);

  const sql =
    `SELECT id, to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ts_iso, ` +
    `service, level, message, attrs FROM log_events WHERE ${where.join(" AND ")} ` +
    `ORDER BY ts DESC, id DESC LIMIT $${params.length}`;
  return { sql, params };
}
