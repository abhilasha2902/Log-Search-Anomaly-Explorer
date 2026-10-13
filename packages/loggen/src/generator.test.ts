import { describe, expect, it } from "vitest";
import { generate } from "./generator.js";

describe("generate", () => {
  it("produces byte-identical output for the same seed", () => {
    const first = generate({ seed: 42, count: 500 });
    const second = generate({ seed: 42, count: 500 });

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("produces different output for a different seed", () => {
    const first = generate({ seed: 1, count: 500 });
    const second = generate({ seed: 2, count: 500 });

    expect(JSON.stringify(first)).not.toBe(JSON.stringify(second));
  });

  it("produces exactly the requested number of events and ground-truth lines", () => {
    const { events, groundTruth } = generate({ seed: 7, count: 1000 });

    expect(events).toHaveLength(1000);
    expect(groundTruth.events).toHaveLength(1000);
  });

  it("includes all three incidents in the ground truth with their documented causes", () => {
    const { groundTruth } = generate({ seed: 7, count: 2000 });

    const causes = groundTruth.incidents.map((incident) => incident.cause);
    expect(causes).toEqual(
      expect.arrayContaining(["slow_database", "bad_deploy", "downstream_timeout_burst"]),
    );
  });

  it("emits the bad-deploy template only during its incident window", () => {
    const { events, groundTruth } = generate({ seed: 7, count: 5000 });
    const badDeployIncident = groundTruth.incidents.find((i) => i.cause === "bad_deploy")!;

    const badDeployLines = groundTruth.events.filter((e) => e.templateId === "api_error_null_pointer");
    expect(badDeployLines.length).toBeGreaterThan(0);

    for (const line of badDeployLines) {
      const ts = events[line.line].ts;
      expect(ts >= badDeployIncident.startTs && ts < badDeployIncident.endTs).toBe(true);
    }
  });

  it("elevates db query duration during the slow-database incident", () => {
    const { events, groundTruth } = generate({ seed: 7, count: 5000 });
    const slowDbIncident = groundTruth.incidents.find((i) => i.cause === "slow_database")!;

    const duringIncident = events.filter(
      (e) => e.service === "db" && e.ts >= slowDbIncident.startTs && e.ts < slowDbIncident.endTs,
    );
    expect(duringIncident.length).toBeGreaterThan(0);
    for (const event of duringIncident) {
      expect(Number(event.attrs.duration_ms)).toBeGreaterThanOrEqual(500);
    }
  });
});
