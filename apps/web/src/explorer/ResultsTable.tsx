import type { KeyboardEvent } from "react";
import type { LogItem } from "../api/client.ts";
import { formatTs } from "./format.ts";
import { LevelBadge } from "./LevelBadge.tsx";

interface Props {
  items: LogItem[];
  onSelect: (item: LogItem, row: HTMLElement) => void;
}

export function ResultsTable({ items, onSelect }: Props) {
  function onKeyDown(event: KeyboardEvent<HTMLTableRowElement>, item: LogItem) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(item, event.currentTarget);
    }
  }

  return (
    <div className="table-wrap">
      <table className="results">
        <thead>
          <tr>
            <th scope="col">Time (UTC)</th>
            <th scope="col">Level</th>
            <th scope="col">Service</th>
            <th scope="col">Message</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.id}
              tabIndex={0}
              aria-haspopup="dialog"
              onClick={(e) => onSelect(item, e.currentTarget)}
              onKeyDown={(e) => onKeyDown(e, item)}
            >
              <td className="mono nowrap">{formatTs(item.ts)}</td>
              <td>
                <LevelBadge level={item.level} />
              </td>
              <td>{item.service}</td>
              <td className="message">{item.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
