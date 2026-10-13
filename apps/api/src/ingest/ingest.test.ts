import "../env.js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Pool } from "pg";
import { createApp } from "../app.js";
import { createPool } from "../db.js";

const pool = createPool();
const app = createApp(pool);

async function createProjectWithApiKey(): Promise<string> {
  const email = `test-${Math.random().toString(36).slice(2)}@example.com`;
  await request(app).post("/auth/register").send({ email, password: "password123" });
  const login = await request(app).post("/auth/login").send({ email, password: "password123" });
  const cookie = [login.headers["set-cookie"]].flat() as string[];

  const project = await request(app).post("/projects").set("Cookie", cookie).send({ name: "demo" });
  const keyResponse = await request(app)
    .post(`/projects/${project.body.id}/api-keys`)
    .set("Cookie", cookie);
  return keyResponse.body.key as string;
}

function sampleEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ts: new Date().toISOString(),
    service: "api",
    level: "info",
    message: "request handled",
    ...overrides,
  };
}

beforeEach(async () => {
  await pool.query("TRUNCATE users CASCADE");
});

afterAll(async () => {
  await pool.end();
});

describe("POST /ingest", () => {
  it("accepts a valid batch and inserts the rows", async () => {
    const apiKey = await createProjectWithApiKey();
    const batch = [sampleEvent(), sampleEvent({ level: "error", message: "boom" })];

    const response = await request(app).post("/ingest").set("x-api-key", apiKey).send(batch);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ accepted: 2 });

    const rows = await pool.query("SELECT count(*) FROM log_events");
    expect(Number(rows.rows[0].count)).toBe(2);
  });

  it("rejects a missing x-api-key with 401", async () => {
    const response = await request(app).post("/ingest").send([sampleEvent()]);
    expect(response.status).toBe(401);
  });

  it("rejects an invalid x-api-key with 401", async () => {
    const response = await request(app)
      .post("/ingest")
      .set("x-api-key", "not-a-real-key")
      .send([sampleEvent()]);
    expect(response.status).toBe(401);
  });

  it("rejects a revoked api key with 401", async () => {
    const email = `test-${Math.random().toString(36).slice(2)}@example.com`;
    await request(app).post("/auth/register").send({ email, password: "password123" });
    const login = await request(app).post("/auth/login").send({ email, password: "password123" });
    const cookie = [login.headers["set-cookie"]].flat() as string[];
    const project = await request(app)
      .post("/projects")
      .set("Cookie", cookie)
      .send({ name: "demo" });
    const keyResponse = await request(app)
      .post(`/projects/${project.body.id}/api-keys`)
      .set("Cookie", cookie);
    await request(app)
      .delete(`/projects/${project.body.id}/api-keys/${keyResponse.body.id}`)
      .set("Cookie", cookie);

    const response = await request(app)
      .post("/ingest")
      .set("x-api-key", keyResponse.body.key)
      .send([sampleEvent()]);
    expect(response.status).toBe(401);
  });

  it("rejects a batch over the max size with 422 and inserts nothing", async () => {
    const apiKey = await createProjectWithApiKey();
    const batch = Array.from({ length: 1001 }, () => sampleEvent());

    const response = await request(app).post("/ingest").set("x-api-key", apiKey).send(batch);

    expect(response.status).toBe(422);
    const rows = await pool.query("SELECT count(*) FROM log_events");
    expect(Number(rows.rows[0].count)).toBe(0);
  });

  it("rejects a malformed event in the batch with 422 and inserts nothing (all-or-nothing)", async () => {
    const apiKey = await createProjectWithApiKey();
    const batch = [sampleEvent(), sampleEvent({ level: "not-a-real-level" })];

    const response = await request(app).post("/ingest").set("x-api-key", apiKey).send(batch);

    expect(response.status).toBe(422);
    const rows = await pool.query("SELECT count(*) FROM log_events");
    expect(Number(rows.rows[0].count)).toBe(0);
  });
});

describe("database failures", () => {
  it("returns 500 and keeps serving when the database rejects", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    const apiKey = await createProjectWithApiKey();

    // Key lookup fails (apiKeyAuth middleware).
    const authBroken = createApp({
      query: () => Promise.reject(new Error("boom")),
    } as unknown as Pool);
    const first = await request(authBroken)
      .post("/ingest")
      .set("x-api-key", apiKey)
      .send([sampleEvent()]);
    expect(first.status).toBe(500);
    expect(first.body).toEqual({ error: "internal" });

    // Key lookup succeeds, the INSERT fails (route handler).
    const insertBroken = createApp({
      query: (sql: string, params?: unknown[]) =>
        sql.startsWith("INSERT") ? Promise.reject(new Error("boom")) : pool.query(sql, params),
    } as unknown as Pool);
    const second = await request(insertBroken)
      .post("/ingest")
      .set("x-api-key", apiKey)
      .send([sampleEvent()]);
    expect(second.status).toBe(500);
    expect(second.body).toEqual({ error: "internal" });

    // The process (and app) must still answer requests after the failures.
    const after = await request(insertBroken).post("/ingest");
    await new Promise((resolve) => setImmediate(resolve));
    process.off("unhandledRejection", onUnhandled);
    expect(after.status).toBe(401);
    expect(unhandled).toEqual([]);
  });
});
