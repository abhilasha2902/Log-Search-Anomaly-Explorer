export type AnomalyType = "new_template" | "rate_spike";
export type Severity = "low" | "medium" | "high";

/** Display tiers for a spike's z-score ("standard deviations above normal"). */
export const SPIKE_MEDIUM_Z = 6;
export const SPIKE_HIGH_Z = 10;

/**
 * Severity is derived when reading, not stored, so the tiers can change without a migration.
 * It is a display heuristic: a spike by how far above normal it went, a new template by the level
 * of its first example line (a brand-new error line matters more than a brand-new info line).
 */
export function severityFor(
  type: AnomalyType,
  score: number,
  exampleLevel: string | null,
): Severity {
  if (type === "rate_spike") {
    if (score >= SPIKE_HIGH_Z) return "high";
    if (score >= SPIKE_MEDIUM_Z) return "medium";
    return "low";
  }
  if (exampleLevel === "error") return "high";
  if (exampleLevel === "warn") return "medium";
  return "low";
}
