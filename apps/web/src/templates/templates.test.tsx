import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../api/client.ts";
import type { TemplateItem } from "../api/client.ts";
import { makeItem, makeProject, makeTimeseries, renderApp } from "../test/helpers.tsx";

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
    },
  };
});

function makeTemplate(id: number, overrides: Partial<TemplateItem> = {}): TemplateItem {
  return {
    id: String(id),
    service: "api",
    template: `GET /orders/<*> <*> ${id}`,
    firstSeen: "2024-05-01T10:00:00.000Z",
    lastSeen: "2024-05-01T10:59:00.000Z",
    totalCount: 1234,
    sparkline: [0, 2, 4, 1],
    samples: [
      { id: "11", ts: "2024-05-01T10:59:00.000Z", level: "info", message: "GET /orders/7 200" },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.me).mockResolvedValue({ id: "u1" });
  vi.mocked(api.listProjects).mockResolvedValue([makeProject("p1", "demo")]);
  vi.mocked(api.getLogs).mockResolvedValue({ items: [], nextCursor: null });
  vi.mocked(api.getTimeseries).mockResolvedValue(makeTimeseries());
  vi.mocked(api.getTemplates).mockResolvedValue({
    window: { start: "2024-05-01T10:00:00.000Z", end: "2024-05-01T10:59:00.000Z", minutes: 60 },
    items: [makeTemplate(1), makeTemplate(2, { service: "db", totalCount: 5 })],
  });
});

describe("templates page", () => {
  it("lists templates with counts, a sparkline and sample lines", async () => {
    renderApp("/templates");

    expect(await screen.findByText("GET /orders/<*> <*> 1")).toBeInTheDocument();
    expect(api.getTemplates).toHaveBeenCalledWith("p1", {
      service: undefined,
      sort: "count",
      minutes: undefined,
    });
    expect(screen.getByText("1,234")).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: /peak 4/ })).toHaveLength(2);
    const samples = screen.getAllByRole("list", { name: "Sample lines" })[0];
    expect(within(samples).getByText("GET /orders/7 200")).toBeInTheDocument();
  });

  it("reads the filters from the URL", async () => {
    renderApp("/templates?project=p1&service=db&sort=recent");
    await screen.findByText("GET /orders/<*> <*> 1");
    expect(api.getTemplates).toHaveBeenCalledWith("p1", {
      service: "db",
      sort: "recent",
      minutes: undefined,
    });
  });

  it("shows an empty state", async () => {
    vi.mocked(api.getTemplates).mockResolvedValue({ window: null, items: [] });
    renderApp("/templates");
    expect(await screen.findByText(/No templates yet/)).toBeInTheDocument();
  });

  it("shows the server's error", async () => {
    vi.mocked(api.getTemplates).mockRejectedValue(new ApiError(500, "internal", null));
    renderApp("/templates");
    expect(await screen.findByRole("alert")).toHaveTextContent("internal");
  });

  it("loads a template's events on demand and follows the cursor", async () => {
    vi.mocked(api.getTemplateEvents)
      .mockResolvedValueOnce({
        items: [makeItem(1, { message: "first event" })],
        nextCursor: "c1",
      })
      .mockResolvedValueOnce({
        items: [makeItem(2, { message: "second event" })],
        nextCursor: null,
      });
    const user = userEvent.setup();
    renderApp("/templates");
    await screen.findByText("GET /orders/<*> <*> 1");

    expect(api.getTemplateEvents).not.toHaveBeenCalled();
    await user.click(screen.getAllByRole("button", { name: "Show events" })[0]);
    expect(await screen.findByText("first event")).toBeInTheDocument();
    expect(api.getTemplateEvents).toHaveBeenCalledWith("p1", "1");

    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("second event")).toBeInTheDocument();
    expect(api.getTemplateEvents).toHaveBeenLastCalledWith("p1", "1", "c1");
    expect(screen.getByText("first event")).toBeInTheDocument();
  });

  it("links between pages and keeps the project in the URL", async () => {
    const user = userEvent.setup();
    renderApp("/templates?project=p1");
    await screen.findByText("GET /orders/<*> <*> 1");
    await user.click(screen.getByRole("link", { name: "Explorer" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/?project=p1");
  });
});
