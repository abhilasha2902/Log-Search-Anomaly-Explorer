import type { Service } from "./templates.js";

export type IncidentCause = "slow_database" | "bad_deploy" | "downstream_timeout_burst";

export interface Incident {
  cause: IncidentCause;
  service: Service;
  startFraction: number; // position within the run, 0..1
  durationFraction: number;
}

// Positioned as fractions of the total run so they scale with --count/duration
// instead of being tied to a fixed wall-clock window.
export const INCIDENTS: Incident[] = [
  { cause: "slow_database", service: "db", startFraction: 0.25, durationFraction: 0.08 },
  { cause: "bad_deploy", service: "api", startFraction: 0.5, durationFraction: 0.08 },
  {
    cause: "downstream_timeout_burst",
    service: "payments",
    startFraction: 0.75,
    durationFraction: 0.05,
  },
];

export function activeIncidentAt(fraction: number, service: Service): Incident | undefined {
  return INCIDENTS.find(
    (incident) =>
      incident.service === service &&
      fraction >= incident.startFraction &&
      fraction < incident.startFraction + incident.durationFraction,
  );
}
