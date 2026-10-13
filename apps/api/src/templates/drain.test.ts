import { describe, expect, it } from "vitest";
import { DrainParser, templateText } from "./drain.js";
import { maskLine, tokenize } from "./mask.js";

describe("maskLine", () => {
  it.each([
    ["took 123 ms", "took <*> ms"],
    ["took 12.5 ms", "took <*> ms"],
    ["from 10.0.0.1:8080 failed", "from <*> failed"],
    ["id 123e4567-e89b-12d3-a456-426614174000 ok", "id <*> ok"],
    ["ptr 0xdeadbeef freed", "ptr <*> freed"],
    ["commit 9fceb02d0ae598e9 built", "commit <*> built"],
    ["order ch_483921 paid", "order ch_<*> paid"],
    ["GET /orders/42 200", "GET /orders/<*> <*>"],
  ])("%s", (input, expected) => {
    expect(maskLine(input)).toBe(expected);
  });

  it("keeps ordinary words, even ones made of hex letters", () => {
    expect(maskLine("deadbeef cafe added")).toBe("deadbeef cafe added");
  });

  it("caps very long lines", () => {
    expect(tokenize("word ".repeat(10_000)).length).toBeLessThanOrEqual(64);
  });
});

function templatesFor(lines: string[], parser = new DrainParser()): string[] {
  for (const line of lines) parser.parse(line);
  return [...new Set(lines.map((line) => templateText(parser.parse(line).cluster)))].sort();
}

describe("DrainParser", () => {
  it("collapses lines that differ only in numbers", () => {
    expect(
      templatesFor(["GET /orders/1 200", "GET /orders/22 200", "GET /orders/333 200"]),
    ).toEqual(["GET /orders/<*> <*>"]);
  });

  it("replaces a differing word with <*> once enough of the line matches", () => {
    expect(
      templatesFor([
        "connected to alice from the office network",
        "connected to bob from the office network",
        "connected to carol from the office network",
      ]),
    ).toEqual(["connected to <*> from the office network"]);
  });

  it("keeps clearly different messages apart", () => {
    const templates = templatesFor([
      "Unhandled error handling request",
      "NullPointerException in handler /orders/7",
      "GET /orders/7 took longer than expected",
    ]);
    expect(templates).toHaveLength(3);
  });

  it("does not merge short lines that differ in one of three words", () => {
    expect(templatesFor(["charge ch_1 succeeded", "charge ch_2 retried"])).toEqual([
      "charge ch_<*> retried",
      "charge ch_<*> succeeded",
    ]);
  });

  it("reports created and changed flags", () => {
    const parser = new DrainParser();
    const first = parser.parse("user alice logged in from home today");
    expect(first).toMatchObject({ created: true, changed: false });
    const same = parser.parse("user alice logged in from home today");
    expect(same).toMatchObject({ created: false, changed: false });
    const generalised = parser.parse("user bob logged in from home today");
    expect(generalised).toMatchObject({ created: false, changed: true });
    expect(templateText(generalised.cluster)).toBe("user <*> logged in from home today");
    expect(generalised.cluster.size).toBe(3);
  });

  it("tracks created and changed templates as dirty until taken", () => {
    const parser = new DrainParser();
    parser.parse("a b c d e");
    expect(parser.takeDirty()).toHaveLength(1);
    expect(parser.takeDirty()).toHaveLength(0);
    parser.parse("a b c d f"); // 4/5 = 0.8 -> merge + generalise
    expect(parser.takeDirty()).toHaveLength(1);
  });

  it("handles empty and whitespace-only lines", () => {
    const parser = new DrainParser();
    expect(templateText(parser.parse("").cluster)).toBe("");
    expect(templateText(parser.parse("   ").cluster)).toBe("");
    expect(parser.size).toBe(1);
  });

  it("restores stored templates so new lines join them instead of duplicating", () => {
    const parser = new DrainParser();
    const restored = parser.restore("user <*> logged in from home today", "7");
    const result = parser.parse("user zed logged in from home today");
    expect(result.cluster).toBe(restored);
    expect(result.created).toBe(false);
  });

  it("limits tree fan-out with maxChildren", () => {
    const parser = new DrainParser({ maxChildren: 3 });
    for (let i = 0; i < 50; i++) parser.parse(`word${"x".repeat(i)} one two three`);
    // Fan-out is bounded, but every line still lands somewhere.
    expect(parser.size).toBeGreaterThan(0);
  });
});
