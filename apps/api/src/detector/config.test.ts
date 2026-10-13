import { describe, expect, it } from "vitest";
import { loadDetectorConfig } from "./config.js";

describe("loadDetectorConfig", () => {
  it("uses the documented defaults", () => {
    expect(loadDetectorConfig({})).toEqual({
      newTemplateWindowMinutes: 10,
      serviceWarmupMinutes: 10,
      rateEwmaAlpha: 0.2,
      rateZThreshold: 4,
      rateMinCount: 10,
      rateMinHistoryMinutes: 10,
      rateLookbackMinutes: 120,
      spikeMergeGapMinutes: 2,
      workerIntervalMs: 60_000,
    });
  });

  it("reads overrides from the environment and treats blanks as unset", () => {
    const config = loadDetectorConfig({
      RATE_Z_THRESHOLD: "6.5",
      RATE_MIN_COUNT: "25",
      WORKER_INTERVAL_MS: "",
      SPIKE_MERGE_GAP_MINUTES: "0",
    });
    expect(config.rateZThreshold).toBe(6.5);
    expect(config.rateMinCount).toBe(25);
    expect(config.workerIntervalMs).toBe(60_000);
    expect(config.spikeMergeGapMinutes).toBe(0);
  });

  it("rejects invalid values and names the variable", () => {
    expect(() => loadDetectorConfig({ RATE_EWMA_ALPHA: "1.5" })).toThrow(/RATE_EWMA_ALPHA/);
    expect(() => loadDetectorConfig({ RATE_MIN_COUNT: "abc" })).toThrow(/RATE_MIN_COUNT/);
    expect(() => loadDetectorConfig({ WORKER_INTERVAL_MS: "-5" })).toThrow(/WORKER_INTERVAL_MS/);
  });
});
