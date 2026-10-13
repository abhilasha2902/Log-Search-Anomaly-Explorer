import "../env.js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { generate } from "@log-explorer/loggen";
import { createApp } from "../app.js";
import { createPool } from "../db.js";

const pool = createPool();
const app = createApp(pool);

async function createProject(): Promise<{ projectId: string; apiKey: string }> {
  const email = `test-${Math.random().toString(36).slice(2)}@example.com`;
  await request(app).post("/auth/register").send({ email, password: "password123" });
  const login = await request(app).post("/auth/login").send({ email, password: "password123" });
  const cookie = [login.headers["set-cookie"]].flat() as string[];
  const project = await request(app).post("/projects").set("Cookie", cookie).send({ name: "demo" });
  const key = await request(app)
    .post(`/projects/${project.body.id}/api-keys`)
    .set("Cookie", cookie);
  return { projectId: project.body.id as string, apiKey: key.body.key as string };
}

function event(message: string, overrides: Record<string, unknown> = {}) {
  return {
    ts: "2026-01-01T10:00:30.000Z",
    service: "api",
    level: "info",
    message,
    ...overrides,
  };
}

interface TemplateRow {
  id: string;
  service: string;
  template: string;
  total_count: string;
  example_event_ids: string[];
  first_seen: Date;
  last_seen: Date;
}

async function templates(projectId: string): Promise<TemplateRow[]> {
  const result = await pool.query<TemplateRow>(
    `SELECT id::text, service, template, total_count::text, example_event_ids::text[] AS example_event_ids,
            first_seen, last_seen
     FROM log_templates WHERE project_id = $1 ORDER BY id`,
    [projectId],
  );
  return result.rows;
}

beforeEach(async () => {
  await pool.query("TRUNCATE users CASCADE");
});

afterAll(async () => {
  await pool.end();
});

describe("template mining during ingest", () => {
  it("assigns template ids and stores counts, examples and minute counts", async () => {
    const { projectId, apiKey } = await createProject();
    const batch = [
      event("GET /orders/1 200"),
      event("GET /orders/22 200", { ts: "2026-01-01T10:00:50.000Z" }),
      event("GET /orders/333 200", { ts: "2026-01-01T10:01:10.000Z" }),
      event("Unhandled error handling request", { level: "error" }),
    ];
    const response = await request(app).post("/ingest").set("x-api-key", apiKey).send(batch);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ accepted: 4 });

    const rows = await templates(projectId);
    expect(rows.map((r) => r.template).sort()).toEqual([
      "GET /orders/<*> <*>",
      "Unhandled error handling request",
    ]);
    const orders = rows.find((r) => r.template.startsWith("GET"))!;
    expect(orders.total_count).toBe("3");
    expect(orders.example_event_ids).toHaveLength(3);
    expect(orders.first_seen.toISOString()).toBe("2026-01-01T10:00:30.000Z");
    expect(orders.last_seen.toISOString()).toBe("2026-01-01T10:01:10.000Z");

    const events = await pool.query<{ template_id: string }>(
      "SELECT template_id::text FROM log_events WHERE project_id = $1",
      [projectId],
    );
    expect(events.rows.every((r) => r.template_id !== null)).toBe(true);

    const minutes = await pool.query<{ minute: Date; count: number }>(
      "SELECT minute, count FROM template_minute_counts WHERE template_id = $1 ORDER BY minute",
      [orders.id],
    );
    expect(minutes.rows.map((r) => [r.minute.toISOString(), r.count])).toEqual([
      ["2026-01-01T10:00:00.000Z", 2],
      ["2026-01-01T10:01:00.000Z", 1],
    ]);
  });

  it("accumulates across batches without creating duplicate templates", async () => {
    const { projectId, apiKey } = await createProject();
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post("/ingest")
        .set("x-api-key", apiKey)
        .send([event(`GET /orders/${i} 200`), event(`GET /orders/${i + 10} 200`)]);
    }
    const rows = await templates(projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0].total_count).toBe("6");
    // Examples are capped at 5 even though 6 lines were seen.
    expect(rows[0].example_event_ids).toHaveLength(5);
    const minute = await pool.query<{ count: number }>(
      "SELECT count FROM template_minute_counts WHERE template_id = $1",
      [rows[0].id],
    );
    expect(minute.rows).toEqual([{ count: 6 }]);
  });

  it("stores the generalised text when a later line widens a template", async () => {
    const { projectId, apiKey } = await createProject();
    await request(app)
      .post("/ingest")
      .set("x-api-key", apiKey)
      .send([event("connected to alice from the office network")]);
    expect((await templates(projectId))[0].template).toBe(
      "connected to alice from the office network",
    );
    await request(app)
      .post("/ingest")
      .set("x-api-key", apiKey)
      .send([event("connected to bob from the office network")]);
    const rows = await templates(projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0].template).toBe("connected to <*> from the office network");
    expect(rows[0].total_count).toBe("2");
  });

  it("keeps templates separate per service", async () => {
    const { projectId, apiKey } = await createProject();
    await request(app)
      .post("/ingest")
      .set("x-api-key", apiKey)
      .send([event("query completed"), event("query completed", { service: "db" })]);
    const rows = await templates(projectId);
    expect(rows.map((r) => r.service).sort()).toEqual(["api", "db"]);
  });

  it("does not create duplicates when concurrent requests send a brand-new shape", async () => {
    const { projectId, apiKey } = await createProject();
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        request(app)
          .post("/ingest")
          .set("x-api-key", apiKey)
          .send([event(`charge ch_${i} succeeded`), event(`charge ch_${i + 100} succeeded`)]),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual(Array(8).fill(200));
    const rows = await templates(projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0].total_count).toBe("16");
  });

  it("rebuilds the parser from the database after a restart", async () => {
    const { projectId, apiKey } = await createProject();
    await request(app)
      .post("/ingest")
      .set("x-api-key", apiKey)
      .send([event("GET /orders/1 200"), event("GET /orders/2 200")]);

    const restarted = createApp(pool); // a new app has a new, empty parser cache
    await request(restarted)
      .post("/ingest")
      .set("x-api-key", apiKey)
      .send([event("GET /orders/3 200")]);

    const rows = await templates(projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0].total_count).toBe("3");
  });

  it("rolls back the events if the statistics update fails", async () => {
    const { projectId, apiKey } = await createProject();
    await pool.query("ALTER TABLE template_minute_counts RENAME TO template_minute_counts_x");
    try {
      const response = await request(app)
        .post("/ingest")
        .set("x-api-key", apiKey)
        .send([event("GET /orders/1 200")]);
      expect(response.status).toBe(500);
    } finally {
      await pool.query("ALTER TABLE template_minute_counts_x RENAME TO template_minute_counts");
    }
    const events = await pool.query("SELECT 1 FROM log_events WHERE project_id = $1", [projectId]);
    expect(events.rowCount).toBe(0);
  });

  it("recovers loggen's ground-truth templates, one-to-one, from a generated run", async () => {
    const { projectId, apiKey } = await createProject();
    const { events, groundTruth } = generate({ seed: 42, count: 3000 });
    for (let i = 0; i < events.length; i += 500) {
      const response = await request(app)
        .post("/ingest")
        .set("x-api-key", apiKey)
        .send(events.slice(i, i + 500));
      expect(response.status).toBe(200);
    }

    const rows = await pool.query<{ template_id: string }>(
      "SELECT template_id::text FROM log_events WHERE project_id = $1 ORDER BY id",
      [projectId],
    );
    expect(rows.rows).toHaveLength(events.length);

    // Map each stored template to the set of ground-truth ids that landed in it, and back.
    const truthByTemplate = new Map<string, Set<string>>();
    const templatesByTruth = new Map<string, Set<string>>();
    groundTruth.events.forEach((truth, line) => {
      const templateId = rows.rows[line].template_id;
      if (!truthByTemplate.has(templateId)) truthByTemplate.set(templateId, new Set());
      truthByTemplate.get(templateId)!.add(truth.templateId);
      if (!templatesByTruth.has(truth.templateId))
        templatesByTruth.set(truth.templateId, new Set());
      templatesByTruth.get(truth.templateId)!.add(templateId);
    });

    for (const [templateId, truths] of truthByTemplate) {
      expect(truths.size, `template ${templateId} mixes ${[...truths].join(",")}`).toBe(1);
    }
    for (const [truthId, found] of templatesByTruth) {
      expect(found.size, `ground truth ${truthId} was split`).toBe(1);
    }
    expect(truthByTemplate.size).toBe(templatesByTruth.size);
  });
});
