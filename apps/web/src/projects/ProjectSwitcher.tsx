import { useState } from "react";
import type { FormEvent } from "react";
import type { Project } from "../api/client.ts";

interface Props {
  projects: Project[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: (name: string) => Promise<void>;
}

export function ProjectSwitcher({ projects, selectedId, onSelect, onCreate }: Props) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(trimmed);
      setName("");
    } catch {
      setError("Could not create the project.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="project-switcher">
      {projects.length > 0 && (
        <label>
          Project
          <select value={selectedId ?? ""} onChange={(e) => onSelect(e.target.value)}>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <form onSubmit={submit} className="inline-form">
        <label>
          New project
          <input
            value={name}
            maxLength={200}
            placeholder="my-service"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button type="submit" disabled={busy || name.trim() === ""}>
          Create
        </button>
      </form>
      {error && (
        <span role="alert" className="error">
          {error}
        </span>
      )}
    </div>
  );
}
