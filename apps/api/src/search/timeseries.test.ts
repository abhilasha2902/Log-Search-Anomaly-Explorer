import "../env.js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { createPool } from "../db.js";

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

const MINUTE = 60_000;
/** Start of the current minute, so "N minutes ago" lands on a clean bucket. */
const thisMinute = Math.floor(Date.now() / MINUTE) * MINUTE;
const minutesAgo = (n: number) => new Date(thisMinute - n * MINUTE);
const bucketKey = (date: Date) => date.toISOString().slice(0, 19) + "Z";

interface Seed {
  at: Date;
  level?: string;
  service?: string;
  message?: string;
}

async function seed(projectId: string, events: Seed[]): Promise<void> {
  for (const e of events) {
    await pool.query(
      "INSERT INTO log_events (project_id, ts, service, level, message) VALUES ($1, $2, $3, $4, $5)",
      [projectId, e.at.toISOString(), e.service ?? "api", e.level ?? "info", e.message ?? "hello"],
    );
  }
}

function getSeries(session: Session, query: Record<string, string> = {}) {
  return request(app)
    .get(`/projects/${session.projectId}/stats/timeseries`)
    .query(query)
    .set("Cookie", session.cookie);
}

const counts = (body: { buckets: { t: string; count: number }[] }) =>
  Object.fromEntries(body.buckets.map((b) => [b.t, b.count]));

beforeEach(async () => {
  await pool.query("TRUNCATE users CASCADE");
});

afterAll(async () => {
  await pool.end();
});

describe("GET /projects/:id/stats/timeseries", () => {
  it("requires authentication", async () => {
    const session = await createSession();
    const response = await request(app).get(`/projects/${session.projectId}/stats/timeseries`);
    expect(response.status).toBe(401);
  });

  it("counts events per minute, in time order", async () => {
    const session = await createSession();
    await seed(session.projectId, [
      { at: new Date(minutesAgo(10).getTime() + 5_000) },
      { at: new Date(minutesAgo(10).getTime() + 40_000) },
      { at: new Date(minutesAgo(10).getTime() + 59_999) },
      { at: new Date(minutesAgo(9).getTime() + 1_000) },
      { at: new Date(minutesAgo(5).getTime() + 30_000) },
    ]);
    const response = await getSeries(session);
    expect(response.status).toBe(200);
    expect(response.body.buckets).toEqual([
      { t: bucketKey(minutesAgo(10)), count: 3 },
      { t: bucketKey(minutesAgo(9)), count: 1 },
      { t: bucketKey(minutesAgo(5)), count: 1 },
    ]);
  });

  it("returns the effective range and defaults to the last hour", async () => {
    const session = await createSession();
    await seed(session.projectId, [{ at: minutesAgo(30) }, { at: minutesAgo(120) }]);
    const response = await getSeries(session);
    expect(counts(response.body)).toEqual({ [bucketKey(minutesAgo(30))]: 1 });
    const span = Date.parse(response.body.to) - Date.parse(response.body.from);
    expect(span).toBe(3_600_000);
  });

  it("returns an empty list when nothing matches", async () => {
    const session = await createSession();
    const response = await getSeries(session);
    expect(response.status).toBe(200);
    expect(response.body.buckets).toEqual([]);
  });

  it("applies the same filters as the logs search", async () => {
    const session = await createSession();
    await seed(session.projectId, [
      { at: minutesAgo(3), level: "error", service: "api", message: "gateway timeout" },
      { at: minutesAgo(3), level: "error", service: "db", message: "disk full" },
      { at: minutesAgo(2), level: "info", service: "api", message: "gateway ok" },
      { at: minutesAgo(1), level: "warn", service: "api", message: "slow gateway timeout" },
    ]);
    const key = (n: number) => bucketKey(minutesAgo(n));

    expect(counts((await getSeries(session, { level: "error" })).body)).toEqual({ [key(3)]: 2 });
    expect(counts((await getSeries(session, { service: "db" })).body)).toEqual({ [key(3)]: 1 });
    expect(counts((await getSeries(session, { q: "gateway -timeout" })).body)).toEqual({
      [key(2)]: 1,
    });
    expect(
      counts((await getSeries(session, { q: "level:error service:api timeout" })).body),
    ).toEqual({ [key(3)]: 1 });
    expect(counts((await getSeries(session, { q: '"slow gateway"' })).body)).toEqual({
      [key(1)]: 1,
    });
  });

  it("honours explicit from (inclusive) and to (exclusive)", async () => {
    const session = await createSession();
    await seed(session.projectId, [
      { at: minutesAgo(30) },
      { at: minutesAgo(20) },
      { at: minutesAgo(10) },
    ]);
    const response = await getSeries(session, {
      from: minutesAgo(30).toISOString(),
      to: minutesAgo(10).toISOString(),
    });
    expect(counts(response.body)).toEqual({
      [bucketKey(minutesAgo(30))]: 1,
      [bucketKey(minutesAgo(20))]: 1,
    });
  });

  it("defaults the lower bound to an hour before an explicit upper bound", async () => {
    const session = await createSession();
    await seed(session.projectId, [{ at: minutesAgo(150) }, { at: minutesAgo(300) }]);
    // to = 2h ago, so the default window is 3h ago .. 2h ago
    const response = await getSeries(session, { to: "2h" });
    expect(response.status).toBe(200);
    expect(counts(response.body)).toEqual({ [bucketKey(minutesAgo(150))]: 1 });
  });

  it("only returns the caller's own project data", async () => {
    const mine = await createSession();
    const theirs = await createSession();
    await seed(mine.projectId, [{ at: minutesAgo(5) }]);
    await seed(theirs.projectId, [{ at: minutesAgo(5) }, { at: minutesAgo(5) }]);
    expect(counts((await getSeries(mine)).body)).toEqual({ [bucketKey(minutesAgo(5))]: 1 });

    const forbidden = await request(app)
      .get(`/projects/${theirs.projectId}/stats/timeseries`)
      .set("Cookie", mine.cookie);
    expect(forbidden.status).toBe(404);
  });

  it("returns 404 for an unknown project and 422 for a malformed id", async () => {
    const session = await createSession();
    const unknown = await request(app)
      .get("/projects/00000000-0000-4000-8000-000000000000/stats/timeseries")
      .set("Cookie", session.cookie);
    expect(unknown.status).toBe(404);
    const malformed = await request(app)
      .get("/projects/nope/stats/timeseries")
      .set("Cookie", session.cookie);
    expect(malformed.status).toBe(422);
  });

  it("limits the range to 24 hours", async () => {
    const session = await createSession();
    expect((await getSeries(session, { from: "24h" })).status).toBe(200);
    const tooLong = await getSeries(session, { from: "25h" });
    expect(tooLong.status).toBe(422);
    expect(tooLong.body.message).toMatch(/24 hours/);
    expect((await getSeries(session, { from: "2024-01-01", to: "2024-01-03" })).status).toBe(422);
    expect((await getSeries(session, { q: "from:7d" })).status).toBe(422);
  });

  it("rejects invalid filters and times with 422", async () => {
    const session = await createSession();
    const invalid: Record<string, string>[] = [
      { from: "yesterday" },
      { level: "fatal" },
      { from: "1h", to: "2h" },
      { q: "x".repeat(501) },
      { to: "1d; DROP TABLE log_events" },
    ];
    for (const query of invalid) {
      const response = await getSeries(session, query);
      expect(response.status, JSON.stringify(query)).toBe(422);
    }
  });
});
