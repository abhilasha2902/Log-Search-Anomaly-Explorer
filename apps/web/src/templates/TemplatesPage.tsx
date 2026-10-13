import { useState } from "react";
import type { FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import type { TemplateItem } from "../api/client.ts";
import { AppShell } from "../layout/AppShell.tsx";
import { LevelBadge } from "../explorer/LevelBadge.tsx";
import { LoadMore } from "../explorer/LoadMore.tsx";
import { formatTs } from "../explorer/format.ts";
import { Sparkline } from "./Sparkline.tsx";
import { useTemplateEvents, useTemplates } from "./useTemplates.ts";

export function TemplatesPage() {
  return (
    <AppShell title="Templates">{({ projectId }) => <Templates projectId={projectId} />}</AppShell>
  );
}

function Templates({ projectId }: { projectId: string }) {
  const [params, setParams] = useSearchParams();
  const service = params.get("service") ?? "";
  const sort = params.get("sort") === "recent" ? "recent" : "count";
  const [draftService, setDraftService] = useState(service);

  const { data, loading, error } = useTemplates(projectId, {
    service: service || undefined,
    sort,
  });

  function update(next: { service?: string; sort?: string }) {
    const search = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value) search.set(key, value);
      else search.delete(key);
    }
    setParams(search);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    update({ service: draftService.trim() });
  }

  return (
    <>
      <form className="card toolbar" onSubmit={onSubmit} role="search">
        <label>
          Service
          <input value={draftService} onChange={(e) => setDraftService(e.target.value)} />
        </label>
        <label>
          Sort by
          <select value={sort} onChange={(e) => update({ sort: e.target.value })}>
            <option value="count">Most events</option>
            <option value="recent">Most recent</option>
          </select>
        </label>
        <button type="submit" className="primary">
          Apply
        </button>
      </form>

      <section aria-label="Templates" className="card">
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {loading && <p className="muted">Loading…</p>}
        {!loading && !error && data && data.items.length === 0 && (
          <p className="muted">No templates yet. Templates appear as logs are ingested.</p>
        )}
        {data && data.items.length > 0 && (
          <>
            <p className="muted small">
              Sparklines show events per minute for the {data.window?.minutes ?? 0} minutes ending{" "}
              {data.window ? formatTs(data.window.end) : "—"} UTC (the project's latest data).
            </p>
            <ul className="template-list">
              {data.items.map((item) => (
                <TemplateRow key={item.id} projectId={projectId} item={item} />
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}

function TemplateRow({ projectId, item }: { projectId: string; item: TemplateItem }) {
  const [open, setOpen] = useState(false);
  const events = useTemplateEvents(projectId, item.id, open);

  return (
    <li className="template-row">
      <div className="template-head">
        <span className="badge badge-debug">{item.service}</span>
        <code className="template-text">{item.template || "(empty message)"}</code>
      </div>
      <div className="template-meta">
        <span>
          <strong>{item.totalCount.toLocaleString("en-US")}</strong> events
        </span>
        <span className="muted small">last seen {formatTs(item.lastSeen)} UTC</span>
        <Sparkline values={item.sparkline} />
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? "Hide events" : "Show events"}
        </button>
      </div>
      {item.samples.length > 0 && (
        <ul className="sample-list" aria-label="Sample lines">
          {item.samples.map((sample) => (
            <li key={sample.id}>
              <LevelBadge level={sample.level} /> <code>{sample.message}</code>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <div className="template-events">
          {events.error && (
            <p role="alert" className="error">
              {events.error}
            </p>
          )}
          {events.loading && events.items.length === 0 && <p className="muted">Loading…</p>}
          {events.items.length > 0 && (
            <ul className="sample-list" aria-label="Events">
              {events.items.map((event) => (
                <li key={event.id}>
                  <span className="muted small">{formatTs(event.ts)}</span>{" "}
                  <LevelBadge level={event.level} /> <code>{event.message}</code>
                </li>
              ))}
            </ul>
          )}
          <LoadMore
            hasMore={events.nextCursor !== null}
            loading={events.loading}
            onLoadMore={events.loadMore}
          />
        </div>
      )}
    </li>
  );
}
