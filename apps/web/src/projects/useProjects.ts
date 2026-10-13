import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client.ts";
import type { Project } from "../api/client.ts";

/** Loads the signed-in user's projects once; `create` adds one and returns it. */
export function useProjects() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listProjects()
      .then(setProjects)
      .catch(() => setError("Could not load projects."));
  }, []);

  const create = useCallback(async (name: string): Promise<Project> => {
    const project = await api.createProject(name);
    setProjects((current) => [project, ...(current ?? [])]);
    return project;
  }, []);

  return { projects, error, create };
}
