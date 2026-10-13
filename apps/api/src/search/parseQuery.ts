import { parseTime } from "./parseTime.js";
import {
  LEVELS,
  MAX_QUERY_LENGTH,
  MAX_SERVICE_LENGTH,
  MAX_TOKENS,
  QueryError,
  type Level,
  type ParseOptions,
  type ParsedQuery,
} from "./types.js";

const FILTER_KEYS = new Set(["level", "service", "from", "to"]);
type FilterKey = "level" | "service" | "from" | "to";

export type Token =
  | { kind: "word"; text: string; negated: boolean }
  | { kind: "phrase"; text: string; negated: boolean }
  | { kind: "filter"; key: FilterKey; value: string; negated: boolean };

const WHITESPACE = /\s/;
// A token with no letter or digit (e.g. "-", "!!!", '""') has nothing to search for.
const HAS_SEARCHABLE_CHAR = /[\p{L}\p{N}]/u;

export function assertNoNul(value: string, what: string): void {
  if (value.includes("\u0000")) {
    throw new QueryError(`${what} contains an invalid character`);
  }
}

/** Splits a query string into words, "quoted phrases", -negations and key:value filters. */
export function tokenize(q: string): Token[] {
  if (q.length > MAX_QUERY_LENGTH) {
    throw new QueryError(`query is longer than ${MAX_QUERY_LENGTH} characters`);
  }
  assertNoNul(q, "query");

  const tokens: Token[] = [];
  const push = (token: Token) => {
    if (tokens.length >= MAX_TOKENS) {
      throw new QueryError(`query has more than ${MAX_TOKENS} terms`);
    }
    tokens.push(token);
  };

  let i = 0;
  while (i < q.length) {
    if (WHITESPACE.test(q[i])) {
      i++;
      continue;
    }
    let negated = false;
    if (q[i] === "-" && i + 1 < q.length && !WHITESPACE.test(q[i + 1])) {
      negated = true;
      i++;
    }
    if (q[i] === '"') {
      const end = q.indexOf('"', i + 1);
      const text = (end === -1 ? q.slice(i + 1) : q.slice(i + 1, end)).trim();
      i = end === -1 ? q.length : end + 1;
      push({ kind: "phrase", text, negated });
      continue;
    }
    let j = i;
    while (j < q.length && !WHITESPACE.test(q[j])) j++;
    const raw = q.slice(i, j);
    i = j;

    const colon = raw.indexOf(":");
    if (colon > 0) {
      const key = raw.slice(0, colon).toLowerCase();
      if (FILTER_KEYS.has(key)) {
        push({ kind: "filter", key: key as FilterKey, value: raw.slice(colon + 1), negated });
        continue;
      }
    }
    push({ kind: "word", text: raw, negated });
  }
  return tokens;
}

function parseLevel(value: string): Level {
  const lower = value.toLowerCase();
  if (!(LEVELS as readonly string[]).includes(lower)) {
    throw new QueryError(`level must be one of ${LEVELS.join(", ")}`);
  }
  return lower as Level;
}

function checkService(value: string): string {
  if (value.length > MAX_SERVICE_LENGTH) {
    throw new QueryError(`service is longer than ${MAX_SERVICE_LENGTH} characters`);
  }
  assertNoNul(value, "service");
  return value;
}

/**
 * Turns a search string (plus optional explicit filters) into SQL conditions.
 *
 * Safety property: every string in `where` is assembled only from constant text and
 * `$n` placeholders. Anything the user typed lives in `params` and reaches Postgres
 * as a bound value, never as SQL text.
 */
export function parseQuery(q: string, options: ParseOptions): ParsedQuery {
  const where: string[] = [];
  const params: unknown[] = [];
  let next = options.startParam ?? 1;
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${next++}`;
  };

  const levels: Level[] = [];
  const services: string[] = [];
  const bounds: { from: Date | null; to: Date | null } = { from: null, to: null };

  const applyFrom = (value: string) => {
    const date = parseTime(value, options.now, options.maxRangeMs);
    if (bounds.from === null || date > bounds.from) bounds.from = date; // several lower bounds: the strictest wins
  };
  const applyTo = (value: string) => {
    const date = parseTime(value, options.now, options.maxRangeMs);
    if (bounds.to === null || date < bounds.to) bounds.to = date;
  };

  for (const token of tokenize(q)) {
    if (token.kind === "filter") {
      if (token.negated) {
        throw new QueryError(`negating ${token.key}: is not supported`);
      }
      if (token.value === "") continue; // still typing, e.g. "level:"
      if (token.key === "level") levels.push(parseLevel(token.value));
      else if (token.key === "service") services.push(checkService(token.value));
      else if (token.key === "from") applyFrom(token.value);
      else applyTo(token.value);
      continue;
    }
    if (!HAS_SEARCHABLE_CHAR.test(token.text)) continue;
    const fn = token.kind === "phrase" ? "phraseto_tsquery" : "plainto_tsquery";
    const match = `search_vector @@ ${fn}('simple', ${bind(token.text)})`;
    where.push(token.negated ? `NOT (${match})` : match);
  }

  if (levels.length > 0) {
    where.push(`level = ANY(${bind([...new Set(levels)])}::text[])`);
  }
  if (services.length > 0) {
    where.push(`service = ANY(${bind([...new Set(services)])}::text[])`);
  }

  // Explicit URL params are AND-ed with the q tokens.
  if (options.level) where.push(`level = ${bind(parseLevel(options.level))}`);
  if (options.service) where.push(`service = ${bind(checkService(options.service))}`);
  if (options.from) applyFrom(options.from);
  if (options.to) applyTo(options.to);

  const { from, to } = bounds;
  if (from !== null && to !== null) {
    const span = to.getTime() - from.getTime();
    if (span <= 0) throw new QueryError("from must be earlier than to");
    if (span > options.maxRangeMs)
      throw new QueryError("time range is larger than the allowed range");
  }
  if (from !== null) where.push(`ts >= ${bind(from.toISOString())}::timestamptz`);
  if (to !== null) where.push(`ts < ${bind(to.toISOString())}::timestamptz`);

  return {
    where,
    params,
    filters: { levels: [...new Set(levels)], services: [...new Set(services)], from, to },
  };
}
