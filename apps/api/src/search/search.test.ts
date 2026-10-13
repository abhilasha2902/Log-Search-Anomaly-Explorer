import "../env.js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Pool } from "pg";
import { createApp } from "../app.js";
import { createPool } from "../db.js";
import { queryWithTimeout } from "./db.js";
import { decodeCursor, encodeCursor } from "./cursor.js";

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

interface Seed {
  ts?: string;
  service?: string;
  level?: string;
  message: string;
}

async function seed(projectId: string, events: Seed[]): Promise<void> {
  for (const e of events) {
    await pool.query(
      "INSERT INTO log_events (project_id, ts, service, level, message) VALUES ($1, $2, $3, $4, $5)",
      [
        projectId,
        e.ts ?? new Date().toISOString(),
        e.service ?? "api",
        e.level ?? "info",
        e.message,
      ],
    );
  }
}

function getLogs(session: Session, query: Record<string, string | number> = {}) {
  return request(app)
    .get(`/projects/${session.projectId}/logs`)
    .query(query)
    .set("Cookie", session.cookie);
}

const messages = (body: { items: { message: string }[] }) => body.items.map((i) => i.message);

beforeEach(async () => {
  await pool.query("TRUNCATE users CASCADE");
});

afterAll(async () => {
  await pool.end();
});

describe("GET /projects/:id/logs", () => {
  it("requires authentication", async () => {
    const session = await createSession();
    const response = await request(app).get(`/projects/${session.projectId}/logs`);
    expect(response.status).toBe(401);
  });

  it("returns only the caller's project rows, and 404 for someone else's project", async () => {
    const mine = await createSession();
    const theirs = await createSession();
    await seed(mine.projectId, [{ message: "mine one" }]);
    await seed(theirs.projectId, [{ message: "theirs one" }]);

    const ok = await getLogs(mine);
    expect(ok.status).toBe(200);
    expect(messages(ok.body)).toEqual(["mine one"]);

    const forbidden = await request(app)
      .get(`/projects/${theirs.projectId}/logs`)
      .set("Cookie", mine.cookie);
    expect(forbidden.status).toBe(404);
    expect(forbidden.body).toEqual({ error: "project_not_found" });
  });

  it("returns 404 for an unknown project and 422 for a malformed id", async () => {
    const session = await createSession();
    const unknown = await request(app)
      .get("/projects/00000000-0000-4000-8000-000000000000/logs")
      .set("Cookie", session.cookie);
    expect(unknown.status).toBe(404);
    const malformed = await request(app)
      .get("/projects/not-a-uuid/logs")
      .set("Cookie", session.cookie);
    expect(malformed.status).toBe(422);
  });

  it("returns items in ts desc order with the documented shape", async () => {
    const session = await createSession();
    await seed(session.projectId, [
      { ts: "2024-05-01T10:00:00.000Z", message: "old", level: "warn", service: "db" },
      { ts: "2024-05-01T11:00:00.000Z", message: "new" },
    ]);
    const response = await getLogs(session);
    expect(messages(response.body)).toEqual(["new", "old"]);
    expect(response.body.nextCursor).toBeNull();
    expect(response.body.items[1]).toMatchObject({
      ts: "2024-05-01T10:00:00.000000Z",
      service: "db",
      level: "warn",
      message: "old",
      attrs: {},
    });
    expect(typeof response.body.items[1].id).toBe("string");
  });

  it("filters by level and service (params and q tokens) and combines them", async () => {
    const session = await createSession();
    await seed(session.projectId, [
      { message: "a", level: "error", service: "api" },
      { message: "b", level: "error", service: "db" },
      { message: "c", level: "warn", service: "api" },
      { message: "d", level: "info", service: "api" },
    ]);
    expect(messages((await getLogs(session, { level: "error" })).body).sort()).toEqual(["a", "b"]);
    expect(messages((await getLogs(session, { level: "error", service: "api" })).body)).toEqual([
      "a",
    ]);
    expect(messages((await getLogs(session, { q: "level:error service:db" })).body)).toEqual(["b"]);
    expect(
      messages((await getLogs(session, { q: "level:error level:warn service:api" })).body).sort(),
    ).toEqual(["a", "c"]);
  });

  it("supports free text, phrases and negation", async () => {
    const session = await createSession();
    await seed(session.projectId, [
      { message: "timeout calling payments gateway" },
      { message: "timeout reading disk full marker" },
      { message: "disk full on node" },
      { message: "all good" },
    ]);
    const timeouts = messages((await getLogs(session, { q: "timeout" })).body).sort();
    expect(timeouts).toEqual([
      "timeout calling payments gateway",
      "timeout reading disk full marker",
    ]);
    expect(messages((await getLogs(session, { q: '"disk full"' })).body).sort()).toEqual([
      "disk full on node",
      "timeout reading disk full marker",
    ]);
    expect(messages((await getLogs(session, { q: "timeout -payments" })).body)).toEqual([
      "timeout reading disk full marker",
    ]);
    expect((await getLogs(session, { q: "timeo" })).body.items).toEqual([]);
  });

  it("filters by time with from inclusive and to exclusive", async () => {
    const session = await createSession();
    await seed(session.projectId, [
      { ts: "2024-05-01T10:00:00.000Z", message: "t10" },
      { ts: "2024-05-01T11:00:00.000Z", message: "t11" },
      { ts: "2024-05-01T12:00:00.000Z", message: "t12" },
    ]);
    const range = await getLogs(session, {
      from: "2024-05-01T10:00:00Z",
      to: "2024-05-01T12:00:00Z",
    });
    expect(messages(range.body)).toEqual(["t11", "t10"]);
    const tokens = await getLogs(session, { q: "from:2024-05-01T11:00:00Z" });
    expect(messages(tokens.body)).toEqual(["t12", "t11"]);
  });

  it("supports relative time", async () => {
    const session = await createSession();
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
    await seed(session.projectId, [
      { ts: ago(5 * 60_000), message: "five minutes ago" },
      { ts: ago(3 * 3_600_000), message: "three hours ago" },
    ]);
    expect(messages((await getLogs(session, { from: "1h" })).body)).toEqual(["five minutes ago"]);
    expect(messages((await getLogs(session, { q: "to:1h" })).body)).toEqual(["three hours ago"]);
  });

  it("walks every row exactly once with a cursor, including rows sharing the same ts", async () => {
    const session = await createSession();
    const events: Seed[] = [];
    for (let i = 0; i < 25; i++) {
      // 5 distinct timestamps x 5 rows each
      events.push({ ts: `2024-05-01T10:0${i % 5}:00.000Z`, message: `row ${i}` });
    }
    await seed(session.projectId, events);

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: Record<string, string | number> = { limit: 7 };
      if (cursor) query.cursor = cursor;
      const response = await getLogs(session, query);
      expect(response.status).toBe(200);
      seen.push(...response.body.items.map((i: { id: string }) => i.id));
      cursor = response.body.nextCursor;
      pages++;
    } while (cursor && pages < 10);

    expect(pages).toBe(4);
    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);

    const all = await pool.query("SELECT id FROM log_events ORDER BY ts DESC, id DESC");
    expect(seen).toEqual(all.rows.map((r) => r.id));
  });

  it("returns a null cursor when the last page is exactly full", async () => {
    const session = await createSession();
    await seed(session.projectId, [{ message: "one" }, { message: "two" }]);
    const response = await getLogs(session, { limit: 2 });
    expect(response.body.items).toHaveLength(2);
    expect(response.body.nextCursor).toBeNull();
  });

  it("rejects bad limit, cursor, time and query input with 422", async () => {
    const session = await createSession();
    const bad: Record<string, string | number>[] = [
      { limit: 201 },
      { limit: 0 },
      { limit: "abc" },
      { cursor: "garbage" },
      { cursor: Buffer.from('{"t":"x","i":"1"}').toString("base64url") },
      { from: "yesterday" },
      { to: "1d; DROP TABLE log_events" },
      { from: "1h", to: "2h" },
      { from: "31d" },
      { level: "fatal" },
      { q: "level:fatal" },
      { q: "a".repeat(501) },
    ];
    for (const query of bad) {
      const response = await getLogs(session, query);
      expect(response.status, JSON.stringify(query)).toBe(422);
    }
  });

  it("rejects repeated query params instead of crashing", async () => {
    const session = await createSession();
    const response = await request(app)
      .get(`/projects/${session.projectId}/logs?q=a&q=b`)
      .set("Cookie", session.cookie);
    expect(response.status).toBe(422);
  });

  it("treats injection attempts as plain search text", async () => {
    const session = await createSession();
    await seed(session.projectId, [{ message: "normal row" }]);
    const attacks = ["'; DROP TABLE log_events;--", '" OR 1=1 --', "-'; SELECT pg_sleep(5);--"];
    for (const q of attacks) {
      const response = await getLogs(session, { q });
      expect(response.status, q).toBe(200);
      expect(response.body.items).toEqual([]);
    }
    const stillThere = await pool.query("SELECT count(*)::int AS n FROM log_events");
    expect(stillThere.rows[0].n).toBe(1);
  });

  it("returns 500 JSON instead of hanging when the database fails", async () => {
    const failing = {
      query: () => Promise.reject(new Error("boom")),
    } as unknown as Pool;
    const brokenApp = createApp(failing);
    const session = await createSession();
    const response = await request(brokenApp)
      .get(`/projects/${session.projectId}/logs`)
      .set("Cookie", session.cookie);
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "internal" });
  });
});

describe("cursor encoding", () => {
  it("round-trips", () => {
    const cursor = { t: "2024-05-01T10:00:00.123456Z", i: "42" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });
});

describe("queryWithTimeout", () => {
  it("applies statement_timeout only inside its own transaction", async () => {
    const inside = await queryWithTimeout<{ statement_timeout: string }>(
      pool,
      1234,
      "SHOW statement_timeout",
      [],
    );
    expect(inside.rows[0].statement_timeout).toBe("1234ms");
    const after = await pool.query("SHOW statement_timeout");
    expect(after.rows[0].statement_timeout).not.toBe("1234ms");
  });

  it("cancels a slow query", async () => {
    await expect(queryWithTimeout(pool, 50, "SELECT pg_sleep(2)", [])).rejects.toMatchObject({
      code: "57014",
    });
  });
});
