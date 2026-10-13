import { Router } from "express";
import { z } from "zod";
import type { Pool } from "pg";
import { requireAuth } from "../auth/middleware.js";
import { generateApiKey } from "./apiKeys.js";

const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
});

export async function assertOwnedProject(
  pool: Pool,
  projectId: string,
  userId: string,
): Promise<boolean> {
  const result = await pool.query("SELECT id FROM projects WHERE id = $1 AND user_id = $2", [
    projectId,
    userId,
  ]);
  return (result.rowCount ?? 0) > 0;
}

export function createProjectsRouter(pool: Pool): Router {
  const router = Router();
  router.use(requireAuth);

  router.post("/", async (req, res) => {
    const parsed = createProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ error: "invalid_body", details: parsed.error.flatten() });
      return;
    }
    const result = await pool.query<{ id: string; name: string; created_at: string }>(
      "INSERT INTO projects (user_id, name) VALUES ($1, $2) RETURNING id, name, created_at",
      [req.user?.id, parsed.data.name],
    );
    res.status(201).json(result.rows[0]);
  });

  router.get("/", async (req, res) => {
    const result = await pool.query(
      "SELECT id, name, created_at FROM projects WHERE user_id = $1 ORDER BY created_at DESC",
      [req.user?.id],
    );
    res.status(200).json(result.rows);
  });

  router.post("/:id/api-keys", async (req, res) => {
    const owned = await assertOwnedProject(pool, req.params.id, req.user!.id);
    if (!owned) {
      res.status(404).json({ error: "project_not_found" });
      return;
    }
    const { fullKey, prefix, hash } = generateApiKey();
    const result = await pool.query<{ id: string; created_at: string }>(
      "INSERT INTO api_keys (project_id, key_hash, key_prefix) VALUES ($1, $2, $3) RETURNING id, created_at",
      [req.params.id, hash, prefix],
    );
    res.status(201).json({
      id: result.rows[0].id,
      key: fullKey,
      prefix,
      created_at: result.rows[0].created_at,
    });
  });

  router.delete("/:id/api-keys/:keyId", async (req, res) => {
    const owned = await assertOwnedProject(pool, req.params.id, req.user!.id);
    if (!owned) {
      res.status(404).json({ error: "project_not_found" });
      return;
    }
    const result = await pool.query(
      "UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND project_id = $2 AND revoked_at IS NULL",
      [req.params.keyId, req.params.id],
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: "api_key_not_found" });
      return;
    }
    res.status(200).json({ ok: true });
  });

  return router;
}
