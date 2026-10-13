import type { NextFunction, Request, Response } from "express";
import type { Pool } from "pg";
import { hashApiKey } from "../projects/apiKeys.js";

declare module "express-serve-static-core" {
  interface Request {
    projectId?: string;
  }
}

export function createApiKeyAuth(pool: Pool) {
  return async function apiKeyAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
    const apiKey = req.header("x-api-key");
    if (!apiKey) {
      res.status(401).json({ error: "missing_api_key" });
      return;
    }
    const prefix = apiKey.slice(0, 8);
    const hash = hashApiKey(apiKey);
    const result = await pool.query<{ project_id: string }>(
      "SELECT project_id FROM api_keys WHERE key_prefix = $1 AND key_hash = $2 AND revoked_at IS NULL",
      [prefix, hash],
    );
    if (result.rowCount === 0) {
      res.status(401).json({ error: "invalid_api_key" });
      return;
    }
    req.projectId = result.rows[0].project_id;
    next();
  };
}
