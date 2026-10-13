import { Pool } from "pg";

export function createPool(): Pool {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  // pg emits "error" on idle clients when the connection drops; without a handler
  // this is an unhandled event that crashes the process instead of letting the
  // next query (and /health) report the failure.
  pool.on("error", () => {});
  return pool;
}
