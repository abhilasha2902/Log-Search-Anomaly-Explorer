import "../env.js";
import os from "node:os";
import { createPool } from "../db.js";
import { encodeCursor } from "../search/cursor.js";
import { parseQuery } from "../search/parseQuery.js";
import { buildLogsSql } from "../search/queries.js";
import type { ParseOptions } from "../search/types.js";

// Runs EXPLAIN (ANALYZE, BUFFERS) on the exact SQL the /logs endpoint builds, against
// the project created by seedSearchData.ts. Prints machine info, then for each case
// the execution times of 1 warm-up + 3 measured runs and the plan of the last run.
//
//   npx tsx apps/api/src/scripts/explainSearch.ts

const WARM_UP_RUNS = 1;
const MEASURED_RUNS = 3;
const PAGE_SIZE = 50;

const pool = createPool();

interface Case {
  label: string;
  q: string;
  extra?: Partial<ParseOptions>;
  cursor?: { t: string; i: string };
}

async function executionTime(
  sql: string,
  params: unknown[],
): Promise<{ ms: number; plan: string }> {
  const result = await pool.query<{ "QUERY PLAN": string }>(
    `EXPLAIN (ANALYZE, BUFFERS) ${sql}`,
    params,
  );
  const plan = result.rows.map((r) => r["QUERY PLAN"]).join("\n");
  const match = /Execution Time: ([\d.]+) ms/.exec(plan);
  return { ms: match ? Number(match[1]) : Number.NaN, plan };
}

async function main(): Promise<void> {
  const project = await pool.query<{ id: string }>(
    `SELECT p.id FROM projects p JOIN users u ON u.id = p.user_id
     WHERE u.email = 'perf-seed@example.com' AND p.name = 'perf-seed'`,
  );
  if (project.rowCount === 0) {
    throw new Error("perf-seed project not found; run seedSearchData.ts first");
  }
  const projectId = project.rows[0].id;

  const stats = await pool.query<{ n: string; max_ts: string; max_ts_iso: string }>(
    `SELECT count(*) AS n, max(ts)::text AS max_ts,
            to_char(max(ts) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS max_ts_iso
     FROM log_events WHERE project_id = $1`,
    [projectId],
  );
  const rowCount = Number(stats.rows[0].n);

  // Pick words from the data itself: most frequent, second most frequent, and rarest.
  const words = await pool.query<{ word: string; ndoc: number }>(
    `SELECT word, ndoc FROM ts_stat('SELECT search_vector FROM log_events') ORDER BY ndoc DESC, word LIMIT 2`,
  );
  const rare = await pool.query<{ word: string; ndoc: number }>(
    `SELECT word, ndoc FROM ts_stat('SELECT search_vector FROM log_events') ORDER BY ndoc ASC, word LIMIT 1`,
  );
  const common = words.rows[0];
  const second = words.rows[1];

  // A cursor 80% of the way down the result list, to measure a deep page.
  const deep = await pool.query<{ ts_iso: string; id: string }>(
    `SELECT to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ts_iso, id
     FROM log_events WHERE project_id = $1 ORDER BY ts DESC, id DESC OFFSET $2 LIMIT 1`,
    [projectId, Math.floor(rowCount * 0.8)],
  );

  const hourEnd = stats.rows[0].max_ts_iso;
  const cases: Case[] = [
    { label: "a) newest page, no filter", q: "" },
    { label: "b) level:error service:api", q: "level:error service:api" },
    { label: `c) common word "${common.word}" (in ${common.ndoc} rows)`, q: common.word },
    {
      label: `d) rare word "${rare.rows[0].word}" (in ${rare.rows[0].ndoc} rows)`,
      q: rare.rows[0].word,
    },
    { label: `e) phrase "${common.word} ${second.word}"`, q: `"${common.word} ${second.word}"` },
    { label: `f) negation only -${common.word}`, q: `-${common.word}` },
    {
      label: "g) deep page (cursor 80% down)",
      q: "",
      cursor: { t: deep.rows[0].ts_iso, i: deep.rows[0].id },
    },
    {
      label: "h) 1-hour range ending at newest event",
      q: "",
      extra: { from: new Date(Date.parse(hourEnd) - 3_600_000).toISOString(), to: hourEnd },
    },
    {
      label: `i) common word + level:error`,
      q: `${common.word} level:error`,
    },
  ];

  const cpu = os.cpus();
  console.log(`# EXPLAIN (ANALYZE, BUFFERS) results`);
  console.log(`CPU: ${cpu[0]?.model} (${cpu.length} logical cores)`);
  console.log(`RAM: ${(os.totalmem() / 1024 ** 3).toFixed(1)} GiB`);
  console.log(`OS: ${os.type()} ${os.release()}, Node ${process.version}`);
  console.log(`Run at: ${new Date().toISOString()}`);
  console.log(`Rows in perf-seed project: ${rowCount}`);
  console.log(
    `Page size: ${PAGE_SIZE}; ${WARM_UP_RUNS} warm-up + ${MEASURED_RUNS} measured runs per case`,
  );
  const indexes = await pool.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'log_events' ORDER BY indexname`,
  );
  console.log(`Indexes on log_events: ${indexes.rows.map((r) => r.indexname).join(", ")}`);

  // maxRangeMs is large only so the script's absolute 1-hour range and cursor
  // pass the parser's guard; the endpoint itself defaults to 30 days.
  const base: ParseOptions = { now: new Date(), maxRangeMs: 30 * 86_400_000 };

  for (const c of cases) {
    const filters = parseQuery(c.q, { ...base, ...c.extra, startParam: 2 });
    const cursor = c.cursor ?? null;
    const { sql, params } = buildLogsSql(projectId, filters, cursor, PAGE_SIZE + 1);

    for (let i = 0; i < WARM_UP_RUNS; i++) await executionTime(sql, params);
    const times: number[] = [];
    let lastPlan = "";
    for (let i = 0; i < MEASURED_RUNS; i++) {
      const { ms, plan } = await executionTime(sql, params);
      times.push(ms);
      lastPlan = plan;
    }
    const sorted = [...times].sort((a, b) => a - b);
    console.log(`\n## ${c.label}`);
    console.log(`q: ${JSON.stringify(c.q)}${cursor ? ` cursor: ${encodeCursor(cursor)}` : ""}`);
    console.log(
      `execution times (ms): ${times.join(", ")}; median ${sorted[Math.floor(sorted.length / 2)]}`,
    );
    console.log(lastPlan);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
