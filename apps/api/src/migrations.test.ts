import "./env.js";
import { afterAll, describe, expect, it } from "vitest";
import { createPool } from "./db.js";

const pool = createPool();

afterAll(async () => {
  await pool.end();
});

async function columns(table: string): Promise<string[]> {
  const result = await pool.query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_name = $1",
    [table],
  );
  return result.rows.map((row) => row.column_name);
}

describe("Phase 3 schema", () => {
  it("has the template, minute-count and anomaly tables", async () => {
    expect(await columns("log_templates")).toEqual(
      expect.arrayContaining([
        "id",
        "project_id",
        "service",
        "template",
        "first_seen",
        "last_seen",
        "total_count",
        "example_event_ids",
        "embedding",
      ]),
    );
    expect(await columns("template_minute_counts")).toEqual(
      expect.arrayContaining(["template_id", "minute", "count"]),
    );
    expect(await columns("anomalies")).toEqual(
      expect.arrayContaining([
        "id",
        "project_id",
        "template_id",
        "type",
        "detected_at",
        "score",
        "window_start",
        "window_end",
      ]),
    );
    expect(await columns("log_events")).toContain("template_id");
  });

  it("rejects an unknown anomaly type", async () => {
    const user = await pool.query<{ id: string }>(
      "INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING id",
      [`mig-${Math.random().toString(36).slice(2)}@example.com`],
    );
    const project = await pool.query<{ id: string }>(
      "INSERT INTO projects (user_id, name) VALUES ($1, 'm') RETURNING id",
      [user.rows[0].id],
    );
    const template = await pool.query<{ id: string }>(
      `INSERT INTO log_templates (project_id, service, template, first_seen, last_seen)
       VALUES ($1, 'api', 't', now(), now()) RETURNING id`,
      [project.rows[0].id],
    );
    await expect(
      pool.query(
        `INSERT INTO anomalies (project_id, template_id, type, score, window_start, window_end)
         VALUES ($1, $2, 'bogus', 1, now(), now())`,
        [project.rows[0].id, template.rows[0].id],
      ),
    ).rejects.toThrow();
    await pool.query("DELETE FROM users WHERE id = $1", [user.rows[0].id]);
  });
});
