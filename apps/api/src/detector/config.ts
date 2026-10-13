import { z } from "zod";

// Empty strings count as "not set" so a blank line in .env falls back to the default.
const num = (fallback: number, check: (schema: z.ZodNumber) => z.ZodNumber) =>
  z.preprocess(
    (value) => (value === undefined || value === "" ? fallback : value),
    check(z.coerce.number()),
  );

const positiveInt = (fallback: number) => num(fallback, (n) => n.int().positive());

const configSchema = z.object({
  /** A template whose first line arrived within this many minutes of `now` is "new". */
  newTemplateWindowMinutes: positiveInt(10),
  /** A service must have been seen this long before its new templates count as anomalies. */
  serviceWarmupMinutes: positiveInt(10),
  /** EWMA smoothing: higher reacts faster to change but remembers less. */
  rateEwmaAlpha: num(0.2, (n) => n.gt(0).lte(1)),
  /** How many "standard deviations" above the baseline a minute must be to count as a spike. */
  rateZThreshold: num(4, (n) => n.positive()),
  /** Never flag a minute with fewer events than this, however unusual it looks. */
  rateMinCount: positiveInt(10),
  /** Minutes of history a template needs before spikes are judged. */
  rateMinHistoryMinutes: positiveInt(10),
  /** How far back the baseline looks. */
  rateLookbackMinutes: positiveInt(120),
  /** Spikes this close together (in minutes) are one ongoing anomaly. */
  spikeMergeGapMinutes: num(2, (n) => n.int().min(0)),
  /** Worker tick interval. */
  workerIntervalMs: positiveInt(60_000),
});

export type DetectorConfig = z.infer<typeof configSchema>;

const ENV_NAMES: Record<keyof DetectorConfig, string> = {
  newTemplateWindowMinutes: "NEW_TEMPLATE_WINDOW_MINUTES",
  serviceWarmupMinutes: "SERVICE_WARMUP_MINUTES",
  rateEwmaAlpha: "RATE_EWMA_ALPHA",
  rateZThreshold: "RATE_Z_THRESHOLD",
  rateMinCount: "RATE_MIN_COUNT",
  rateMinHistoryMinutes: "RATE_MIN_HISTORY_MINUTES",
  rateLookbackMinutes: "RATE_LOOKBACK_MINUTES",
  spikeMergeGapMinutes: "SPIKE_MERGE_GAP_MINUTES",
  workerIntervalMs: "WORKER_INTERVAL_MS",
};

/** Reads the detector settings from the environment; throws a readable error if one is invalid. */
export function loadDetectorConfig(
  env: Record<string, string | undefined> = process.env,
): DetectorConfig {
  const raw = Object.fromEntries(Object.entries(ENV_NAMES).map(([key, name]) => [key, env[name]]));
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => {
      const key = issue.path[0] as keyof DetectorConfig;
      return `${ENV_NAMES[key] ?? String(key)}: ${issue.message}`;
    });
    throw new Error(`invalid detector configuration: ${problems.join("; ")}`);
  }
  return parsed.data;
}
