import "./env.js";
import http from "node:http";
import os from "node:os";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import autocannon from "autocannon";
import { generate } from "@log-explorer/loggen";
import { createApp } from "./app.js";
import { createPool } from "./db.js";

// The limiter exists to throttle abusive clients; here it would just measure 429s.
process.env.INGEST_RATE_LIMIT_MAX = "100000000";

async function main() {
  const pool = createPool();
  const app = createApp(pool);
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to determine load test server port");
  }
  const baseUrl = `http://localhost:${address.port}`;

  const email = `loadtest-${Date.now()}@example.com`;
  const password = "password123";
  await fetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const loginResponse = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const cookie = loginResponse.headers.get("set-cookie") ?? "";

  const projectResponse = await fetch(`${baseUrl}/projects`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ name: "loadtest" }),
  });
  const project = (await projectResponse.json()) as { id: string };

  const keyResponse = await fetch(`${baseUrl}/projects/${project.id}/api-keys`, {
    method: "POST",
    headers: { cookie },
  });
  const { key } = (await keyResponse.json()) as { key: string };

  const { events } = generate({ seed: 1, count: 500 });
  const batch = JSON.stringify(events.slice(0, 500));

  console.log(`Running autocannon against ${baseUrl}/ingest for 10s...`);
  const result = await autocannon({
    url: `${baseUrl}/ingest`,
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: batch,
    duration: 10,
    connections: 10,
  });

  const summary = autocannon.printResult(result);
  console.log(summary);

  if (result["2xx"] === 0 || result.non2xx > 0) {
    throw new Error(`load test saw ${result.non2xx} non-2xx responses; numbers are not valid`);
  }

  const cpu = os.cpus();
  const doc = [
    "# Performance",
    "",
    "Machine-specific measurement of `POST /ingest`; not a general benchmark.",
    "API and Postgres (Docker) share this machine with the load generator.",
    "",
    `- CPU: ${cpu[0]?.model.trim()} (${cpu.length} logical cores)`,
    `- RAM: ${(os.totalmem() / 1024 ** 3).toFixed(1)} GiB`,
    `- OS: ${os.type()} ${os.release()}, Node ${process.version}`,
    `- Run at: ${new Date().toISOString()}`,
    "- Command: `npm run loadtest -w apps/api` (10 connections, 10s, 500 events per request)",
    "",
    "```",
    summary.trim(),
    "```",
    "",
  ].join("\n");
  const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
  writeFileSync(path.join(repoRoot, "docs", "performance.md"), doc);

  // autocannon stops mid-request; let handlers already past the parser finish their insert.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  // Drop in-flight requests before ending the pool so none query a closed pool.
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
  await pool.end();

  return result;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
