import type { Pool, QueryResult, QueryResultRow } from "pg";

/**
 * Runs one query with a per-query statement_timeout. `set_config(..., true)` is
 * transaction-local, so the timeout never leaks to other users of the pooled
 * connection, and it can be passed as a bound parameter (SET cannot).
 */
export async function queryWithTimeout<T extends QueryResultRow>(
  pool: Pool,
  timeoutMs: number,
  sql: string,
  params: unknown[],
): Promise<QueryResult<T>> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('statement_timeout', $1, true)", [String(timeoutMs)]);
    const result = await client.query<T>(sql, params);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
