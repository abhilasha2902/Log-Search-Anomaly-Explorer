import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../api/client.ts";
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
    },
  };
});

const emptyFilters = { q: "", level: "", service: "", from: "", to: "" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.me).mockResolvedValue({ id: "u1" });
  vi.mocked(api.listProjects).mockResolvedValue([makeProject("p1", "demo")]);
  vi.mocked(api.getLogs).mockResolvedValue({ items: [], nextCursor: null });
  vi.mocked(api.getTimeseries).mockResolvedValue(makeTimeseries());
});

describe("results", () => {
  it("loads the first project's logs with a badge per level", async () => {
    vi.mocked(api.getLogs).mockResolvedValue({
      items: [
        makeItem(1, { level: "error", message: "boom" }),
        makeItem(2, { level: "warn", message: "careful" }),
        makeItem(3, { level: "info", message: "fine" }),
        makeItem(4, { level: "debug", message: "chatty" }),
      ],
      nextCursor: null,
    });
    renderApp("/");

    const table = await screen.findByRole("table");
    expect(api.getLogs).toHaveBeenCalledWith("p1", emptyFilters);
    for (const level of ["error", "warn", "info", "debug"]) {
      expect(within(table).getByText(level)).toHaveClass(`badge-${level}`);
    }
    expect(within(table).getByText("boom")).toBeInTheDocument();
    expect(within(table).getAllByText("2024-05-01 10:00:00.123")).toHaveLength(4);
    expect(screen.getByText("Showing 4 events")).toBeInTheDocument();
  });

  it("shows an empty state", async () => {
    renderApp("/");
    expect(await screen.findByText("No matching log events.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows the server's message when the search is rejected", async () => {
    vi.mocked(api.getLogs).mockRejectedValue(new ApiError(422, "level must be one of debug", null));
    renderApp("/");
    expect(await screen.findByRole("alert")).toHaveTextContent("level must be one of debug");
  });

  it("reads the search from the URL on first load", async () => {
    vi.mocked(api.listProjects).mockResolvedValue([
      makeProject("p1", "demo"),
      makeProject("p2", "other"),
    ]);
    renderApp("/?project=p2&q=boom&level=warn&service=db&from=1h");
    await screen.findByText("No matching log events.");

    expect(api.getLogs).toHaveBeenCalledWith("p2", {
      q: "boom",
      level: "warn",
      service: "db",
      from: "1h",
      to: "",
    });
    expect(screen.getByLabelText("Search")).toHaveValue("boom");
    expect(screen.getByLabelText("Level")).toHaveValue("warn");
    expect(screen.getByLabelText("Service")).toHaveValue("db");
    expect(screen.getByLabelText("Time range")).toHaveValue("1h");
    expect(screen.getByLabelText("Project")).toHaveValue("p2");
  });
});

describe("searching", () => {
  it("puts the query and filters in the URL and refetches on Search", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await screen.findByText("No matching log events.");

    await user.type(screen.getByLabelText("Search"), 'timeout -retry "disk full"');
    await user.selectOptions(screen.getByLabelText("Level"), "error");
    await user.type(screen.getByLabelText("Service"), "api");
    await user.selectOptions(screen.getByLabelText("Time range"), "1h");
    // nothing is requested until Search is pressed
    expect(api.getLogs).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Search" }));

    await vi.waitFor(() => expect(api.getLogs).toHaveBeenCalledTimes(2));
    expect(api.getLogs).toHaveBeenLastCalledWith("p1", {
      q: 'timeout -retry "disk full"',
      level: "error",
      service: "api",
      from: "1h",
      to: "",
    });
    const location = new URL(screen.getByTestId("location").textContent!, "http://x");
    expect(location.searchParams.get("q")).toBe('timeout -retry "disk full"');
    expect(location.searchParams.get("level")).toBe("error");
    expect(location.searchParams.get("service")).toBe("api");
    expect(location.searchParams.get("from")).toBe("1h");
    expect(location.searchParams.get("project")).toBe("p1");
  });

  it("offers a custom range with from and to inputs", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await screen.findByText("No matching log events.");

    await user.selectOptions(screen.getByLabelText("Time range"), "custom");
    await user.type(screen.getByLabelText("From"), "2024-05-01T10:00Z");
    await user.type(screen.getByLabelText("To"), "30m");
    await user.click(screen.getByRole("button", { name: "Search" }));

    await vi.waitFor(() => expect(api.getLogs).toHaveBeenCalledTimes(2));
    expect(api.getLogs).toHaveBeenLastCalledWith("p1", {
      ...emptyFilters,
      from: "2024-05-01T10:00Z",
      to: "30m",
    });
  });
});

describe("projects", () => {
  it("switches project and reloads", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listProjects).mockResolvedValue([
      makeProject("p1", "demo"),
      makeProject("p2", "other"),
    ]);
    renderApp("/");
    await screen.findByText("No matching log events.");

    await user.selectOptions(screen.getByLabelText("Project"), "p2");
    await vi.waitFor(() => expect(api.getLogs).toHaveBeenLastCalledWith("p2", emptyFilters));
    expect(screen.getByTestId("location")).toHaveTextContent("project=p2");
  });

  it("creates a project and selects it", async () => {
    const user = userEvent.setup();
    vi.mocked(api.createProject).mockResolvedValue(makeProject("p9", "fresh"));
    renderApp("/");
    await screen.findByText("No matching log events.");

    await user.type(screen.getByLabelText("New project"), "fresh");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(api.createProject).toHaveBeenCalledWith("fresh");
    await vi.waitFor(() => expect(api.getLogs).toHaveBeenLastCalledWith("p9", emptyFilters));
    expect(screen.getByLabelText("Project")).toHaveValue("p9");
  });

  it("asks a user with no projects to create one", async () => {
    vi.mocked(api.listProjects).mockResolvedValue([]);
    renderApp("/");
    expect(
      await screen.findByText("Create a project to start exploring logs."),
    ).toBeInTheDocument();
    expect(api.getLogs).not.toHaveBeenCalled();
    expect(screen.queryByRole("search")).not.toBeInTheDocument();
  });
});

describe("pagination", () => {
  it("appends the next page and hides Load more at the end", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getLogs)
      .mockResolvedValueOnce({ items: [makeItem(1), makeItem(2)], nextCursor: "c1" })
      .mockResolvedValueOnce({ items: [makeItem(3)], nextCursor: null });
    renderApp("/");

    await screen.findByText("message 1");
    await user.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByText("message 3")).toBeInTheDocument();
    expect(api.getLogs).toHaveBeenLastCalledWith("p1", emptyFilters, "c1");
    expect(screen.getByText("message 1")).toBeInTheDocument();
    expect(screen.getByText("Showing 3 events")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("does not show Load more when there is no next cursor", async () => {
    vi.mocked(api.getLogs).mockResolvedValue({ items: [makeItem(1)], nextCursor: null });
    renderApp("/");
    await screen.findByText("message 1");
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });
});

describe("detail drawer", () => {
  beforeEach(() => {
    vi.mocked(api.getLogs).mockResolvedValue({
      items: [
        makeItem(7, {
          level: "error",
          service: "payments",
          message: "gateway timed out",
          attrs: { duration_ms: 1234, region: "eu" },
        }),
      ],
      nextCursor: null,
    });
  });

  it("opens on click with the full event, and closes with Escape returning focus to the row", async () => {
    const user = userEvent.setup();
    renderApp("/");
    const row = (await screen.findByText("gateway timed out")).closest("tr")!;

    await user.click(row);
    const dialog = screen.getByRole("dialog", { name: "Log event details" });
    expect(within(dialog).getByText("gateway timed out")).toBeInTheDocument();
    expect(within(dialog).getByText("payments")).toBeInTheDocument();
    expect(within(dialog).getByText("7")).toBeInTheDocument();
    expect(dialog).toHaveTextContent('"duration_ms": 1234');
    expect(within(dialog).getByRole("button", { name: "Close" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(row).toHaveFocus();
  });

  it("opens from the keyboard and closes with the Close button", async () => {
    const user = userEvent.setup();
    renderApp("/");
    const row = (await screen.findByText("gateway timed out")).closest("tr")!;

    row.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(row).toHaveFocus();
  });
});

describe("events chart", () => {
  it("requests the chart with the same applied filters as the results", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await screen.findByText("No matching log events.");
    expect(api.getTimeseries).toHaveBeenCalledWith("p1", emptyFilters);

    await user.type(screen.getByLabelText("Search"), "timeout");
    await user.selectOptions(screen.getByLabelText("Level"), "error");
    await user.click(screen.getByRole("button", { name: "Search" }));

    await vi.waitFor(() => expect(api.getTimeseries).toHaveBeenCalledTimes(2));
    expect(api.getTimeseries).toHaveBeenLastCalledWith("p1", {
      ...emptyFilters,
      q: "timeout",
      level: "error",
    });
  });

  it("draws the returned buckets", async () => {
    vi.mocked(api.getTimeseries).mockResolvedValue(
      makeTimeseries({ buckets: [{ t: "2024-05-01T10:02:00Z", count: 4 }] }),
    );
    renderApp("/");
    expect(
      await screen.findByRole("img", {
        name: "Events per minute: 4 events over 5 minutes, busiest minute 4",
      }),
    ).toBeInTheDocument();
  });

  it("explains why the chart is missing when the range is too long, without hiding the results", async () => {
    vi.mocked(api.getTimeseries).mockRejectedValue(
      new ApiError(422, "the chart supports time ranges of up to 24 hours", null),
    );
    vi.mocked(api.getLogs).mockResolvedValue({ items: [makeItem(1)], nextCursor: null });
    renderApp("/?from=7d");
    expect(
      await screen.findByText("the chart supports time ranges of up to 24 hours"),
    ).toBeInTheDocument();
    expect(await screen.findByText("message 1")).toBeInTheDocument();
  });
});
