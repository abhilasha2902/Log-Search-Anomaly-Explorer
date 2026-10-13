import { render } from "@testing-library/react";
import uPlot from "uplot";
import { vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import App from "../App.tsx";
import type { LogItem, Project, Timeseries } from "../api/client.ts";
import { AuthProvider } from "../auth/useAuth.tsx";

function LocationDisplay() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

export function renderApp(initialEntry = "/") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AuthProvider>
        <App />
      </AuthProvider>
      <LocationDisplay />
    </MemoryRouter>,
  );
}

export function makeItem(id: number, overrides: Partial<LogItem> = {}): LogItem {
  return {
    id: String(id),
    ts: "2024-05-01T10:00:00.123456Z",
    service: "api",
    level: "info",
    message: `message ${id}`,
    attrs: {},
    ...overrides,
  };
}

interface MockPlot {
  data: [number[], number[]];
  destroy: ReturnType<typeof vi.fn>;
}

/** The uPlot instances created so far (see the mock in setup.ts). */
export function uplotInstances(): MockPlot[] {
  return (uPlot as unknown as { instances: MockPlot[] }).instances;
}

export function makeTimeseries(overrides: Partial<Timeseries> = {}): Timeseries {
  return {
    from: "2024-05-01T10:00:00.000Z",
    to: "2024-05-01T10:05:00.000Z",
    buckets: [],
    ...overrides,
  };
}

export function makeProject(id: string, name: string): Project {
  return { id, name, created_at: "2024-05-01T00:00:00.000Z" };
}
