import "../env.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { generate } from "@log-explorer/loggen";
import { createApp } from "../app.js";
import { createPool } from "../db.js";

const pool = createPool();
const app = createApp(pool);

interface Session {
  cookie: string[];
  projectId: string;
  apiKey: string;
}

async function createSession(): Promise<Session> {
  const email = `test-${Math.random().toString(36).slice(2)}@example.com`;
  await request(app).post("/auth/register").send({ email, password: "password123" });
  const login = await request(app).post("/auth/login").send({ email, password: "password123" });
  const cookie = [login.headers["set-cookie"]].flat() as string[];
  const project = await request(app).post("/projects").set("Cookie", cookie).send({ name: "demo" });
  const key = await request(app)
    .post(`/projects/${project.body.id}/api-keys`)
    .set("Cookie", cookie);
  return { cookie, projectId: project.body.id as string, apiKey: key.body.key as string };
}

const COUNT = 2000;
let session: Session;

beforeAll(async () => {
  await pool.query("TRUNCATE users CASCADE");
  session = await createSession();
  const { events } = generate({ seed: 5, count: COUNT });
  for (let i = 0; i < events.length; i += 500) {
    await request(app)
      .post("/ingest")
      .set("x-api-key", session.apiKey)
      .send(events.slice(i, i + 500));
  }
});

beforeEach(() => undefined);

afterAll(async () => {
  await pool.query("TRUNCATE users CASCADE");
  await pool.end();
});

const get = (path: string, cookie = session.cookie) => request(app).get(path).set("Cookie", cookie);

describe("GET /projects/:id/templates", () => {
  it("lists templates by count with sparkline and samples", async () => {
    // The 60-minute run touches 61 minute buckets, so use a window that fits all of them.
    const response = await get(`/projects/${session.projectId}/templates?minutes=120`);
    expect(response.status).toBe(200);
    const items = response.body.items as {
      totalCount: number;
      service: string;
      template: string;
      sparkline: number[];
      samples: { message: string }[];
    }[];

    const counts = items.map((i) => i.totalCount);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(COUNT);

    expect(response.body.window.minutes).toBe(120);
    for (const item of items) {
      expect(item.sparkline).toHaveLength(120);
      // Every count falls inside the window, so the sparkline adds up to the total.
      expect(item.sparkline.reduce((a, b) => a + b, 0)).toBe(item.totalCount);
      expect(item.samples.length).toBeGreaterThan(0);
      expect(item.samples.length).toBeLessThanOrEqual(3);
    }
  });

  it("filters by service and supports sort=recent and limit", async () => {
    const response = await get(
      `/projects/${session.projectId}/templates?service=payments&sort=recent&limit=2`,
    );
    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(2);
    for (const item of response.body.items) expect(item.service).toBe("payments");
  });

  it("returns an empty list (no window) for a project without templates", async () => {
    const other = await createSession();
    const response = await get(`/projects/${other.projectId}/templates`, other.cookie);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ window: null, items: [] });
  });

  it("requires auth, hides other users' projects, and validates input", async () => {
    expect((await request(app).get(`/projects/${session.projectId}/templates`)).status).toBe(401);

    const stranger = await createSession();
    expect((await get(`/projects/${session.projectId}/templates`, stranger.cookie)).status).toBe(
      404,
    );

    expect((await get(`/projects/not-a-uuid/templates`)).status).toBe(422);
    expect((await get(`/projects/${session.projectId}/templates?limit=9999`)).status).toBe(422);
    expect((await get(`/projects/${session.projectId}/templates?sort=bogus`)).status).toBe(422);
  });
});

describe("GET /projects/:id/templates/:tid/events", () => {
  async function biggestTemplate(): Promise<{ id: string; totalCount: number }> {
    const list = await get(`/projects/${session.projectId}/templates?limit=1`);
    return list.body.items[0];
  }

  it("pages through every event of the template, newest first, without duplicates", async () => {
    const template = await biggestTemplate();
    const seen: { id: string; ts: string }[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 100; page++) {
      const url: string =
        `/projects/${session.projectId}/templates/${template.id}/events?limit=200` +
        (cursor ? `&cursor=${cursor}` : "");
      const response = await get(url);
      expect(response.status).toBe(200);
      seen.push(...response.body.items);
      cursor = response.body.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(template.totalCount);
    expect(new Set(seen.map((e) => e.id)).size).toBe(seen.length);
    const stamps = seen.map((e) => e.ts);
    expect(stamps).toEqual([...stamps].sort().reverse());
  });

  it("404s for an unknown template or one from another project, 422s for bad input", async () => {
    const template = await biggestTemplate();
    const stranger = await createSession();

    expect((await get(`/projects/${session.projectId}/templates/999999999/events`)).status).toBe(
      404,
    );
    expect(
      (
        await get(
          `/projects/${stranger.projectId}/templates/${template.id}/events`,
          stranger.cookie,
        )
      ).status,
    ).toBe(404);
    expect((await get(`/projects/${session.projectId}/templates/abc/events`)).status).toBe(422);
    expect(
      (await get(`/projects/${session.projectId}/templates/${template.id}/events?cursor=garbage`))
        .status,
    ).toBe(422);
  });
});
