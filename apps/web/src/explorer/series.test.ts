import { describe, expect, it } from "vitest";
import { fillMinutes } from "./series.ts";

describe("fillMinutes", () => {
  it("fills quiet minutes with zero and counts from the first to the last minute", () => {
    const result = fillMinutes(
      [
        { t: "2024-05-01T10:01:00Z", count: 3 },
        { t: "2024-05-01T10:04:00Z", count: 5 },
      ],
      "2024-05-01T10:00:00.000Z",
      "2024-05-01T10:05:00.000Z",
    );
    const start = Date.parse("2024-05-01T10:00:00Z") / 1000;
    expect(result.xs).toEqual([0, 1, 2, 3, 4].map((m) => start + m * 60));
    expect(result.ys).toEqual([0, 3, 0, 0, 5]);
    expect(result.total).toBe(8);
    expect(result.peak).toBe(5);
  });

  it("includes the partial first and last minutes and treats `to` as exclusive", () => {
    const result = fillMinutes(
      [{ t: "2024-05-01T10:02:00Z", count: 1 }],
      "2024-05-01T10:00:30.000Z",
      "2024-05-01T10:02:10.000Z",
    );
    expect(result.ys).toEqual([0, 0, 1]); // 10:00, 10:01, 10:02
    expect(fillMinutes([], "2024-05-01T10:00:00.000Z", "2024-05-01T10:01:00.000Z").ys).toEqual([0]);
  });

  it("returns an empty series for an empty range", () => {
    const result = fillMinutes([], "2024-05-01T10:00:00.000Z", "2024-05-01T10:00:00.000Z");
    expect(result).toEqual({ xs: [], ys: [], total: 0, peak: 0 });
  });

  it("never builds an unbounded array", () => {
    const result = fillMinutes([], "2024-01-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z");
    expect(result.xs.length).toBeLessThanOrEqual(2001);
  });
});
