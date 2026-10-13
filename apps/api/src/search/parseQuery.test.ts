import { describe, expect, it } from "vitest";
import { parseQuery, tokenize } from "./parseQuery.js";
import { parseTime } from "./parseTime.js";
import { QueryError, type ParseOptions } from "./types.js";

const NOW = new Date("2024-05-10T12:00:00.000Z");
const DAY = 86_400_000;
const opts: ParseOptions = { now: NOW, maxRangeMs: 30 * DAY };

describe("tokenize", () => {
  it("splits words, phrases, negations and filters", () => {
    expect(tokenize('level:error service:api "disk full" -noise timeout')).toEqual([
      { kind: "filter", key: "level", value: "error", negated: false },
      { kind: "filter", key: "service", value: "api", negated: false },
      { kind: "phrase", text: "disk full", negated: false },
      { kind: "word", text: "noise", negated: true },
      { kind: "word", text: "timeout", negated: false },
    ]);
  });

  it("supports negated phrases and treats an unterminated quote as a phrase", () => {
    expect(tokenize('-"health check"')).toEqual([
      { kind: "phrase", text: "health check", negated: true },
    ]);
    expect(tokenize('"never closed')).toEqual([
      { kind: "phrase", text: "never closed", negated: false },
    ]);
  });

  it("keeps a lone dash as a word and treats unknown keys as free text", () => {
    expect(tokenize("- error:500")).toEqual([
      { kind: "word", text: "-", negated: false },
      { kind: "word", text: "error:500", negated: false },
    ]);
  });

  it("rejects too many terms, overlong queries and NUL bytes", () => {
    expect(() => tokenize(Array(21).fill("a").join(" "))).toThrow(QueryError);
    expect(() => tokenize("a".repeat(501))).toThrow(QueryError);
    expect(() => tokenize("a\u0000b")).toThrow(QueryError);
  });
});

describe("parseQuery", () => {
  it("returns no conditions for an empty query", () => {
    expect(parseQuery("", opts)).toMatchObject({ where: [], params: [] });
  });

  it("turns free text into a bound tsquery", () => {
    const result = parseQuery("timeout", opts);
    expect(result.where).toEqual(["search_vector @@ plainto_tsquery('simple', $1)"]);
    expect(result.params).toEqual(["timeout"]);
  });

  it("uses phraseto_tsquery for phrases and NOT for negation", () => {
    const result = parseQuery('"disk full" -noise', opts);
    expect(result.where).toEqual([
      "search_vector @@ phraseto_tsquery('simple', $1)",
      "NOT (search_vector @@ plainto_tsquery('simple', $2))",
    ]);
    expect(result.params).toEqual(["disk full", "noise"]);
  });

  it("drops tokens that contain nothing searchable", () => {
    expect(parseQuery('- !!! ""', opts).where).toEqual([]);
  });

  it("OR-s repeated level and service tokens, case-insensitively for level", () => {
    const result = parseQuery("level:ERROR level:warn level:error service:api service:db", opts);
    expect(result.where).toEqual(["level = ANY($1::text[])", "service = ANY($2::text[])"]);
    expect(result.params).toEqual([
      ["error", "warn"],
      ["api", "db"],
    ]);
  });

  it("AND-s explicit level/service params with q tokens", () => {
    const result = parseQuery("level:error", { ...opts, level: "warn", service: "api" });
    expect(result.where).toEqual(["level = ANY($1::text[])", "level = $2", "service = $3"]);
    expect(result.params).toEqual([["error"], "warn", "api"]);
  });

  it("rejects an unknown level, a negated filter and an overlong service", () => {
    expect(() => parseQuery("level:fatal", opts)).toThrow(QueryError);
    expect(() => parseQuery("-level:error", opts)).toThrow(QueryError);
    expect(() => parseQuery(`service:${"a".repeat(101)}`, opts)).toThrow(QueryError);
    expect(() => parseQuery("", { ...opts, level: "nope" })).toThrow(QueryError);
  });

  it("ignores an empty filter value while the user is still typing", () => {
    expect(parseQuery("level:", opts).where).toEqual([]);
  });

  it("honours startParam", () => {
    const result = parseQuery("timeout level:error", { ...opts, startParam: 4 });
    expect(result.where).toEqual([
      "search_vector @@ plainto_tsquery('simple', $4)",
      "level = ANY($5::text[])",
    ]);
  });

  it("converts from/to to absolute UTC with from inclusive and to exclusive", () => {
    const result = parseQuery("from:2h to:1h", opts);
    expect(result.where).toEqual(["ts >= $1::timestamptz", "ts < $2::timestamptz"]);
    expect(result.params).toEqual(["2024-05-10T10:00:00.000Z", "2024-05-10T11:00:00.000Z"]);
  });

  it("combines token and explicit bounds using the strictest of each", () => {
    const result = parseQuery("from:3h", { ...opts, from: "1h", to: "2024-05-10T11:30:00Z" });
    expect(result.filters.from?.toISOString()).toBe("2024-05-10T11:00:00.000Z");
    expect(result.filters.to?.toISOString()).toBe("2024-05-10T11:30:00.000Z");
  });

  it("rejects from >= to and ranges over the cap", () => {
    expect(() => parseQuery("from:1h to:2h", opts)).toThrow(QueryError);
    expect(() => parseQuery("from:1h to:1h", opts)).toThrow(QueryError);
    expect(() => parseQuery("from:2024-01-01 to:2024-05-01", opts)).toThrow(QueryError);
  });
});

describe("parseTime", () => {
  const cap = 30 * DAY;

  it("parses relative values", () => {
    expect(parseTime("30s", NOW, cap).toISOString()).toBe("2024-05-10T11:59:30.000Z");
    expect(parseTime("15m", NOW, cap).toISOString()).toBe("2024-05-10T11:45:00.000Z");
    expect(parseTime("2h", NOW, cap).toISOString()).toBe("2024-05-10T10:00:00.000Z");
    expect(parseTime("7d", NOW, cap).toISOString()).toBe("2024-05-03T12:00:00.000Z");
    expect(parseTime("0m", NOW, cap).toISOString()).toBe(NOW.toISOString());
  });

  it("parses ISO dates and timestamps as UTC, honouring explicit offsets", () => {
    expect(parseTime("2024-05-01", NOW, cap).toISOString()).toBe("2024-05-01T00:00:00.000Z");
    expect(parseTime("2024-05-01T08:30", NOW, cap).toISOString()).toBe("2024-05-01T08:30:00.000Z");
    expect(parseTime("2024-05-01T08:30:15.5Z", NOW, cap).toISOString()).toBe(
      "2024-05-01T08:30:15.500Z",
    );
    expect(parseTime("2024-05-01T08:30:00+05:30", NOW, cap).toISOString()).toBe(
      "2024-05-01T03:00:00.000Z",
    );
    expect(parseTime("2024-05-01T08:30:00-02:00", NOW, cap).toISOString()).toBe(
      "2024-05-01T10:30:00.000Z",
    );
  });

  it.each([
    "",
    "abc",
    "-5m",
    "5",
    "5w",
    "1.5h",
    "31d",
    "99999d",
    "2024-13-45",
    "2024-02-30",
    "2024-05-01T25:00",
    "2024-05-01T08:30+99:99",
    "0050-01-01",
    "2024-05-01 08:30",
    "1d;DROP TABLE log_events",
    "1d' OR '1'='1",
    "now()",
    "2024-05-01T00:00:00Z'; --",
  ])("rejects %j", (value) => {
    expect(() => parseTime(value, NOW, cap)).toThrow(QueryError);
  });
});

describe("injection attempts", () => {
  const attacks = [
    "'; DROP TABLE log_events;--",
    '" OR 1=1 --',
    "level:error' OR '1'='1",
    "service:a);--",
    "service:'; DELETE FROM users;--",
    "from:1d;DROP TABLE users",
    "to:2024-05-01'--",
    "-'; SELECT pg_sleep(10);--",
    '"); DROP TABLE log_events;--"',
    "${process.env.DATABASE_URL}",
    "$1 $2 $$ $99",
    "a\\'b",
  ];

  it.each(attacks)("keeps %j out of the SQL text", (attack) => {
    let result;
    try {
      result = parseQuery(attack, opts);
    } catch (error) {
      expect(error).toBeInstanceOf(QueryError); // rejecting outright is also safe
      return;
    }
    const sql = result.where.join(" AND ");
    expect(sql).not.toMatch(/drop|delete|select|pg_sleep|--|;|'1'/i);
    // Every apostrophe in the SQL belongs to the constant 'simple' config name.
    expect(sql.replace(/'simple'/g, "")).not.toContain("'");
    const placeholders = sql.match(/\$\d+/g) ?? [];
    expect(placeholders).toHaveLength(result.params.length);
  });

  it("passes attack text only as a bound parameter", () => {
    const attack = "'; DROP TABLE log_events;--";
    const result = parseQuery(attack, opts);
    expect(result.params).toContain("DROP");
    expect(result.where.join(" ")).not.toContain("DROP");
  });

  it("rejects attacks in the time tokens and explicit params", () => {
    expect(() => parseQuery("from:1d;DROP", opts)).toThrow(QueryError);
    expect(() => parseQuery("", { ...opts, from: "1d'; DROP TABLE x;--" })).toThrow(QueryError);
    expect(() => parseQuery("", { ...opts, level: "error' OR '1'='1" })).toThrow(QueryError);
  });

  it("treats a SQL-looking service as plain data", () => {
    const result = parseQuery("", { ...opts, service: "api'; DROP TABLE x;--" });
    expect(result.where).toEqual(["service = $1"]);
    expect(result.params).toEqual(["api'; DROP TABLE x;--"]);
  });
});
