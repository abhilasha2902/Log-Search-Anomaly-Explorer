import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parseQuery } from "./parseQuery.js";
import { QueryError, type ParseOptions } from "./types.js";

const NOW = new Date("2024-05-10T12:00:00.000Z");
const opts: ParseOptions = { now: NOW, maxRangeMs: 30 * 86_400_000 };

// Every condition must be exactly one of these shapes: constant text + $n only.
const ALLOWED: RegExp[] = [
  /^search_vector @@ plainto_tsquery\('simple', \$\d+\)$/,
  /^search_vector @@ phraseto_tsquery\('simple', \$\d+\)$/,
  /^NOT \(search_vector @@ plainto_tsquery\('simple', \$\d+\)\)$/,
  /^NOT \(search_vector @@ phraseto_tsquery\('simple', \$\d+\)\)$/,
  /^level = ANY\(\$\d+::text\[\]\)$/,
  /^service = ANY\(\$\d+::text\[\]\)$/,
  /^level = \$\d+$/,
  /^service = \$\d+$/,
  /^ts >= \$\d+::timestamptz$/,
  /^ts < \$\d+::timestamptz$/,
];

// Mixes arbitrary text with the syntax characters the tokenizer cares about.
const queryArb = fc.oneof(
  fc.string({ maxLength: 120 }),
  fc.string({ unit: "binary", maxLength: 120 }),
  fc
    .array(
      fc.oneof(
        fc.constantFrom(
          '"',
          "-",
          ":",
          "level:",
          "service:",
          "from:",
          "to:",
          " ",
          "'",
          ";",
          "--",
          "$1",
        ),
        fc.string({ maxLength: 8 }),
      ),
      { maxLength: 40 },
    )
    .map((parts) => parts.join("")),
);

function run(q: string) {
  try {
    return parseQuery(q, opts);
  } catch (error) {
    if (error instanceof QueryError) return null;
    throw error; // any other error type fails the property
  }
}

describe("parseQuery properties", () => {
  it("only ever throws QueryError", () => {
    fc.assert(
      fc.property(queryArb, (q) => void run(q)),
      { numRuns: 500 },
    );
  });

  it("placeholders are contiguous and match params one-to-one", () => {
    fc.assert(
      fc.property(queryArb, fc.integer({ min: 1, max: 20 }), (q, start) => {
        let result;
        try {
          result = parseQuery(q, { ...opts, startParam: start });
        } catch (error) {
          if (error instanceof QueryError) return;
          throw error;
        }
        const indices = (result.where.join(" ").match(/\$(\d+)/g) ?? []).map((p) =>
          Number(p.slice(1)),
        );
        expect(indices).toHaveLength(result.params.length);
        expect([...indices].sort((a, b) => a - b)).toEqual(result.params.map((_, i) => start + i));
      }),
      { numRuns: 500 },
    );
  });

  it("builds SQL only from the fixed fragment whitelist", () => {
    fc.assert(
      fc.property(queryArb, (q) => {
        const result = run(q);
        if (!result) return;
        for (const condition of result.where) {
          expect(ALLOWED.some((pattern) => pattern.test(condition))).toBe(true);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("is deterministic for the same input and now", () => {
    fc.assert(
      fc.property(queryArb, (q) => {
        expect(run(q)).toEqual(run(q));
      }),
      { numRuns: 200 },
    );
  });

  it("never lets bound free-text values exceed the query length", () => {
    fc.assert(
      fc.property(queryArb, (q) => {
        const result = run(q);
        if (!result) return;
        for (const param of result.params) {
          if (typeof param === "string") expect(param.length).toBeLessThanOrEqual(q.length + 30);
        }
      }),
      { numRuns: 200 },
    );
  });
});
