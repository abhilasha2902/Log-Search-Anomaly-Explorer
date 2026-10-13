import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// jsdom has no canvas, so uPlot cannot draw. Replace it with a stub that records how it was
// used; tests read the recorded instances through `uplotInstances()` in helpers.tsx.
vi.mock("uplot", () => {
  class MockUPlot {
    static paths = { bars: () => () => null };
    static instances: MockUPlot[] = [];
    options: unknown;
    data: unknown;
    target: HTMLElement;
    destroy = vi.fn();
    setSize = vi.fn();
    constructor(options: unknown, data: unknown, target: HTMLElement) {
      this.options = options;
      this.data = data;
      this.target = target;
      MockUPlot.instances.push(this);
    }
  }
  return { default: MockUPlot };
});

afterEach(() => {
  cleanup();
});
