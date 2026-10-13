import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/useAuth.tsx";
import { ProjectSwitcher } from "../projects/ProjectSwitcher.tsx";
import { useProjects } from "../projects/useProjects.ts";
import { MainNav } from "./MainNav.tsx";

interface Props {
  title: string;
  /** Rendered once a project is selected. */
  children: (context: { projectId: string }) => ReactNode;
}

/** Top bar (title, page links, project switcher, sign out) shared by the Templates and Anomalies pages. */
export function AppShell({ title, children }: Props) {
  const { logout } = useAuth();
  const { projects, error, create } = useProjects();
  const [params, setParams] = useSearchParams();

  const projectParam = params.get("project");
  const projectId =
    projects?.find((project) => project.id === projectParam)?.id ?? projects?.[0]?.id ?? null;

  function selectProject(id: string) {
    const next = new URLSearchParams(params);
    next.set("project", id);
    setParams(next);
  }

  return (
    <div className="page">
      <header className="topbar">
        <h1>{title}</h1>
        <MainNav projectId={projectId} />
        <div className="topbar-right">
          {projects && (
            <ProjectSwitcher
              projects={projects}
              selectedId={projectId}
              onSelect={selectProject}
              onCreate={async (name) => selectProject((await create(name)).id)}
            />
          )}
          <button type="button" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </header>

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {projects && projects.length === 0 && (
        <p className="card muted">Create a project to start exploring logs.</p>
      )}
      {projectId && children({ projectId })}
    </div>
  );
}
