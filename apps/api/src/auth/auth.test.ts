import "../env.js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { createPool } from "../db.js";

const pool = createPool();
const app = createApp(pool);

async function uniqueEmail(): Promise<string> {
  return `test-${Math.random().toString(36).slice(2)}@example.com`;
}

beforeEach(async () => {
  await pool.query("TRUNCATE users CASCADE");
});

afterAll(async () => {
  await pool.end();
});

describe("auth flow", () => {
  it("registers a new user", async () => {
    const email = await uniqueEmail();
    const response = await request(app).post("/auth/register").send({ email, password: "password123" });

    expect(response.status).toBe(201);
    expect(response.body.email).toBe(email);
  });

  it("rejects a duplicate email with 409", async () => {
    const email = await uniqueEmail();
    await request(app).post("/auth/register").send({ email, password: "password123" });

    const response = await request(app).post("/auth/register").send({ email, password: "password123" });

    expect(response.status).toBe(409);
  });

  it("rejects login with the wrong password with 401", async () => {
    const email = await uniqueEmail();
    await request(app).post("/auth/register").send({ email, password: "password123" });

    const response = await request(app).post("/auth/login").send({ email, password: "wrong-password" });

    expect(response.status).toBe(401);
  });

  it("logs in with the correct password, sets a cookie, and allows access to a protected route", async () => {
    const email = await uniqueEmail();
    await request(app).post("/auth/register").send({ email, password: "password123" });

    const loginResponse = await request(app).post("/auth/login").send({ email, password: "password123" });

    expect(loginResponse.status).toBe(200);
    const cookieHeader = loginResponse.headers["set-cookie"];
    expect(cookieHeader).toBeDefined();
    expect(cookieHeader[0]).toMatch(/HttpOnly/);

    const meResponse = await request(app).get("/me").set("Cookie", cookieHeader);
    expect(meResponse.status).toBe(200);
  });

  it("rejects the protected route without a cookie", async () => {
    const response = await request(app).get("/me");
    expect(response.status).toBe(401);
  });

  it("logs out and clears the cookie", async () => {
    const email = await uniqueEmail();
    await request(app).post("/auth/register").send({ email, password: "password123" });
    const loginResponse = await request(app).post("/auth/login").send({ email, password: "password123" });
    const cookieHeader = loginResponse.headers["set-cookie"];

    const logoutResponse = await request(app).post("/auth/logout").set("Cookie", cookieHeader);

    expect(logoutResponse.status).toBe(200);
    expect(logoutResponse.headers["set-cookie"][0]).toMatch(/token=;/);
  });
});
