/** SVG polyline points for a series, scaled to fit width x height (y grows downward). */
export function sparklinePoints(values: number[], width: number, height: number): string {
  if (values.length === 0) return "";
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  return values
    .map((value, index) => {
      const x = (index * step).toFixed(1);
      const y = (height - (value / max) * height).toFixed(1);
      return `${x},${y}`;
    })
    .join(" ");
}
