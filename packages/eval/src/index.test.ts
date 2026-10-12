import { describe, expect, it } from "vitest";
import { placeholder } from "./index.js";

describe("eval placeholder", () => {
  it("returns a not-implemented marker", () => {
    expect(placeholder()).toBe("eval: not implemented yet");
  });
});
