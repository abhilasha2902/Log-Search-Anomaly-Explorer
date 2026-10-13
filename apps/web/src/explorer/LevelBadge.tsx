import type { Level } from "../api/client.ts";

/** Text plus colour, so the level is never conveyed by colour alone. */
export function LevelBadge({ level }: { level: Level }) {
  return <span className={`badge badge-${level}`}>{level}</span>;
}
