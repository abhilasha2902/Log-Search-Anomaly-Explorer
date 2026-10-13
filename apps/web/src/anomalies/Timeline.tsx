import type { AnomalyItem } from "../api/client.ts";
import { formatTs } from "../explorer/format.ts";
import { layoutTimeline } from "./timeline.ts";

const LABEL_WIDTH = 90;
const PLOT_WIDTH = 900;
const LANE_HEIGHT = 30;
const BAR_HEIGHT = 16;
const AXIS_HEIGHT = 22;

const minutes = (ms: number) => formatTs(new Date(ms).toISOString()).slice(0, 16);

/**
 * Anomalies over time, one lane per service. Colour shows severity; the table under the chart
 * has the same information as text, so nothing here depends on colour alone.
 */
export function Timeline({ items }: { items: AnomalyItem[] }) {
  const layout = layoutTimeline(items, PLOT_WIDTH);
  if (items.length === 0) return null;

  const height = layout.lanes.length * LANE_HEIGHT + AXIS_HEIGHT;
  const byId = new Map(items.map((item) => [item.id, item]));
  const summary = `Timeline of ${items.length} anomalies across ${layout.lanes.length} services`;

  return (
    <svg
      role="img"
      aria-label={summary}
      className="timeline"
      viewBox={`0 0 ${LABEL_WIDTH + PLOT_WIDTH} ${height}`}
    >
      {layout.lanes.map((lane, index) => (
        <g key={lane}>
          <line
            x1={LABEL_WIDTH}
            x2={LABEL_WIDTH + PLOT_WIDTH}
            y1={(index + 1) * LANE_HEIGHT}
            y2={(index + 1) * LANE_HEIGHT}
          />
          <text x={0} y={index * LANE_HEIGHT + LANE_HEIGHT / 2 + 4}>
            {lane}
          </text>
        </g>
      ))}
      {layout.marks.map((mark) => {
        const item = byId.get(mark.id)!;
        return (
          <rect
            key={mark.id}
            className={`sev-${item.severity}`}
            x={LABEL_WIDTH + mark.x}
            y={mark.lane * LANE_HEIGHT + (LANE_HEIGHT - BAR_HEIGHT) / 2}
            width={mark.width}
            height={BAR_HEIGHT}
            rx={3}
          >
            <title>{`${item.severity} ${item.type.replace("_", " ")}: ${item.template.template}`}</title>
          </rect>
        );
      })}
      <text x={LABEL_WIDTH} y={height - 6}>
        {minutes(layout.startMs)} UTC
      </text>
      <text x={LABEL_WIDTH + PLOT_WIDTH} y={height - 6} textAnchor="end">
        {minutes(layout.endMs)} UTC
      </text>
    </svg>
  );
}
