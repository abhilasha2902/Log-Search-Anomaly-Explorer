import "../env.js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { createPool } from "../db.js";
import { severityFor } from "./severity.js";

const pool = createPool();
const app = createApp(pool);

interface Session {
  cookie: string[];
  projectId: string;
}

async function createSession(): Promise<Session> {
  const email = `test-${Math.random().toString(36).slice(2)}@example.com`;
  await request(app).post("/auth/register").send({ email, password: "password123" });
  const login = await request(app).post("/auth/login").send({ email, password: "password123" });
  const cookie = [login.headers["set-cookie"]].flat() as string[];
  const project = await request(app).post("/projects").set("Cookie", cookie).send({ name: "demo" });
  return { cookie, projectId: project.body.id as string };
}

async function addTemplate(
  projectId: string,
  service: string,
  template: string,
  exampleLevel?: string,
): Promise<string> {
  let exampleIds: string[] = [];
  if (exampleLevel) {
    const event = await pool.query<{ id: string }>(
      `INSERT INTO log_events (project_id, ts, service, level, message)
       VALUES ($1, '2026-01-01T10:00:00Z', $2, $3, 'example') RETURNING id::text AS id`,
      [projectId, service, exampleLevel],
    );
    exampleIds = [event.rows[0].id];
  }
  const result = await pool.query<{ id: string }>(
    `INSERT INTO log_templates (project_id, service, template, first_seen, last_seen, example_event_ids)
     VALUES ($1, $2, $3, '2026-01-01T10:00:00Z', '2026-01-01T10:00:00Z', $4::bigint[])
     RETURNING id::text AS id`,
    [projectId, service, template, exampleIds],
  );
  return result.rows[0].id;
}

async function addAnomaly(
  projectId: string,
  templateId: string,
  type: string,
  score: number,
  start: string,
  end: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO anomalies (project_id, template_id, type, detected_at, score, window_start, window_end)
     VALUES ($1, $2, $3, $5, $4, $5, $6)`,
    [projectId, templateId, type, score, start, end],
  );
}

beforeEach(async () => {
  await pool.query("TRUNCATE users CASCADE");
});

afterAll(async () => {
  await pool.end();
});

describe("severityFor", () => {
  it("grades spikes by z-score", () => {
    expect(severityFor("rate_spike", 4.5, null)).toBe("low");
    expect(severityFor("rate_spike", 6, null)).toBe("medium");
    expect(severityFor("rate_spike", 10, null)).toBe("high");
  });

  it("grades new templates by their first example line's level", () => {
    expect(severityFor("new_template", 1, "error")).toBe("high");
    expect(severityFor("new_template", 1, "warn")).toBe("medium");
    expect(severityFor("new_template", 1, "info")).toBe("low");
    expect(severityFor("new_template", 1, null)).toBe("low");
  });
});

describe("GET /projects/:id/anomalies", () => {
  it("lists anomalies newest window first, with template and severity", async () => {
    const { cookie, projectId } = await createSession();
    const errorTemplate = await addTemplate(projectId, "api", "NullPointerException <*>", "error");
    const spikeTemplate = await addTemplate(projectId, "db", "slow query detected");
    await addAnomaly(
      projectId,
      errorTemplate,
      "new_template",
      1,
      "2026-01-01T10:30:00Z",
      "2026-01-01T10:31:00Z",
    );
    await addAnomaly(
      projectId,
      spikeTemplate,
      "rate_spike",
      17.1,
      "2026-01-01T10:15:00Z",
      "2026-01-01T10:20:00Z",
    );

    const response = await request(app)
      .get(`/projects/${projectId}/anomalies`)
      .set("Cookie", cookie);
    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(2);
    expect(response.body.items[0]).toMatchObject({
      type: "new_template",
      severity: "high",
      windowStart: "2026-01-01T10:30:00.000Z",
      windowEnd: "2026-01-01T10:31:00.000Z",
      template: { service: "api", template: "NullPointerException <*>" },
    });
    expect(response.body.items[1]).toMatchObject({
      type: "rate_spike",
      severity: "high",
      score: 17.1,
      template: { service: "db", template: "slow query detected" },
    });
  });

  it("filters by type and by overlapping time range, and respects limit", async () => {
    const { cookie, projectId } = await createSession();
    const t = await addTemplate(projectId, "api", "a");
    await addAnomaly(projectId, t, "rate_spike", 5, "2026-01-01T10:00:00Z", "2026-01-01T10:05:00Z");
    await addAnomaly(projectId, t, "rate_spike", 5, "2026-01-01T11:00:00Z", "2026-01-01T11:05:00Z");
    await addAnomaly(
      projectId,
      t,
      "new_template",
      1,
      "2026-01-01T12:00:00Z",
      "2026-01-01T12:01:00Z",
    );
    const get = (query: string) =>
      request(app).get(`/projects/${projectId}/anomalies?${query}`).set("Cookie", cookie);

    expect((await get("type=new_template")).body.items).toHaveLength(1);
    expect(
      (await get("from=2026-01-01T10:30:00Z&to=2026-01-01T11:30:00Z")).body.items,
    ).toHaveLength(1);
    // A window that ends exactly at `from` does not overlap it.
    expect(
      (await get("from=2026-01-01T10:05:00Z&to=2026-01-01T10:59:00Z")).body.items,
    ).toHaveLength(0);
    expect((await get("limit=2")).body.items).toHaveLength(2);
  });

  it("returns an empty list for a project without anomalies", async () => {
    const { cookie, projectId } = await createSession();
    const response = await request(app)
      .get(`/projects/${projectId}/anomalies`)
      .set("Cookie", cookie);
    expect(response.body).toEqual({ items: [] });
  });

  it("requires auth, hides other users' projects and validates input", async () => {
    const owner = await createSession();
    const stranger = await createSession();
    const url = `/projects/${owner.projectId}/anomalies`;

    expect((await request(app).get(url)).status).toBe(401);
    expect((await request(app).get(url).set("Cookie", stranger.cookie)).status).toBe(404);
    const bad = (query: string) => request(app).get(`${url}?${query}`).set("Cookie", owner.cookie);
    expect((await bad("type=bogus")).status).toBe(422);
    expect((await bad("limit=100000")).status).toBe(422);
    expect((await bad("from=yesterday")).status).toBe(422);
    expect((await bad("from=2026-01-02T00:00:00Z&to=2026-01-01T00:00:00Z")).status).toBe(422);
    expect(
      (await request(app).get("/projects/not-a-uuid/anomalies").set("Cookie", owner.cookie)).status,
    ).toBe(422);
  });
});
