import "./env.js";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Pool } from "pg";
import { createApp } from "./app.js";
import { createPool } from "./db.js";

describe("GET /health", () => {
  const pool = createPool();
  const app = createApp(pool);

  afterAll(async () => {
    await pool.end();
  });

  it("returns 200 with db: ok when the database is reachable", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", db: "ok" });
  });

  it("returns 503 when the database is unreachable", async () => {
    const unreachablePool = new Pool({
      connectionString: "postgres://loguser:logpass@localhost:5999/logexplorer",
      connectionTimeoutMillis: 500,
    });
    const unreachableApp = createApp(unreachablePool);

    const response = await request(unreachableApp).get("/health");

    expect(response.status).toBe(503);
    expect(response.body.status).toBe("error");
    expect(response.body.db).toBe("unreachable");

    await unreachablePool.end();
  });
});
