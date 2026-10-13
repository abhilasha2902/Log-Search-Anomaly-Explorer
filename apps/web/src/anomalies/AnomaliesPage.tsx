import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client.ts";
import type { AnomalyItem, AnomalyType } from "../api/client.ts";
import { formatTs } from "../explorer/format.ts";
import { AppShell } from "../layout/AppShell.tsx";
import { Timeline } from "./Timeline.tsx";

const TYPE_LABEL: Record<AnomalyType, string> = {
  new_template: "New template",
  rate_spike: "Rate spike",
};

export function AnomaliesPage() {
  return (
    <AppShell title="Anomalies">{({ projectId }) => <Anomalies projectId={projectId} />}</AppShell>
  );
}

interface State {
  items: AnomalyItem[] | null;
  loading: boolean;
  error: string | null;
}

function Anomalies({ projectId }: { projectId: string }) {
  const [params, setParams] = useSearchParams();
  const typeParam = params.get("type");
  const type: AnomalyType | undefined =
    typeParam === "new_template" || typeParam === "rate_spike" ? typeParam : undefined;

  const [state, setState] = useState<State>({ items: null, loading: false, error: null });
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    api
      .getAnomalies(projectId, { type })
      .then((data) => {
        if (!cancelled) setState({ items: data.items, loading: false, error: null });
      })
      .catch((error) => {
        if (!cancelled) {
          const message =
            error instanceof Error && error.message ? error.message : "Could not load anomalies.";
          setState({ items: null, loading: false, error: message });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, type]);

  function onTypeChange(value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set("type", value);
    else next.delete("type");
    setParams(next);
  }

  return (
    <>
      <div className="card toolbar">
        <label>
          Type
          <select value={type ?? ""} onChange={(e) => onTypeChange(e.target.value)}>
            <option value="">All</option>
            <option value="new_template">New template</option>
            <option value="rate_spike">Rate spike</option>
          </select>
        </label>
        <p className="muted small grow">
          A <strong>new template</strong> is a kind of log line never seen before. A{" "}
          <strong>rate spike</strong> is a kind of line suddenly far more frequent than its recent
          normal. Detected by the worker process; it only shows what it has run on.
        </p>
      </div>

      <section aria-label="Anomalies" className="card">
        {state.error && (
          <p role="alert" className="error">
            {state.error}
          </p>
        )}
        {state.loading && <p className="muted">Loading…</p>}
        {!state.loading && !state.error && state.items?.length === 0 && (
          <p className="muted">No anomalies found. Is the worker running?</p>
        )}
        {state.items && state.items.length > 0 && (
          <>
            <Timeline items={state.items} />
            <div className="table-wrap">
              <table>
                <caption className="muted small">Newest first. Times are UTC.</caption>
                <thead>
                  <tr>
                    <th scope="col">Severity</th>
                    <th scope="col">Type</th>
                    <th scope="col">Service</th>
                    <th scope="col">Template</th>
                    <th scope="col">Window</th>
                    <th scope="col">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {state.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <span className={`sev-badge sev-${item.severity}`}>{item.severity}</span>
                      </td>
                      <td>{TYPE_LABEL[item.type]}</td>
                      <td>{item.template.service}</td>
                      <td>
                        <code>{item.template.template || "(empty message)"}</code>
                      </td>
                      <td className="nowrap">
                        {formatTs(item.windowStart).slice(0, 19)} –{" "}
                        {formatTs(item.windowEnd).slice(11, 19)}
                      </td>
                      <td>
                        {item.type === "rate_spike"
                          ? `${item.score.toFixed(1)} standard deviations above normal`
                          : "first seen"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </>
  );
}
