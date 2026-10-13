import { describe, expect, it } from "vitest";
import type { AnomalyItem } from "../api/client.ts";
import { MIN_MARK_WIDTH, layoutTimeline } from "./timeline.ts";

function item(id: string, service: string, start: string, end: string): AnomalyItem {
  return {
    id,
    type: "rate_spike",
    severity: "high",
    score: 12,
    detectedAt: end,
    windowStart: start,
    windowEnd: end,
    template: { id: "t" + id, service, template: "x" },
  };
}

describe("layoutTimeline", () => {
  it("gives each service a lane and places bars proportionally", () => {
    const layout = layoutTimeline(
      [
        item("1", "db", "2024-05-01T10:00:00Z", "2024-05-01T10:10:00Z"),
        item("2", "api", "2024-05-01T10:30:00Z", "2024-05-01T10:40:00Z"),
      ],
      400,
    );
    expect(layout.lanes).toEqual(["api", "db"]);
    const [db, api] = layout.marks;
    expect(db).toMatchObject({ lane: 1, x: 0 });
    expect(db.width).toBeCloseTo(100); // 10 of 40 minutes
    expect(api.lane).toBe(0);
    expect(api.x).toBeCloseTo(300);
  });

  it("keeps very short anomalies visible and inside the plot", () => {
    const layout = layoutTimeline(
      [
        item("1", "api", "2024-05-01T10:00:00Z", "2024-05-01T10:01:00Z"),
        item("2", "api", "2024-05-01T12:00:00Z", "2024-05-01T12:01:00Z"),
      ],
      400,
    );
    for (const mark of layout.marks) {
      expect(mark.width).toBeGreaterThanOrEqual(MIN_MARK_WIDTH);
      expect(mark.x + mark.width).toBeLessThanOrEqual(400);
    }
  });

  it("handles a single anomaly and an empty list", () => {
    const one = layoutTimeline(
      [item("1", "api", "2024-05-01T10:00:00Z", "2024-05-01T10:01:00Z")],
      400,
    );
    expect(one.marks).toHaveLength(1);
    expect(layoutTimeline([], 400)).toMatchObject({ lanes: [], marks: [] });
  });
});
