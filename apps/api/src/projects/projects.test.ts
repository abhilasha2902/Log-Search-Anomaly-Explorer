import "../env.js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Pool } from "pg";
import { createApp } from "../app.js";
import { createPool } from "../db.js";

const pool = createPool();
const app = createApp(pool);

async function registerAndLogin(): Promise<string[]> {
  const email = `test-${Math.random().toString(36).slice(2)}@example.com`;
  await request(app).post("/auth/register").send({ email, password: "password123" });
  const login = await request(app).post("/auth/login").send({ email, password: "password123" });
  return [login.headers["set-cookie"]].flat() as string[];
}

beforeEach(async () => {
  await pool.query("TRUNCATE users CASCADE");
});

afterAll(async () => {
  await pool.end();
});

describe("projects", () => {
  it("creates and lists a project scoped to the owning user", async () => {
    const cookie = await registerAndLogin();

    const createResponse = await request(app)
      .post("/projects")
      .set("Cookie", cookie)
      .send({ name: "demo" });
    expect(createResponse.status).toBe(201);

    const listResponse = await request(app).get("/projects").set("Cookie", cookie);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body).toHaveLength(1);
    expect(listResponse.body[0].name).toBe("demo");
  });

  it("does not let user B see user A's projects", async () => {
    const cookieA = await registerAndLogin();
    const cookieB = await registerAndLogin();

    await request(app).post("/projects").set("Cookie", cookieA).send({ name: "A's project" });

    const listResponse = await request(app).get("/projects").set("Cookie", cookieB);
    expect(listResponse.body).toHaveLength(0);
  });

  it("does not let user B create an API key on user A's project", async () => {
    const cookieA = await registerAndLogin();
    const cookieB = await registerAndLogin();

    const createResponse = await request(app)
      .post("/projects")
      .set("Cookie", cookieA)
      .send({ name: "A's project" });
    const projectId = createResponse.body.id;

    const keyResponse = await request(app)
      .post(`/projects/${projectId}/api-keys`)
      .set("Cookie", cookieB);

    expect(keyResponse.status).toBe(404);
  });

  it("creates an API key, shows it once, and the key is not retrievable again", async () => {
    const cookie = await registerAndLogin();
    const createResponse = await request(app)
      .post("/projects")
      .set("Cookie", cookie)
      .send({ name: "demo" });
    const projectId = createResponse.body.id;

    const keyResponse = await request(app)
      .post(`/projects/${projectId}/api-keys`)
      .set("Cookie", cookie);

    expect(keyResponse.status).toBe(201);
    expect(typeof keyResponse.body.key).toBe("string");
    expect(keyResponse.body.key.length).toBeGreaterThan(20);

    const dbRow = await pool.query("SELECT key_hash FROM api_keys WHERE id = $1", [
      keyResponse.body.id,
    ]);
    expect(dbRow.rows[0].key_hash).not.toBe(keyResponse.body.key);
  });

  it("revokes an API key and rejects revoking it again", async () => {
    const cookie = await registerAndLogin();
    const createResponse = await request(app)
      .post("/projects")
      .set("Cookie", cookie)
      .send({ name: "demo" });
    const projectId = createResponse.body.id;
    const keyResponse = await request(app)
      .post(`/projects/${projectId}/api-keys`)
      .set("Cookie", cookie);
    const keyId = keyResponse.body.id;

    const revokeResponse = await request(app)
      .delete(`/projects/${projectId}/api-keys/${keyId}`)
      .set("Cookie", cookie);
    expect(revokeResponse.status).toBe(200);

    const secondRevoke = await request(app)
      .delete(`/projects/${projectId}/api-keys/${keyId}`)
      .set("Cookie", cookie);
    expect(secondRevoke.status).toBe(404);
  });
});

describe("database failures", () => {
  it("returns 500 and keeps serving when the database rejects", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    const cookie = await registerAndLogin();
    const brokenApp = createApp({
      query: () => Promise.reject(new Error("boom")),
    } as unknown as Pool);
    const id = "00000000-0000-0000-0000-000000000000";

    const responses = [
      await request(brokenApp).post("/projects").set("Cookie", cookie).send({ name: "demo" }),
      await request(brokenApp).get("/projects").set("Cookie", cookie),
      await request(brokenApp).post(`/projects/${id}/api-keys`).set("Cookie", cookie),
      await request(brokenApp).delete(`/projects/${id}/api-keys/${id}`).set("Cookie", cookie),
    ];
    for (const response of responses) {
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: "internal" });
    }

    // The process (and app) must still answer requests after the failures.
    const after = await request(brokenApp).get("/projects");
    await new Promise((resolve) => setImmediate(resolve));
    process.off("unhandledRejection", onUnhandled);
    expect(after.status).toBe(401);
    expect(unhandled).toEqual([]);
  });
});
