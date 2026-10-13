import { describe, expect, it } from "vitest";
import { evaluateSpike } from "./ewma.js";

const options = { alpha: 0.2, zThreshold: 4, minCount: 10, minHistory: 10 };
const steady = (value: number, n: number) => Array<number>(n).fill(value);

describe("evaluateSpike", () => {
  it("does not flag a normal minute in a steady series", () => {
    const result = evaluateSpike(steady(20, 30), 22, options);
    expect(result.isSpike).toBe(false);
    expect(result.baseline).toBeCloseTo(20);
  });

  it("flags a big jump above a steady baseline", () => {
    const result = evaluateSpike(steady(20, 30), 90, options);
    expect(result.isSpike).toBe(true);
    expect(result.z).toBeGreaterThan(10);
  });

  it("uses the Poisson floor so a perfectly flat history is not hyper-sensitive", () => {
    // Variance of a constant series is 0, but counts of 20 naturally wobble by about sqrt(20).
    const result = evaluateSpike(steady(20, 30), 26, options);
    expect(result.std).toBeCloseTo(Math.sqrt(20));
    expect(result.isSpike).toBe(false);
  });

  it("ignores spikes below the minimum count however unusual they look", () => {
    const result = evaluateSpike(steady(1, 30), 8, options);
    expect(result.z).toBeGreaterThan(options.zThreshold);
    expect(result.isSpike).toBe(false);
  });

  it("needs enough history before judging", () => {
    expect(evaluateSpike(steady(20, 5), 90, options).isSpike).toBe(false);
    expect(evaluateSpike(steady(20, 10), 90, options).isSpike).toBe(true);
  });

  it("returns a non-spike for an empty history", () => {
    expect(evaluateSpike([], 100, options).isSpike).toBe(false);
  });

  it("keeps flagging during a long incident because spike minutes are clipped in the baseline", () => {
    const history = [...steady(20, 30)];
    for (let minute = 0; minute < 15; minute++) {
      const result = evaluateSpike(history, 90, options);
      expect(result.isSpike, `minute ${minute} of the incident`).toBe(true);
      history.push(90);
    }
  });

  it("adapts to a modest step change instead of alerting forever", () => {
    // 32 vs a baseline of 20 is under the threshold, so it is absorbed into the baseline.
    const history = steady(20, 30);
    for (let minute = 0; minute < 40; minute++) history.push(32);
    expect(evaluateSpike(history, 32, options).isSpike).toBe(false);
  });

  it("a higher threshold flags less", () => {
    const history = steady(20, 30);
    expect(evaluateSpike(history, 45, { ...options, zThreshold: 3 }).isSpike).toBe(true);
    expect(evaluateSpike(history, 45, { ...options, zThreshold: 8 }).isSpike).toBe(false);
  });
});
