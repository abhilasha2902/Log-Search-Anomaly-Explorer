import { useState } from "react";

export const PRESETS: { value: string; label: string }[] = [
  { value: "15m", label: "Last 15 minutes" },
  { value: "1h", label: "Last hour" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
];

interface Props {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
}

const isPreset = (from: string, to: string) =>
  to === "" && PRESETS.some((preset) => preset.value === from);

export function TimeRange({ from, to, onChange }: Props) {
  const [custom, setCustom] = useState((from !== "" || to !== "") && !isPreset(from, to));
  const selectValue = custom ? "custom" : from;

  return (
    <>
      <label>
        Time range
        <select
          value={selectValue}
          onChange={(e) => {
            const value = e.target.value;
            if (value === "custom") {
              setCustom(true);
              return;
            }
            setCustom(false);
            onChange({ from: value, to: "" });
          }}
        >
          <option value="">Any time</option>
          {PRESETS.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
          <option value="custom">Custom range…</option>
        </select>
      </label>
      {custom && (
        <>
          <label>
            From
            <input
              value={from}
              placeholder="2024-05-01T10:00Z or 2h"
              onChange={(e) => onChange({ from: e.target.value, to })}
            />
          </label>
          <label>
            To
            <input
              value={to}
              placeholder="2024-05-01T12:00Z or 30m"
              onChange={(e) => onChange({ from, to: e.target.value })}
            />
          </label>
        </>
      )}
    </>
  );
}
