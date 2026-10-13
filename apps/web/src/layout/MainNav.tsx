import { NavLink } from "react-router-dom";

const LINKS = [
  { to: "/", label: "Explorer", end: true },
  { to: "/templates", label: "Templates", end: false },
  { to: "/anomalies", label: "Anomalies", end: false },
];

/** Page links that keep the selected project in the URL while moving between pages. */
export function MainNav({ projectId }: { projectId: string | null }) {
  const search = projectId ? `?project=${encodeURIComponent(projectId)}` : "";
  return (
    <nav aria-label="Main" className="main-nav">
      {LINKS.map((link) => (
        <NavLink key={link.to} to={{ pathname: link.to, search }} end={link.end}>
          {link.label}
        </NavLink>
      ))}
    </nav>
  );
}
