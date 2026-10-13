import { createRng, pick } from "./rng.js";
import { ALL_TEMPLATES, BAD_DEPLOY_TEMPLATE, TEMPLATES, type Service } from "./templates.js";
import { INCIDENTS, activeIncidentAt } from "./incidents.js";
import type { GroundTruth, GroundTruthEvent } from "./groundTruth.js";

export interface LogEvent {
  ts: string;
  service: Service;
  level: string;
  message: string;
  attrs: Record<string, unknown>;
}

export interface GenerateOptions {
  seed: number;
  count: number;
  durationMinutes?: number;
  startTime?: Date;
}

export interface GenerateResult {
  events: LogEvent[];
  groundTruth: GroundTruth;
}

const SERVICES: Service[] = ["api", "payments", "auth", "db"];

function weightedPickTemplate(rng: () => number, service: Service) {
  const candidates = TEMPLATES.filter((t) => t.service === service);
  const totalWeight = candidates.reduce((sum, t) => sum + t.baselineWeight, 0);
  let roll = rng() * totalWeight;
  for (const template of candidates) {
    roll -= template.baselineWeight;
    if (roll <= 0) return template;
  }
  return candidates[candidates.length - 1];
}

export function generate(options: GenerateOptions): GenerateResult {
  const { seed, count } = options;
  const durationMinutes = options.durationMinutes ?? 60;
  const startTime = options.startTime ?? new Date("2026-01-01T00:00:00.000Z");
  const rng = createRng(seed);

  const events: LogEvent[] = [];
  const groundTruthEvents: GroundTruthEvent[] = [];

  for (let i = 0; i < count; i++) {
    const fraction = count === 1 ? 0 : i / (count - 1);
    const ts = new Date(startTime.getTime() + fraction * durationMinutes * 60_000);
    const service = pick(rng, SERVICES);
    const incident = activeIncidentAt(fraction, service);

    let template = weightedPickTemplate(rng, service);
    let overriddenAttrs: Record<string, unknown> | undefined;

    if (incident?.cause === "slow_database") {
      // Slow queries show up as a flood of "slow query detected" warnings (with long durations),
      // not just as a change in a number: a message-based detector can only see the former.
      template = TEMPLATES.find((t) => t.id === "db_warn_slow_query")!;
      overriddenAttrs = { duration_ms: 500 + Math.floor(rng() * 1500) };
    } else if (incident?.cause === "bad_deploy") {
      template = BAD_DEPLOY_TEMPLATE;
    } else if (incident?.cause === "downstream_timeout_burst") {
      template = TEMPLATES.find((t) => t.id === "payments_error_timeout")!;
    }

    events.push({
      ts: ts.toISOString(),
      service: template.service,
      level: template.level,
      message: template.render(rng),
      attrs: overriddenAttrs ?? template.attrs(rng),
    });
    groundTruthEvents.push({ line: i, templateId: template.id });
  }

  const stableRng = createRng(0);
  const groundTruth: GroundTruth = {
    templates: ALL_TEMPLATES.map((t) => ({ id: t.id, pattern: t.render(stableRng) })),
    events: groundTruthEvents,
    incidents: INCIDENTS.map((incident) => ({
      cause: incident.cause,
      service: incident.service,
      startTs: new Date(
        startTime.getTime() + incident.startFraction * durationMinutes * 60_000,
      ).toISOString(),
      endTs: new Date(
        startTime.getTime() +
          (incident.startFraction + incident.durationFraction) * durationMinutes * 60_000,
      ).toISOString(),
    })),
  };

  return { events, groundTruth };
}
