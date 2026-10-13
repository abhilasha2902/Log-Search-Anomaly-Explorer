import "../env.js";
import { createPool } from "../db.js";
import { loadDetectorConfig } from "../detector/config.js";
import { detectProject } from "../detector/detect.js";

/**
 * Runs the anomaly detector over data that is not live (for example loggen's 2026-01-01 sample),
 * one simulated minute at a time, exactly as the worker would have if it had been running then.
 * The worker itself only looks at "now", so old data never produces anomalies there.
 *
 *   npx tsx apps/api/src/scripts/replayDetector.ts --project <project id>
 */
const MINUTE_MS = 60_000;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = args.indexOf("--project");
  const projectId = flag >= 0 ? args[flag + 1] : undefined;
  if (!projectId) {
    console.error("usage: replayDetector.ts --project <project id>");
    process.exit(2);
  }

  const pool = createPool();
  try {
    const range = await pool.query<{ first_ms: string | null; last_ms: string | null }>(
      `SELECT (extract(epoch FROM min(first_seen)) * 1000)::bigint::text AS first_ms,
              (extract(epoch FROM max(last_seen)) * 1000)::bigint::text AS last_ms
       FROM log_templates WHERE project_id = $1`,
      [projectId],
    );
    const { first_ms: first, last_ms: last } = range.rows[0];
    if (first === null || last === null) {
      console.error("no templates for that project; ingest some logs first");
      process.exit(1);
    }

    const config = loadDetectorConfig();
    const total = { newTemplates: 0, spikesCreated: 0, spikesExtended: 0 };
    const startMinute = Math.floor(Number(first) / MINUTE_MS) + 1;
    const endMinute = Math.floor(Number(last) / MINUTE_MS) + 3;
    for (let minute = startMinute; minute <= endMinute; minute++) {
      const summary = await detectProject(
        pool,
        projectId,
        new Date(minute * MINUTE_MS + 5_000),
        config,
      );
      total.newTemplates += summary.newTemplates;
      total.spikesCreated += summary.spikesCreated;
      total.spikesExtended += summary.spikesExtended;
    }
    console.log(
      `replayed ${endMinute - startMinute + 1} minutes: ` +
        `${total.newTemplates} new templates, ${total.spikesCreated} spikes started, ` +
        `${total.spikesExtended} spike minutes added to ongoing spikes`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exit(1);
});
