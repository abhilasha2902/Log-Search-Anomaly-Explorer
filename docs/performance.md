# Performance

Machine-specific measurement of `POST /ingest`; not a general benchmark.
API and Postgres (Docker) share this machine with the load generator.

- CPU: AMD Ryzen 5 5500U with Radeon Graphics (12 logical cores)
- RAM: 5.8 GiB
- OS: Windows_NT 10.0.26200, Node v26.1.0
- Run at: 2026-10-13T09:45:34.944Z
- Command: `npm run loadtest -w apps/api` (10 connections, 10s, 500 events per request)

```
┌─────────┬───────┬───────┬────────┬────────┬──────────┬─────────┬────────┐
│ Stat    │ 2.5%  │ 50%   │ 97.5%  │ 99%    │ Avg      │ Stdev   │ Max    │
├─────────┼───────┼───────┼────────┼────────┼──────────┼─────────┼────────┤
│ Latency │ 57 ms │ 86 ms │ 214 ms │ 236 ms │ 98.92 ms │ 48.5 ms │ 543 ms │
└─────────┴───────┴───────┴────────┴────────┴──────────┴─────────┴────────┘
┌───────────┬───────┬───────┬─────────┬─────────┬─────────┬─────────┬─────────┐
│ Stat      │ 1%    │ 2.5%  │ 50%     │ 97.5%   │ Avg     │ Stdev   │ Min     │
├───────────┼───────┼───────┼─────────┼─────────┼─────────┼─────────┼─────────┤
│ Req/Sec   │ 50    │ 50    │ 103     │ 127     │ 101     │ 24.8    │ 50      │
├───────────┼───────┼───────┼─────────┼─────────┼─────────┼─────────┼─────────┤
│ Bytes/Sec │ 21 kB │ 21 kB │ 43.2 kB │ 53.2 kB │ 42.3 kB │ 10.4 kB │ 20.9 kB │
└───────────┴───────┴───────┴─────────┴─────────┴─────────┴─────────┴─────────┘

Req/Bytes counts sampled once per second.
# of samples: 10

1k requests in 10.1s, 423 kB read
```

## Phase 2 - search timings (`GET /projects/:id/logs`)

Machine-specific measurement of the SQL behind the search endpoint; not a general benchmark.
Postgres runs in Docker on the same laptop as the scripts, and every number is **warm-cache**
(1 warm-up run, then 3 measured runs per case; the table shows the median of the 3).

- Volume: 250,000 rows in one project (`perf-seed`), loggen seed 42, spanning 10,080 minutes (7 days), ending at seeding time
- CPU: AMD Ryzen 5 5500U with Radeon Graphics (12 logical cores)
- RAM: 5.8 GiB
- OS: Windows_NT 10.0.26200, Node v26.1.0, Postgres 16 (`pgvector/pgvector:pg16`)
- Indexes on `log_events` during both runs: `idx_log_events_attrs_gin`, `idx_log_events_project_service_level_ts`, `idx_log_events_project_ts`, `idx_log_events_search_vector`, `log_events_pkey`
- Page size: 50 (the script asks for 51 rows, like the endpoint)

Commands:

```powershell
docker compose up -d --wait
npm run migrate:up -w apps/api
npx tsx apps/api/src/scripts/seedSearchData.ts --rows 250000 --seed 42
npx tsx apps/api/src/scripts/explainSearch.ts | Tee-Object -FilePath explain-before.txt
# then ANALYZE log_events; was run in psql, and the same script again:
npx tsx apps/api/src/scripts/explainSearch.ts | Tee-Object -FilePath explain-after.txt
```

The seed script already runs `ANALYZE` once when it finishes. The only thing that changed
between the two runs is one more manual `ANALYZE log_events;`. **No index was added**, so
"before" and "after" below mean before and after that extra `ANALYZE`, not before and after
an index.

Words were chosen from the data by the script (`ts_stat`): the most frequent word was `u`
(in 62,636 rows), the rarest `100004` (in 1 row).

| Case | Query                                | Plan (both runs)                                                                                  | Before (ms) | After (ms) |
| ---- | ------------------------------------ | ------------------------------------------------------------------------------------------------- | ----------- | ---------- |
| a    | newest page, no filter               | Index Scan `idx_log_events_project_ts` + Incremental Sort                                         | 0.19        | 0.17       |
| b    | `level:error service:api`            | same; filter removes 8,301 rows                                                                   | 1.99        | 1.62       |
| c    | common word `u`                      | same; filter removes 151 rows                                                                     | 0.16        | 0.15       |
| d    | rare word `100004`                   | Bitmap Index Scan `idx_log_events_search_vector` + Bitmap Heap Scan + Sort                        | 0.06        | 0.05       |
| e    | phrase `"u query"` (matches nothing) | Index Scan `idx_log_events_project_ts` + Incremental Sort; filter removes 250,000 rows, returns 0 | 63.7        | 64.3       |
| f    | negation only `-u`                   | same as a; filter removes 23 rows                                                                 | 0.17        | 0.21       |
| g    | deep page (cursor 80% down)          | same as a; filter removes 1 row                                                                   | 0.12        | 0.18       |
| h    | 1-hour range at the newest events    | same as a                                                                                         | 0.19        | 0.13       |
| i    | common word + `level:error`          | same as a; filter removes 9,992 rows                                                              | 2.09        | 2.17       |

Reading the numbers:

- The plan did not change in any case. The differences between the two columns are
  run-to-run noise (for example, the three measured runs of case e were 62.0-66.1 ms before
  and 62.4-72.6 ms after), **not improvements**.
- Cases a-c and f-i read a few dozen rows and stop: `idx_log_events_project_ts` returns rows in
  `ts DESC` order and the endpoint's `LIMIT` ends the scan early. The `id DESC` tie-break is
  handled by a small Incremental Sort (about 29 kB, quicksort).
- Case d (a rare word) uses the GIN index on `search_vector`, as intended.
- **Case e is the worst case recorded: about 64 ms at this volume.** The planner expected
  roughly 15,000 matches, so it walked the project/time index in order, hoping to find 51
  matches quickly. None existed, so it read and discarded all 250,000 rows. The extra
  `ANALYZE` moved its row estimate only from 15,291 to 15,387 (actual: 0) and did not change
  the plan.
- No 1,000,000-row run was done; behaviour and timings at that size are unknown.

<!-- loadtest:start -->

## Phase 3 - ingest with template mining (`POST /ingest`)

Same load test as above, re-run after ingestion started grouping lines into templates and
updating per-template counts in the same request. Machine-specific; not a general benchmark.

- CPU: AMD Ryzen 5 5500U with Radeon Graphics (12 logical cores)
- RAM: 5.8 GiB
- OS: Windows_NT 10.0.26200, Node v26.1.0
- Run at: 2026-10-13T16:51:26.039Z
- Command: `npm run loadtest -w apps/api` (10 connections, 10s, 500 events per request, one project)

```
┌─────────┬───────┬────────┬─────────┬─────────┬───────────┬───────────┬─────────┐
│ Stat    │ 2.5%  │ 50%    │ 97.5%   │ 99%     │ Avg       │ Stdev     │ Max     │
├─────────┼───────┼────────┼─────────┼─────────┼───────────┼───────────┼─────────┤
│ Latency │ 90 ms │ 283 ms │ 1522 ms │ 1887 ms │ 417.39 ms │ 391.66 ms │ 2696 ms │
└─────────┴───────┴────────┴─────────┴─────────┴───────────┴───────────┴─────────┘
┌───────────┬─────────┬─────────┬─────────┬───────┬─────────┬─────────┬─────────┐
│ Stat      │ 1%      │ 2.5%    │ 50%     │ 97.5% │ Avg     │ Stdev   │ Min     │
├───────────┼─────────┼─────────┼─────────┼───────┼─────────┼─────────┼─────────┤
│ Req/Sec   │ 15      │ 15      │ 25      │ 31    │ 23.3    │ 4.74    │ 15      │
├───────────┼─────────┼─────────┼─────────┼───────┼─────────┼─────────┼─────────┤
│ Bytes/Sec │ 6.29 kB │ 6.29 kB │ 10.5 kB │ 13 kB │ 9.76 kB │ 1.98 kB │ 6.29 kB │
└───────────┴─────────┴─────────┴─────────┴───────┴─────────┴─────────┴─────────┘

Req/Bytes counts sampled once per second.
# of samples: 10

243 requests in 10.06s, 97.6 kB read
```

<!-- loadtest:end -->

### Phase 3 comparison (same machine, same session)

To separate Phase 3's cost from the Phase 2 `search_vector` index added since the first run at the
top of this file, the same load test was run once more against the Phase 2 ingest handler
(`apps/api/src/ingest/routes.ts` from `main`, no template mining) in the same session, with
`LOADTEST_NO_WRITE=1` so only the console output was kept.

| Run (10 connections, 10 s, 500 events/request) | Req/Sec avg | Req/Sec median | Latency p50 | Latency p97.5 | Latency avg |
| ---------------------------------------------- | ----------- | -------------- | ----------- | ------------- | ----------- |
| Phase 1 handler, first run (top of this file)  | 101         | 103            | 86 ms       | 214 ms        | 98.92 ms    |
| Phase 2 handler (no mining), this session      | 68.5        | 67             | 138 ms      | 269 ms        | 145.66 ms   |
| Phase 3 handler (template mining, above)       | 23.3        | 25             | 283 ms      | 1522 ms       | 417.39 ms   |

Each row is one 10-second run, not a repeated average, so differences of a few percent are noise.
The Phase 3 handler was about 3x slower than the Phase 2 handler in this setup. Not measured: where
the time goes. A likely contributor is that all ten connections write to the same ~13 template rows
(row locks, plus the foreign-key check on `log_events.template_id`), because the load test sends one
project's traffic; spreading load over many projects was not tested.
