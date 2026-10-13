import "../env.js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool } from "../db.js";
import { loadDetectorConfig } from "./config.js";
import { detectAll, detectProject } from "./detect.js";

const pool = createPool();
const config = loadDetectorConfig({});

beforeEach(async () => {
  await pool.query("TRUNCATE users CASCADE");
});

afterAll(async () => {
  await pool.end();
});

async function createProject(): Promise<string> {
  const user = await pool.query<{ id: string }>(
    "INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING id",
    [`det-${Math.random().toString(36).slice(2)}@example.com`],
  );
  const project = await pool.query<{ id: string }>(
    "INSERT INTO projects (user_id, name) VALUES ($1, 'p') RETURNING id",
    [user.rows[0].id],
  );
  return project.rows[0].id;
}

async function addTemplate(
  projectId: string,
  service: string,
  template: string,
  firstSeen: string,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO log_templates (project_id, service, template, first_seen, last_seen)
     VALUES ($1, $2, $3, $4, $4) RETURNING id::text AS id`,
    [projectId, service, template, firstSeen],
  );
  return result.rows[0].id;
}

/** Writes one count per minute, the first one at minute `start`. */
async function addCounts(templateId: string, start: string, counts: number[]): Promise<void> {
  const startMs = Date.parse(start);
  await pool.query(
    `INSERT INTO template_minute_counts (template_id, minute, count)
     SELECT $1, to_timestamp(($2::double precision + (g.i - 1) * 60000) / 1000), g.c
     FROM unnest($3::int[]) WITH ORDINALITY AS g(c, i)`,
    [templateId, startMs, counts],
  );
}

interface AnomalyRow {
  type: string;
  score: number;
  window_start: Date;
  window_end: Date;
  template_id: string;
}

async function anomalies(projectId: string, type?: string): Promise<AnomalyRow[]> {
  const result = await pool.query<AnomalyRow>(
    `SELECT type, score, window_start, window_end, template_id::text AS template_id
     FROM anomalies WHERE project_id = $1 AND ($2::text IS NULL OR type = $2)
     ORDER BY window_start, id`,
    [projectId, type ?? null],
  );
  return result.rows;
}

const at = (hhmmss: string) => new Date(`2026-01-01T${hhmmss}.000Z`);

describe("new template detection", () => {
  it("flags a template that appears after the service warm-up, once", async () => {
    const projectId = await createProject();
    await addTemplate(projectId, "api", "baseline", "2026-01-01T10:00:00Z");
    const late = await addTemplate(
      projectId,
      "api",
      "NullPointerException <*>",
      "2026-01-01T10:30:10Z",
    );

    const first = await detectProject(pool, projectId, at("10:31:00"), config);
    expect(first.newTemplates).toBe(1);
    const again = await detectProject(pool, projectId, at("10:32:00"), config);
    expect(again.newTemplates).toBe(0);

    const rows = await anomalies(projectId, "new_template");
    expect(rows).toHaveLength(1);
    expect(rows[0].template_id).toBe(late);
    expect(rows[0].window_start.toISOString()).toBe("2026-01-01T10:30:10.000Z");
  });

  it("does not flag templates that arrive during the service warm-up", async () => {
    const projectId = await createProject();
    await addTemplate(projectId, "api", "a", "2026-01-01T10:00:00Z");
    await addTemplate(projectId, "api", "b", "2026-01-01T10:05:00Z"); // 5 min < 10 min warm-up
    await detectProject(pool, projectId, at("10:06:00"), config);
    expect(await anomalies(projectId)).toHaveLength(0);
  });

  it("warm-up is per service: a new service's first template is not 'new'", async () => {
    const projectId = await createProject();
    await addTemplate(projectId, "api", "a", "2026-01-01T10:00:00Z");
    await addTemplate(projectId, "payments", "p", "2026-01-01T10:30:00Z"); // payments' own first
    await detectProject(pool, projectId, at("10:31:00"), config);
    expect(await anomalies(projectId)).toHaveLength(0);
  });

  it("ignores templates first seen before the 'recent' window", async () => {
    const projectId = await createProject();
    await addTemplate(projectId, "api", "a", "2026-01-01T10:00:00Z");
    await addTemplate(projectId, "api", "b", "2026-01-01T10:20:00Z");
    await detectProject(pool, projectId, at("10:45:00"), config);
    expect(await anomalies(projectId)).toHaveLength(0);
  });

  it("respects the configured warm-up", async () => {
    const projectId = await createProject();
    await addTemplate(projectId, "api", "a", "2026-01-01T10:00:00Z");
    await addTemplate(projectId, "api", "b", "2026-01-01T10:05:00Z");
    const strict = loadDetectorConfig({ SERVICE_WARMUP_MINUTES: "2" });
    await detectProject(pool, projectId, at("10:06:00"), strict);
    expect(await anomalies(projectId, "new_template")).toHaveLength(1);
  });
});

describe("rate spike detection", () => {
  async function steadyTemplate(projectId: string): Promise<string> {
    const id = await addTemplate(projectId, "db", "slow query detected", "2026-01-01T10:00:00Z");
    await addCounts(id, "2026-01-01T10:00:00Z", Array<number>(30).fill(20)); // 10:00 .. 10:29
    return id;
  }

  it("flags a spike in the last complete minute", async () => {
    const projectId = await createProject();
    const id = await steadyTemplate(projectId);
    await addCounts(id, "2026-01-01T10:30:00Z", [90]);

    const summary = await detectProject(pool, projectId, at("10:31:20"), config);
    expect(summary.spikesCreated).toBe(1);
    const rows = await anomalies(projectId, "rate_spike");
    expect(rows).toHaveLength(1);
    expect(rows[0].score).toBeGreaterThanOrEqual(4);
    expect(rows[0].window_start.toISOString()).toBe("2026-01-01T10:30:00.000Z");
    expect(rows[0].window_end.toISOString()).toBe("2026-01-01T10:31:00.000Z");
  });

  it("is idempotent and extends an ongoing spike instead of duplicating it", async () => {
    const projectId = await createProject();
    const id = await steadyTemplate(projectId);
    await addCounts(id, "2026-01-01T10:30:00Z", [90, 95]);

    await detectProject(pool, projectId, at("10:31:20"), config);
    await detectProject(pool, projectId, at("10:31:50"), config); // same minute again
    expect(await anomalies(projectId, "rate_spike")).toHaveLength(1);

    const summary = await detectProject(pool, projectId, at("10:32:10"), config);
    expect(summary.spikesExtended).toBe(1);
    const rows = await anomalies(projectId, "rate_spike");
    expect(rows).toHaveLength(1);
    expect(rows[0].window_end.toISOString()).toBe("2026-01-01T10:32:00.000Z");
  });

  it("starts a new anomaly after a quiet gap longer than the merge gap", async () => {
    const projectId = await createProject();
    const id = await steadyTemplate(projectId);
    // spike at 10:30, quiet 10:31..10:35, spike again at 10:36
    await addCounts(id, "2026-01-01T10:30:00Z", [90, 20, 20, 20, 20, 20, 90]);
    await detectProject(pool, projectId, at("10:31:20"), config);
    await detectProject(pool, projectId, at("10:37:20"), config);
    expect(await anomalies(projectId, "rate_spike")).toHaveLength(2);
  });

  it("does not flag small absolute counts or short histories", async () => {
    const projectId = await createProject();
    const small = await addTemplate(projectId, "api", "rare", "2026-01-01T10:00:00Z");
    await addCounts(small, "2026-01-01T10:00:00Z", [...Array<number>(30).fill(1), 8]);
    const young = await addTemplate(projectId, "api", "young", "2026-01-01T10:25:00Z");
    await addCounts(young, "2026-01-01T10:25:00Z", [20, 20, 20, 20, 20, 90]);

    await detectProject(pool, projectId, at("10:31:20"), config);
    expect(await anomalies(projectId, "rate_spike")).toHaveLength(0);
  });

  it("respects configured thresholds", async () => {
    const projectId = await createProject();
    const id = await steadyTemplate(projectId);
    await addCounts(id, "2026-01-01T10:30:00Z", [90]);
    const lenient = loadDetectorConfig({ RATE_Z_THRESHOLD: "1000" });
    await detectProject(pool, projectId, at("10:31:20"), lenient);
    expect(await anomalies(projectId, "rate_spike")).toHaveLength(0);
  });

  it("does not judge the minute that is still being filled", async () => {
    const projectId = await createProject();
    const id = await steadyTemplate(projectId);
    await addCounts(id, "2026-01-01T10:30:00Z", [90]); // the current minute at 10:30:30
    await detectProject(pool, projectId, at("10:30:30"), config);
    expect(await anomalies(projectId, "rate_spike")).toHaveLength(0);
  });
});

describe("detectAll", () => {
  it("keeps going when one project fails", async () => {
    const bad = await createProject();
    const good = await createProject();
    await addTemplate(bad, "api", "a", "2026-01-01T10:00:00Z");
    await addTemplate(good, "api", "a", "2026-01-01T10:00:00Z");
    await addTemplate(good, "api", "b <*>", "2026-01-01T10:30:10Z");

    const flaky = {
      query: (sql: string, params?: unknown[]) =>
        params?.[0] === bad ? Promise.reject(new Error("boom")) : pool.query(sql, params),
    } as unknown as Pool;
    const errors: string[] = [];
    const summary = await detectAll(flaky, at("10:31:00"), config, (id) => errors.push(id));

    expect(summary).toMatchObject({ projects: 2, failedProjects: 1, newTemplates: 1 });
    expect(errors).toEqual([bad]);
    expect(await anomalies(good, "new_template")).toHaveLength(1);
  });
});
