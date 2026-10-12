import { describe, expect, it } from "vitest";
import { placeholder } from "./index.js";

describe("loggen placeholder", () => {
  it("returns a not-implemented marker", () => {
    expect(placeholder()).toBe("loggen: not implemented yet");
  });
});
