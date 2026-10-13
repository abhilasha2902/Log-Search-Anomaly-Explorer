import { useEffect, useMemo, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { Timeseries } from "../api/client.ts";
import { formatTs } from "./format.ts";
import { fillMinutes } from "./series.ts";
import type { FilledSeries } from "./series.ts";

const CHART_HEIGHT = 180;

function cssColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * The only place uPlot is touched. uPlot draws on a canvas and is driven imperatively
 * (create, then destroy), so it lives in this one wrapper; everything else is plain React.
 */
function Canvas({ series }: { series: FilledSeries }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const accent = cssColor("--accent", "#2f5fd0");
    const muted = cssColor("--muted", "#5d6778");
    const border = cssColor("--border", "#d9dee7");
    const axis = { stroke: muted, grid: { stroke: border, width: 1 }, ticks: { stroke: border } };

    const plot = new uPlot(
      {
        width: container.clientWidth || 600,
        height: CHART_HEIGHT,
        legend: { show: false },
        cursor: { show: false },
        scales: { y: { range: (_u, _min, max) => [0, Math.max(max, 1)] } },
        axes: [
          axis,
          {
            ...axis,
            values: (_u, ticks) => ticks.map((v) => (Number.isInteger(v) ? String(v) : "")),
          },
        ],
        series: [
          {},
          {
            label: "Events",
            stroke: accent,
            fill: accent,
            paths: uPlot.paths.bars?.({ size: [0.85, 64] }),
            points: { show: false },
          },
        ],
      },
      [series.xs, series.ys],
      container,
    );

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        plot.setSize({ width: container.clientWidth, height: CHART_HEIGHT });
      });
      observer.observe(container);
    }
    return () => {
      observer?.disconnect();
      plot.destroy();
    };
  }, [series]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={`Events per minute: ${series.total} events over ${series.xs.length} minutes, busiest minute ${series.peak}`}
    />
  );
}

interface Props {
  data: Timeseries | null;
  loading: boolean;
  error: string | null;
}

export function EventsChart({ data, loading, error }: Props) {
  const series = useMemo(
    () => (data ? fillMinutes(data.buckets, data.from, data.to) : null),
    [data],
  );

  let body;
  if (error) {
    body = <p className="muted">{error}</p>;
  } else if (!series) {
    body = <p className="muted">{loading ? "Loading…" : "No chart data."}</p>;
  } else if (series.total === 0) {
    body = <p className="muted">No events in this range.</p>;
  } else {
    body = <Canvas series={series} />;
  }

  return (
    <section aria-label="Events per minute" className="card chart-card">
      <h2>
        Events per minute
        {data && !error && (
          <span className="muted small">
            {" "}
            · {formatTs(data.from)} to {formatTs(data.to)} UTC
          </span>
        )}
      </h2>
      {body}
    </section>
  );
}
