import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client.ts";
import type { LogItem, Project } from "../api/client.ts";
import { useAuth } from "../auth/useAuth.tsx";
import { ProjectSwitcher } from "../projects/ProjectSwitcher.tsx";
import { Filters } from "./Filters.tsx";
import { LoadMore } from "./LoadMore.tsx";
import { ResultsTable } from "./ResultsTable.tsx";
import { RowDrawer } from "./RowDrawer.tsx";
import { SearchBar } from "./SearchBar.tsx";
import { TimeRange } from "./TimeRange.tsx";
import { useLogs } from "./useLogs.ts";

type FilterKey = "q" | "level" | "service" | "from" | "to";
type Draft = Record<FilterKey, string>;

export function ExplorerPage() {
  const { logout } = useAuth();
  // The URL is the source of truth for what is being searched: shareable, and the
  // back button works. `draft` only holds what is typed in the form before Search.
  const [params, setParams] = useSearchParams();
  const applied: Draft = {
    q: params.get("q") ?? "",
    level: params.get("level") ?? "",
    service: params.get("service") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
  };
  const appliedKey = JSON.stringify(applied);
  const [draft, setDraft] = useState<Draft>(applied);
  useEffect(() => {
    setDraft(JSON.parse(appliedKey) as Draft); // keep the form in step with back/forward
  }, [appliedKey]);

  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  useEffect(() => {
    api
      .listProjects()
      .then(setProjects)
      .catch(() => setProjectsError("Could not load projects."));
  }, []);

  const projectParam = params.get("project");
  const selectedId =
    projects?.find((project) => project.id === projectParam)?.id ?? projects?.[0]?.id ?? null;

  const logs = useLogs(selectedId, applied);

  const [selected, setSelected] = useState<LogItem | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const closeDrawer = useCallback(() => {
    setSelected(null);
    triggerRef.current?.focus(); // hand focus back to the row that opened the drawer
  }, []);

  function updateParams(next: Partial<Draft> & { project?: string }) {
    const merged: Record<string, string> = {
      project: next.project ?? selectedId ?? "",
      q: next.q ?? applied.q,
      level: next.level ?? applied.level,
      service: next.service ?? applied.service,
      from: next.from ?? applied.from,
      to: next.to ?? applied.to,
    };
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
      if (value !== "") search.set(key, value);
    }
    setParams(search);
  }

  function onSearch(event: FormEvent) {
    event.preventDefault();
    updateParams({ ...draft, q: draft.q.trim(), service: draft.service.trim() });
  }

  async function createProject(name: string) {
    const project = await api.createProject(name);
    setProjects((current) => [project, ...(current ?? [])]);
    updateParams({ project: project.id });
  }

  return (
    <div className="page">
      <header className="topbar">
        <h1>Log Explorer</h1>
        <div className="topbar-right">
          {projects && (
            <ProjectSwitcher
              projects={projects}
              selectedId={selectedId}
              onSelect={(id) => updateParams({ project: id })}
              onCreate={createProject}
            />
          )}
          <button type="button" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </header>

      {projectsError && (
        <p role="alert" className="error">
          {projectsError}
        </p>
      )}

      {projects && projects.length === 0 && (
        <p className="card muted">Create a project to start exploring logs.</p>
      )}

      {selectedId && (
        <>
          <form className="card toolbar" onSubmit={onSearch} role="search">
            <SearchBar value={draft.q} onChange={(q) => setDraft((d) => ({ ...d, q }))} />
            <Filters
              level={draft.level}
              service={draft.service}
              onLevelChange={(level) => setDraft((d) => ({ ...d, level }))}
              onServiceChange={(service) => setDraft((d) => ({ ...d, service }))}
            />
            <TimeRange
              from={draft.from}
              to={draft.to}
              onChange={({ from, to }) => setDraft((d) => ({ ...d, from, to }))}
            />
            <button type="submit" className="primary">
              Search
            </button>
          </form>

          <section aria-label="Results" className="card">
            {logs.error && (
              <p role="alert" className="error">
                {logs.error}
              </p>
            )}
            {logs.loading && <p className="muted">Loading…</p>}
            {!logs.loading && !logs.error && logs.items.length === 0 && (
              <p className="muted">No matching log events.</p>
            )}
            {logs.items.length > 0 && (
              <>
                <ResultsTable
                  items={logs.items}
                  onSelect={(item, row) => {
                    triggerRef.current = row;
                    setSelected(item);
                  }}
                />
                <p className="muted small">Showing {logs.items.length} events</p>
              </>
            )}
            <LoadMore
              hasMore={logs.nextCursor !== null}
              loading={logs.loadingMore}
              onLoadMore={logs.loadMore}
            />
          </section>
        </>
      )}

      {selected && <RowDrawer item={selected} onClose={closeDrawer} />}
    </div>
  );
}
