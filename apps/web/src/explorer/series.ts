import type { TimeseriesBucket } from "../api/client.ts";

const MINUTE_MS = 60_000;

export interface FilledSeries {
  /** Minute start times, in epoch seconds (what uPlot expects on a time axis). */
  xs: number[];
  /** Event count for each minute; 0 where the server returned no bucket. */
  ys: number[];
  total: number;
  peak: number;
}

/**
 * The server only returns minutes that have events. A chart needs every minute in the
 * range (otherwise quiet periods vanish and bars look adjacent), so fill the gaps with 0.
 * `to` is exclusive, like everywhere else in the API.
 */
export function fillMinutes(buckets: TimeseriesBucket[], from: string, to: string): FilledSeries {
  const first = Math.floor(Date.parse(from) / MINUTE_MS);
  const last = Math.floor((Date.parse(to) - 1) / MINUTE_MS);
  const counts = new Map<number, number>();
  for (const bucket of buckets) {
    counts.set(Math.floor(Date.parse(bucket.t) / MINUTE_MS), bucket.count);
  }
  const xs: number[] = [];
  const ys: number[] = [];
  let total = 0;
  let peak = 0;
  // The server caps the range at 24 hours; the extra guard keeps a bad response from
  // making the browser build an enormous array.
  for (let minute = first; minute <= last && xs.length <= 2000; minute++) {
    const count = counts.get(minute) ?? 0;
    xs.push(minute * 60);
    ys.push(count);
    total += count;
    peak = Math.max(peak, count);
  }
  return { xs, ys, total, peak };
}
