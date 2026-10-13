import { QueryError } from "./types.js";

const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

const RELATIVE = /^(\d{1,9})([smhd])$/;
// 2024-05-01, 2024-05-01T12:30, 2024-05-01T12:30:15, 2024-05-01T12:30:15.123, optional Z / +05:30
const ISO =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * Turns a user time value into an absolute UTC Date.
 * Accepts relative values (15m, 2h, 7d, 30s: "that long before now") and ISO-8601
 * dates/timestamps. Values without an offset are interpreted as UTC.
 */
export function parseTime(value: string, now: Date, maxRangeMs: number): Date {
  const relative = RELATIVE.exec(value);
  if (relative) {
    const offset = Number(relative[1]) * UNIT_MS[relative[2] as keyof typeof UNIT_MS];
    if (offset > maxRangeMs) {
      throw new QueryError(`relative time "${value}" is larger than the allowed range`);
    }
    return new Date(now.getTime() - offset);
  }

  const iso = ISO.exec(value);
  if (!iso) {
    throw new QueryError(`invalid time value "${value.slice(0, 40)}"`);
  }
  const [, y, mo, d, h = "0", mi = "0", s = "0", ms = "0", zone] = iso;
  const parts = [Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)] as const;
  const millis = Number(ms.padEnd(3, "0"));
  const utc = Date.UTC(...parts, millis);
  const check = new Date(utc);
  // Date.UTC silently rolls 2024-02-30 over to March; reject instead.
  if (
    check.getUTCFullYear() !== parts[0] ||
    check.getUTCMonth() !== parts[1] ||
    check.getUTCDate() !== parts[2] ||
    check.getUTCHours() !== parts[3] ||
    check.getUTCMinutes() !== parts[4] ||
    check.getUTCSeconds() !== parts[5]
  ) {
    throw new QueryError(`invalid time value "${value}"`);
  }
  let result = utc;
  if (zone && zone !== "Z") {
    const sign = zone[0] === "-" ? -1 : 1;
    const offsetHours = Number(zone.slice(1, 3));
    const offsetMins = Number(zone.slice(4, 6));
    if (offsetHours > 23 || offsetMins > 59) {
      throw new QueryError(`invalid time zone offset in "${value}"`);
    }
    const offsetMinutes = offsetHours * 60 + offsetMins;
    result = utc - sign * offsetMinutes * 60_000;
  }
  return new Date(result);
}
