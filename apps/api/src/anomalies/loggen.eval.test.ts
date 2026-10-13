import "../env.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { generate, type GroundTruth } from "@log-explorer/loggen";
import { createApp } from "../app.js";
import { createPool } from "../db.js";
import { loadDetectorConfig } from "../detector/config.js";
import { detectProject } from "../detector/detect.js";

/**
 * End-to-end check of the detector against loggen's ground truth: ingest a generated run
 * (templates + per-minute counts are built by the real ingest path), then replay the clock one
 * minute at a time, calling the detector exactly as the worker would, and compare what it
 * found with the incidents loggen injected.
 */

const pool = createPool();
const app = createApp(pool);
const config = loadDetectorConfig({}); // default thresholds: nothing here is tuned for the test

// Override to try other runs: $env:EVAL_SEED=7; npm test -w apps/api -- src/anomalies
const SEED = Number(process.env.EVAL_SEED ?? 42);
const COUNT = 6000; // 60 simulated minutes, about 100 events per minute
const START = new Date("2026-01-01T00:00:00.000Z");
// How long after an incident ends an anomaly may still be attributed to it (the detector judges
// the last complete minute, so it reports up to a minute late).
const SLACK_MS = 2 * 60_000;

interface Found {
  type: string;
  service: string;
  template: string;
  score: number;
  windowStart: number;
  windowEnd: number;
  detectedAt: number;
}

let groundTruth: GroundTruth;
let found: Found[] = [];

beforeAll(async () => {
  await pool.query("TRUNCATE users CASCADE");
  const email = `eval-${Math.random().toString(36).slice(2)}@example.com`;
  await request(app).post("/auth/register").send({ email, password: "password123" });
  const login = await request(app).post("/auth/login").send({ email, password: "password123" });
  const cookie = [login.headers["set-cookie"]].flat() as string[];
  const project = await request(app).post("/projects").set("Cookie", cookie).send({ name: "eval" });
  const projectId = project.body.id as string;
  const key = await request(app).post(`/projects/${projectId}/api-keys`).set("Cookie", cookie);

  const generated = generate({ seed: SEED, count: COUNT, startTime: START });
  groundTruth = generated.groundTruth;
  for (let i = 0; i < generated.events.length; i += 500) {
    const response = await request(app)
      .post("/ingest")
      .set("x-api-key", key.body.key as string)
      .send(generated.events.slice(i, i + 500));
    expect(response.status).toBe(200);
  }

  // Replay: one detector run per simulated minute, from the end of minute 1 to 3 minutes past the end.
  for (let minute = 1; minute <= 63; minute++) {
    await detectProject(
      pool,
      projectId,
      new Date(START.getTime() + minute * 60_000 + 5_000),
      config,
    );
  }

  const rows = await pool.query<{
    type: string;
    service: string;
    template: string;
    score: number;
    window_start: Date;
    window_end: Date;
    detected_at: Date;
  }>(
    `SELECT a.type, t.service, t.template, a.score, a.window_start, a.window_end, a.detected_at
     FROM anomalies a JOIN log_templates t ON t.id = a.template_id
     WHERE a.project_id = $1 ORDER BY a.window_start`,
    [projectId],
  );
  found = rows.rows.map((row) => ({
    type: row.type,
    service: row.service,
    template: row.template,
    score: row.score,
    windowStart: row.window_start.getTime(),
    windowEnd: row.window_end.getTime(),
    detectedAt: row.detected_at.getTime(),
  }));
}, 120_000);

afterAll(async () => {
  if (process.env.EVAL_VERBOSE) {
    const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
    const lines = found.map((a) =>
      [
        a.type.padEnd(12),
        a.service.padEnd(9),
        `z=${a.score.toFixed(1)}`.padEnd(8),
        `${hhmm(a.windowStart)}-${hhmm(a.windowEnd)}`,
        `detected ${new Date(a.detectedAt).toISOString().slice(11, 19)}`,
        a.template,
      ].join("  "),
    );
    process.stderr.write(["", `SEED ${SEED}`, ...lines, ""].join("\n"));
  }
  await pool.query("TRUNCATE users CASCADE");
  await pool.end();
});

const EXPECTED = {
  slow_database: { type: "rate_spike", template: "slow query detected" },
  bad_deploy: { type: "new_template", template: "NullPointerException in handler /orders/<*>" },
  downstream_timeout_burst: {
    type: "rate_spike",
    template: "timeout calling downstream payment processor",
  },
} as const;

function matches(anomaly: Found, incident: GroundTruth["incidents"][number]): boolean {
  const expected = EXPECTED[incident.cause];
  return (
    anomaly.type === expected.type &&
    anomaly.service === incident.service &&
    anomaly.template === expected.template &&
    anomaly.windowStart >= Date.parse(incident.startTs) - 60_000 &&
    anomaly.windowStart < Date.parse(incident.endTs) + SLACK_MS
  );
}

describe("detector vs loggen ground truth", () => {
  it("finds each injected incident in its window", () => {
    for (const incident of groundTruth.incidents) {
      const hit = found.find((anomaly) => matches(anomaly, incident));
      expect(hit, `${incident.cause} (${incident.startTs}) was not detected`).toBeDefined();
    }
  });

  it("detects each incident within two minutes of it starting", () => {
    for (const incident of groundTruth.incidents) {
      const hit = found.find((anomaly) => matches(anomaly, incident))!;
      const delayMs = hit.detectedAt - Date.parse(incident.startTs);
      expect(delayMs, `${incident.cause} detected after ${delayMs} ms`).toBeLessThanOrEqual(
        2 * 60_000 + 10_000,
      );
    }
  });

  it("raises no anomaly that does not belong to an injected incident", () => {
    const unexplained = found.filter(
      (anomaly) => !groundTruth.incidents.some((incident) => matches(anomaly, incident)),
    );
    expect(
      unexplained.map(
        (a) => `${a.type} ${a.service} "${a.template}" at ${new Date(a.windowStart).toISOString()}`,
      ),
    ).toEqual([]);
  });

  it("keeps each incident to a single anomaly per template (ongoing spikes are merged)", () => {
    const spikes = found.filter((a) => a.type === "rate_spike");
    const keys = spikes.map((a) => `${a.service}|${a.template}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
