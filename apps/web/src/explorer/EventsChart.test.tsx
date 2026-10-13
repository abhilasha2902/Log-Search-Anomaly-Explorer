import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { EventsChart } from "./EventsChart.tsx";
import { makeTimeseries, uplotInstances } from "../test/helpers.tsx";

beforeEach(() => {
  uplotInstances().length = 0;
});

describe("EventsChart", () => {
  it("draws a gap-filled series with uPlot", () => {
    const data = makeTimeseries({
      buckets: [
        { t: "2024-05-01T10:01:00Z", count: 3 },
        { t: "2024-05-01T10:03:00Z", count: 2 },
      ],
    });
    render(<EventsChart data={data} loading={false} error={null} />);

    expect(uplotInstances()).toHaveLength(1);
    expect(uplotInstances()[0].data[1]).toEqual([0, 3, 0, 2, 0]);
    expect(
      screen.getByRole("img", {
        name: "Events per minute: 5 events over 5 minutes, busiest minute 3",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Events per minute/ })).toHaveTextContent(
      "2024-05-01 10:00:00.000 to 2024-05-01 10:05:00.000 UTC",
    );
  });

  it("destroys the chart when it unmounts", () => {
    const data = makeTimeseries({ buckets: [{ t: "2024-05-01T10:01:00Z", count: 1 }] });
    const { unmount } = render(<EventsChart data={data} loading={false} error={null} />);
    const plot = uplotInstances()[0];
    unmount();
    expect(plot.destroy).toHaveBeenCalledTimes(1);
  });

  it("shows a message instead of a chart when there are no events", () => {
    render(<EventsChart data={makeTimeseries()} loading={false} error={null} />);
    expect(screen.getByText("No events in this range.")).toBeInTheDocument();
    expect(uplotInstances()).toHaveLength(0);
  });

  it("shows the loading and error states", () => {
    const { rerender } = render(<EventsChart data={null} loading={true} error={null} />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    rerender(<EventsChart data={null} loading={false} error="the chart supports up to 24 hours" />);
    expect(screen.getByText("the chart supports up to 24 hours")).toBeInTheDocument();
    expect(uplotInstances()).toHaveLength(0);
  });
});
