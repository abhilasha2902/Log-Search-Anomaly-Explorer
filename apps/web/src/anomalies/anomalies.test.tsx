import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../api/client.ts";
import type { AnomalyItem } from "../api/client.ts";
import { makeProject, makeTimeseries, renderApp } from "../test/helpers.tsx";

vi.mock("../api/client.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client.ts")>();
  return {
    ...actual,
    api: {
      me: vi.fn(),
      register: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      listProjects: vi.fn(),
      createProject: vi.fn(),
      getLogs: vi.fn(),
      getTimeseries: vi.fn(),
      getTemplates: vi.fn(),
      getTemplateEvents: vi.fn(),
      getAnomalies: vi.fn(),
    },
  };
});

const spike: AnomalyItem = {
  id: "2",
  type: "rate_spike",
  severity: "high",
  score: 17.14,
  detectedAt: "2026-01-01T00:16:05.000Z",
  windowStart: "2026-01-01T00:15:00.000Z",
  windowEnd: "2026-01-01T00:20:00.000Z",
  template: { id: "5", service: "db", template: "slow query detected" },
};
const fresh: AnomalyItem = {
  id: "1",
  type: "new_template",
  severity: "medium",
  score: 1,
  detectedAt: "2026-01-01T00:30:05.000Z",
  windowStart: "2026-01-01T00:30:00.000Z",
  windowEnd: "2026-01-01T00:31:00.000Z",
  template: { id: "9", service: "api", template: "NullPointerException in handler /orders/<*>" },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.me).mockResolvedValue({ id: "u1" });
  vi.mocked(api.listProjects).mockResolvedValue([makeProject("p1", "demo")]);
  vi.mocked(api.getLogs).mockResolvedValue({ items: [], nextCursor: null });
  vi.mocked(api.getTimeseries).mockResolvedValue(makeTimeseries());
  vi.mocked(api.getAnomalies).mockResolvedValue({ items: [fresh, spike] });
});

describe("anomalies page", () => {
  it("shows a timeline and a table with severity as text", async () => {
    renderApp("/anomalies");

    expect(
      await screen.findByRole("img", { name: /2 anomalies across 2 services/ }),
    ).toBeInTheDocument();
    expect(api.getAnomalies).toHaveBeenCalledWith("p1", { type: undefined });

    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3); // header + 2
    expect(within(rows[1]).getByText("medium")).toHaveClass("sev-medium");
    expect(within(rows[1]).getByText("New template")).toBeInTheDocument();
    expect(within(rows[2]).getByText("high")).toHaveClass("sev-high");
    expect(within(rows[2]).getByText("17.1 standard deviations above normal")).toBeInTheDocument();
    expect(within(rows[2]).getByText("slow query detected")).toBeInTheDocument();
  });

  it("filters by type through the URL", async () => {
    const user = userEvent.setup();
    renderApp("/anomalies?project=p1");
    await screen.findByRole("table");

    await user.selectOptions(screen.getByLabelText("Type"), "rate_spike");
    expect(screen.getByTestId("location")).toHaveTextContent("type=rate_spike");
    expect(api.getAnomalies).toHaveBeenLastCalledWith("p1", { type: "rate_spike" });
  });

  it("shows an empty state that points at the worker", async () => {
    vi.mocked(api.getAnomalies).mockResolvedValue({ items: [] });
    renderApp("/anomalies");
    expect(await screen.findByText(/No anomalies found/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows the server's error", async () => {
    vi.mocked(api.getAnomalies).mockRejectedValue(new ApiError(500, "internal", null));
    renderApp("/anomalies");
    expect(await screen.findByRole("alert")).toHaveTextContent("internal");
  });
});
