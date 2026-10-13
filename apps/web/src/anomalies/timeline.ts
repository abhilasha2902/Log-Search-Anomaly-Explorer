import type { AnomalyItem } from "../api/client.ts";

export interface TimelineMark {
  id: string;
  lane: number;
  /** Left edge and width in the same units as the `width` passed to `layoutTimeline`. */
  x: number;
  width: number;
}

export interface TimelineLayout {
  lanes: string[];
  startMs: number;
  endMs: number;
  marks: TimelineMark[];
}

export const MIN_MARK_WIDTH = 6;
const FALLBACK_SPAN_MS = 60_000;

/** One lane per service; each anomaly is a bar from its window start to its window end. */
export function layoutTimeline(items: AnomalyItem[], width: number): TimelineLayout {
  const lanes = [...new Set(items.map((item) => item.template.service))].sort();
  if (items.length === 0) return { lanes, startMs: 0, endMs: 0, marks: [] };

  const startMs = Math.min(...items.map((item) => Date.parse(item.windowStart)));
  const endMs = Math.max(...items.map((item) => Date.parse(item.windowEnd)));
  const span = Math.max(endMs - startMs, FALLBACK_SPAN_MS);

  const marks = items.map((item) => {
    const from = Date.parse(item.windowStart);
    const to = Date.parse(item.windowEnd);
    const markWidth = Math.max(((to - from) / span) * width, MIN_MARK_WIDTH);
    const x = Math.min(((from - startMs) / span) * width, width - markWidth);
    return { id: item.id, lane: lanes.indexOf(item.template.service), x, width: markWidth };
  });
  return { lanes, startMs, endMs: startMs + span, marks };
}
