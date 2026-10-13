import "../env.js";
import { generate } from "@log-explorer/loggen";
import { createPool } from "../db.js";

// Seeds one dedicated "perf-seed" project with loggen data so search timings can be
// measured on a realistic volume. Re-running replaces that project's events only.
//
//   npx tsx apps/api/src/scripts/seedSearchData.ts --rows 250000 --seed 42

const SEED_EMAIL = "perf-seed@example.com";
const BATCH_SIZE = 1000;

function arg(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return value;
}

const rows = arg("rows", 250_000);
const seed = arg("seed", 42);
const durationMinutes = arg("duration-minutes", 7 * 24 * 60);

const pool = createPool();

async function main(): Promise<void> {
  const user = await pool.query<{ id: string }>(
    // password_hash is not a valid argon2 hash, so this account can never log in.
    `INSERT INTO users (email, password_hash) VALUES ($1, 'not-a-real-hash')
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
    [SEED_EMAIL],
  );
  const existing = await pool.query<{ id: string }>(
    "SELECT id FROM projects WHERE user_id = $1 AND name = 'perf-seed'",
    [user.rows[0].id],
  );
  const projectId =
    existing.rows[0]?.id ??
    (
      await pool.query<{ id: string }>(
        "INSERT INTO projects (user_id, name) VALUES ($1, 'perf-seed') RETURNING id",
        [user.rows[0].id],
      )
    ).rows[0].id;

  const deleted = await pool.query("DELETE FROM log_events WHERE project_id = $1", [projectId]);
  console.log(`project ${projectId} (removed ${deleted.rowCount ?? 0} old seed rows)`);

  // End the data at "now" so relative ranges like from:1h are meaningful right after seeding.
  const startTime = new Date(Date.now() - durationMinutes * 60_000);
  const { events } = generate({ seed, count: rows, durationMinutes, startTime });

  const started = Date.now();
  for (let offset = 0; offset < events.length; offset += BATCH_SIZE) {
    const batch = events.slice(offset, offset + BATCH_SIZE);
    const values: string[] = [];
    const params: unknown[] = [];
    batch.forEach((event, i) => {
      const b = i * 6;
      values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`);
      params.push(projectId, event.ts, event.service, event.level, event.message, event.attrs);
    });
    await pool.query(
      `INSERT INTO log_events (project_id, ts, service, level, message, attrs) VALUES ${values.join(", ")}`,
      params,
    );
    if ((offset / BATCH_SIZE) % 25 === 0) {
      console.log(`inserted ${Math.min(offset + BATCH_SIZE, events.length)} / ${events.length}`);
    }
  }
  // Fresh planner statistics, as autovacuum would eventually provide.
  await pool.query("ANALYZE log_events");

  const total = await pool.query<{ n: string }>(
    "SELECT count(*) AS n FROM log_events WHERE project_id = $1",
    [projectId],
  );
  console.log(
    `done: ${total.rows[0].n} rows for project ${projectId} in ${((Date.now() - started) / 1000).toFixed(1)}s ` +
      `(seed ${seed}, span ${durationMinutes} minutes)`,
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
