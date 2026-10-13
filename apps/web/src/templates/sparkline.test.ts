import { describe, expect, it } from "vitest";
import { sparklinePoints } from "./sparkline.ts";

describe("sparklinePoints", () => {
  it("scales the peak to the top and zero to the bottom", () => {
    expect(sparklinePoints([0, 5, 10], 100, 20)).toBe("0.0,20.0 50.0,10.0 100.0,0.0");
  });

  it("draws a flat line at the bottom for all zeros", () => {
    expect(sparklinePoints([0, 0], 10, 10)).toBe("0.0,10.0 10.0,10.0");
  });

  it("handles empty and single-point series", () => {
    expect(sparklinePoints([], 10, 10)).toBe("");
    expect(sparklinePoints([3], 10, 10)).toBe("0.0,0.0");
  });
});
