import "../env.js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "../db.js";

const pool = createPool();

beforeEach(async () => {
  await pool.query("TRUNCATE users CASCADE");
});

afterAll(async () => {
  await pool.end();
});

async function insertEvent(message: string): Promise<void> {
  const user = await pool.query<{ id: string }>(
    "INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING id",
    [`sv-${Math.random().toString(36).slice(2)}@example.com`],
  );
  const project = await pool.query<{ id: string }>(
    "INSERT INTO projects (user_id, name) VALUES ($1, 'p') RETURNING id",
    [user.rows[0].id],
  );
  await pool.query(
    "INSERT INTO log_events (project_id, ts, service, level, message) VALUES ($1, now(), 'api', 'error', $2)",
    [project.rows[0].id, message],
  );
}

describe("log_events.search_vector", () => {
  it("matches whole words, case-insensitively", async () => {
    await insertEvent("Timeout calling payments service");
    const hit = await pool.query(
      "SELECT 1 FROM log_events WHERE search_vector @@ plainto_tsquery('simple', $1)",
      ["timeout"],
    );
    expect(hit.rowCount).toBe(1);
  });

  it("does not match partial words", async () => {
    await insertEvent("Timeout calling payments service");
    const miss = await pool.query(
      "SELECT 1 FROM log_events WHERE search_vector @@ plainto_tsquery('simple', $1)",
      ["timeo"],
    );
    expect(miss.rowCount).toBe(0);
  });

  it("has a GIN index on search_vector", async () => {
    const result = await pool.query(
      "SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_log_events_search_vector'",
    );
    expect(result.rows[0].indexdef).toMatch(/USING gin/i);
  });
});
