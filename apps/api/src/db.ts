import { Pool, type PoolClient } from "pg";

export function createPool(): Pool {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  // pg emits "error" on idle clients when the connection drops; without a handler
  // this is an unhandled event that crashes the process instead of letting the
  // next query (and /health) report the failure.
  pool.on("error", () => {});
  return pool;
}

/** Runs fn in a transaction on one connection; rolls back and rethrows on any error. */
export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
