import { useEffect, useRef } from "react";
import type { LogItem } from "../api/client.ts";
import { formatTs } from "./format.ts";
import { LevelBadge } from "./LevelBadge.tsx";

interface Props {
  item: LogItem;
  onClose: () => void;
}

export function RowDrawer({ item, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      } else if (event.key === "Tab") {
        // The close button is the only focusable element, so keep focus on it.
        event.preventDefault();
        closeRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Log event details"
        className="drawer"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2>Log event</h2>
          <button ref={closeRef} type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <dl>
          <dt>Time (UTC)</dt>
          <dd className="mono">{formatTs(item.ts)}</dd>
          <dt>Level</dt>
          <dd>
            <LevelBadge level={item.level} />
          </dd>
          <dt>Service</dt>
          <dd>{item.service}</dd>
          <dt>ID</dt>
          <dd className="mono">{item.id}</dd>
        </dl>
        <h3>Message</h3>
        <pre>{item.message}</pre>
        <h3>Attributes</h3>
        <pre>{JSON.stringify(item.attrs, null, 2)}</pre>
      </aside>
    </div>
  );
}
