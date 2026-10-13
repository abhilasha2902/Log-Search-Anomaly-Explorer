import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { DrainParser, templateText } from "./drain.js";

describe("DrainParser properties", () => {
  it("the same line always maps to the same template", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), fc.string({ maxLength: 200 }), (a, b) => {
        const parser = new DrainParser();
        parser.parse(a);
        parser.parse(b);
        const first = parser.parse(a).cluster;
        const second = parser.parse(a).cluster;
        expect(second).toBe(first);
      }),
      { numRuns: 300 },
    );
  });

  it("never throws and always returns a clean template of at most 64 tokens", () => {
    fc.assert(
      fc.property(fc.array(fc.string({ maxLength: 300 }), { maxLength: 30 }), (lines) => {
        const parser = new DrainParser();
        for (const line of lines) {
          const { cluster } = parser.parse(line);
          expect(cluster.tokens.length).toBeLessThanOrEqual(64);
          expect(templateText(cluster)).not.toMatch(/\s{2,}/);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("template count stays small for repetitive input", () => {
    const shapes = [
      (n: number, ip: number) => `GET /orders/${n} 200 from 10.0.0.${ip}`,
      (n: number) => `charge ch_${n} succeeded for customer ${n % 97}`,
      (n: number) => `user u_${n} logged in from the office network`,
    ];
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.integer({ min: 0, max: 2 }),
            fc.integer({ min: 0, max: 999_999 }),
            fc.integer({ min: 0, max: 255 }),
          ),
          { minLength: 50, maxLength: 400 },
        ),
        (picks) => {
          const parser = new DrainParser();
          for (const [shape, n, ip] of picks) parser.parse(shapes[shape](n, ip));
          // 3 shapes with different numbers: must not become one template per line.
          expect(parser.size).toBeLessThanOrEqual(shapes.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});
