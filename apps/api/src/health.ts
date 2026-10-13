import type { Pool } from "pg";
import type { Request, Response } from "express";

export function createHealthHandler(pool: Pool) {
  return async function healthHandler(_req: Request, res: Response): Promise<void> {
    try {
      await pool.query("SELECT 1");
      res.status(200).json({ status: "ok", db: "ok" });
    } catch (error) {
      res.status(503).json({ status: "error", db: "unreachable", error: String(error) });
    }
  };
}
