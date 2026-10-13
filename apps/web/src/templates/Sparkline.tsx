import { sparklinePoints } from "./sparkline.ts";

const WIDTH = 160;
const HEIGHT = 32;

/** A tiny events-per-minute line. The text label carries the numbers for screen readers. */
export function Sparkline({ values }: { values: number[] }) {
  const peak = Math.max(0, ...values);
  const label = `Events per minute over the last ${values.length} minutes, peak ${peak}`;
  if (values.length === 0) return <span className="muted small">no data</span>;
  return (
    <svg
      role="img"
      aria-label={label}
      className="sparkline"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
      height={HEIGHT}
    >
      <polyline
        points={sparklinePoints(values, WIDTH, HEIGHT)}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}
