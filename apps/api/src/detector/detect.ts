import type { Pool } from "pg";
import type { DetectorConfig } from "./config.js";
import { evaluateSpike } from "./ewma.js";

const MINUTE_MS = 60_000;

export interface DetectionSummary {
  newTemplates: number;
  spikesCreated: number;
  spikesExtended: number;
}

/**
 * Looks for anomalies in one project as of `now`. All times come from the data (and the `now`
 * argument), never from the clock, so a test can replay an old run minute by minute.
 * Running it twice for the same `now` changes nothing.
 */
export async function detectProject(
  pool: Pool,
  projectId: string,
  now: Date,
  config: DetectorConfig,
): Promise<DetectionSummary> {
  const newTemplates = await detectNewTemplates(pool, projectId, now, config);
  const spikes = await detectRateSpikes(pool, projectId, now, config);
  return { newTemplates, ...spikes };
}

async function detectNewTemplates(
  pool: Pool,
  projectId: string,
  now: Date,
  config: DetectorConfig,
): Promise<number> {
  // "New" = first seen recently, and not merely because the service itself only just started
  // sending logs: the template must appear at least `serviceWarmupMinutes` after the service's
  // earliest template.
  const result = await pool.query(
    `INSERT INTO anomalies (project_id, template_id, type, detected_at, score, window_start, window_end)
     SELECT t.project_id, t.id, 'new_template', $2::timestamptz, 1, t.first_seen,
            t.first_seen + interval '1 minute'
     FROM log_templates t
     WHERE t.project_id = $1
       AND t.first_seen <= $2::timestamptz
       AND t.first_seen > $2::timestamptz - make_interval(mins => $3::int)
       AND t.first_seen >= (
         SELECT min(s.first_seen) FROM log_templates s
         WHERE s.project_id = t.project_id AND s.service = t.service
       ) + make_interval(mins => $4::int)
     ON CONFLICT (template_id) WHERE type = 'new_template' DO NOTHING`,
    [projectId, now.toISOString(), config.newTemplateWindowMinutes, config.serviceWarmupMinutes],
  );
  return result.rowCount ?? 0;
}

async function detectRateSpikes(
  pool: Pool,
  projectId: string,
  now: Date,
  config: DetectorConfig,
): Promise<{ spikesCreated: number; spikesExtended: number }> {
  // The last complete minute: the current one is still filling up.
  const minuteMs = Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS - MINUTE_MS;

  const candidates = await pool.query<{ template_id: string; count: number; first_ms: string }>(
    `SELECT c.template_id::text AS template_id, c.count,
            (extract(epoch FROM date_trunc('minute', t.first_seen)) * 1000)::bigint::text AS first_ms
     FROM template_minute_counts c JOIN log_templates t ON t.id = c.template_id
     WHERE t.project_id = $1 AND c.minute = to_timestamp($2::double precision / 1000)
       AND c.count >= $3`,
    [projectId, minuteMs, config.rateMinCount],
  );
  if (candidates.rows.length === 0) return { spikesCreated: 0, spikesExtended: 0 };

  const lookbackStart = minuteMs - config.rateLookbackMinutes * MINUTE_MS;
  const history = await pool.query<{ template_id: string; minute_ms: string; count: number }>(
    `SELECT template_id::text AS template_id,
            (extract(epoch FROM minute) * 1000)::bigint::text AS minute_ms, count
     FROM template_minute_counts
     WHERE template_id = ANY($1::bigint[])
       AND minute >= to_timestamp($2::double precision / 1000)
       AND minute < to_timestamp($3::double precision / 1000)`,
    [candidates.rows.map((r) => r.template_id), lookbackStart, minuteMs],
  );
  const byTemplate = new Map<string, Map<number, number>>();
  for (const row of history.rows) {
    let minutes = byTemplate.get(row.template_id);
    if (!minutes) {
      minutes = new Map();
      byTemplate.set(row.template_id, minutes);
    }
    minutes.set(Number(row.minute_ms), row.count);
  }

  let spikesCreated = 0;
  let spikesExtended = 0;
  for (const candidate of candidates.rows) {
    // Judge a template only against the time it has existed; before that it was not "quiet", it
    // was absent.
    const start = Math.max(lookbackStart, Number(candidate.first_ms));
    const counts = byTemplate.get(candidate.template_id) ?? new Map<number, number>();
    const series: number[] = [];
    for (let t = start; t < minuteMs; t += MINUTE_MS) series.push(counts.get(t) ?? 0);

    const result = evaluateSpike(series, candidate.count, {
      alpha: config.rateEwmaAlpha,
      zThreshold: config.rateZThreshold,
      minCount: config.rateMinCount,
      minHistory: config.rateMinHistoryMinutes,
    });
    if (!result.isSpike) continue;

    const outcome = await recordSpike(
      pool,
      projectId,
      candidate.template_id,
      minuteMs,
      result.z,
      now,
      config,
    );
    if (outcome === "created") spikesCreated++;
    else spikesExtended++;
  }
  return { spikesCreated, spikesExtended };
}

/** Extends the template's ongoing spike if there is one, otherwise starts a new anomaly. */
async function recordSpike(
  pool: Pool,
  projectId: string,
  templateId: string,
  minuteMs: number,
  z: number,
  now: Date,
  config: DetectorConfig,
): Promise<"created" | "extended"> {
  const extended = await pool.query(
    `UPDATE anomalies SET window_end = GREATEST(window_end, to_timestamp(($3::double precision + 60000) / 1000)),
                          score = GREATEST(score, $4)
     WHERE id = (
       SELECT id FROM anomalies
       WHERE template_id = $1 AND type = 'rate_spike'
         AND window_end >= to_timestamp(($3::double precision - $2::double precision * 60000) / 1000)
       ORDER BY window_end DESC LIMIT 1
     )`,
    [templateId, config.spikeMergeGapMinutes, minuteMs, z],
  );
  if ((extended.rowCount ?? 0) > 0) return "extended";

  await pool.query(
    `INSERT INTO anomalies (project_id, template_id, type, detected_at, score, window_start, window_end)
     VALUES ($1, $2, 'rate_spike', $3, $4, to_timestamp($5::double precision / 1000),
             to_timestamp(($5::double precision + 60000) / 1000))`,
    [projectId, templateId, now.toISOString(), z, minuteMs],
  );
  return "created";
}

export interface RunSummary extends DetectionSummary {
  projects: number;
  failedProjects: number;
}

/** Runs the detector for every project that has templates; one failing project does not stop the rest. */
export async function detectAll(
  pool: Pool,
  now: Date,
  config: DetectorConfig,
  onError: (projectId: string, error: unknown) => void = () => undefined,
): Promise<RunSummary> {
  const projects = await pool.query<{ project_id: string }>(
    "SELECT DISTINCT project_id FROM log_templates",
  );
  const total: RunSummary = {
    projects: projects.rows.length,
    failedProjects: 0,
    newTemplates: 0,
    spikesCreated: 0,
    spikesExtended: 0,
  };
  for (const { project_id: projectId } of projects.rows) {
    try {
      const summary = await detectProject(pool, projectId, now, config);
      total.newTemplates += summary.newTemplates;
      total.spikesCreated += summary.spikesCreated;
      total.spikesExtended += summary.spikesExtended;
    } catch (error) {
      total.failedProjects++;
      onError(projectId, error);
    }
  }
  return total;
}
