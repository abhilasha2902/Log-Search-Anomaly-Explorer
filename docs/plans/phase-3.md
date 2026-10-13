# Phase 3 — Template mining and anomaly detection (plan)

## Context

Phases 1–2 store and search logs. Phase 3 groups lines into **templates** (Drain-style), counts
them per minute, and detects two anomaly types: **new templates** and **rate spikes**. No alerts,
embeddings or LLM yet (Phases 4–5).

Branch: `phase-3-templates`, one commit per step, `npm run verify` before each commit.

## Decisions (made; no open questions)

- **Where Drain runs: inline during `POST /ingest`**, not in the worker. Reason: `template_id` and the
  counts are correct the moment a row exists, so the API and tests need no "wait for the worker".
  Cost: extra work per request, which step 3.3 re-measures with the load test.
- **Parser state** is an in-memory tree per (project, service), rebuilt lazily from `log_templates` on
  the first ingest after a restart. One API process only (matches CLAUDE.md). A per-project promise
  queue serialises parse + template persistence so two concurrent requests cannot create the same
  template twice. Known gap: after a restart, a template whose _leading_ tokens had been generalised
  is rebuilt in the wildcard branch and may be duplicated once. Recorded in design-decisions.
- **IDs**: `log_templates.id` is `bigserial` (same as `log_events.id`; pg returns it as a string).
- **Masking** (before tokenising): UUIDs, IPv4 (+port), `0x…` hex, long hex strings containing a digit,
  then every digit run. A masked token becomes `<*>`. Messages are capped at 2000 characters and 64
  tokens for parsing.
- **Drain parameters**: depth 3 (token count + first token), similarity threshold 0.7 (0.5 merged "charge X succeeded" with "charge X retried"), max 100
  children per node; all constructor options so tests can vary them.
- **Detection runs on data time, not wall-clock**: `detect(pool, projectId, now)` takes `now`, so the
  loggen test replays a run minute by minute. The worker passes `new Date()`.
- **New template**: first seen within `NEW_TEMPLATE_WINDOW_MINUTES` of `now`, **and** at least
  `SERVICE_WARMUP_MINUTES` after the service's earliest template (per-service warm-up, so day-one
  noise is not "new"). At most one `new_template` anomaly per template (partial unique index).
- **Rate spike**: for the last complete minute `m`, per template: EWMA mean and EWMA variance over the
  prior `RATE_LOOKBACK_MINUTES` (missing minutes = 0). `z = (count − mean) / max(std, sqrt(mean), 1)`
  (the `sqrt(mean)` floor is the Poisson assumption: counts of independent events have variance ≈
  mean). Flag when `z ≥ RATE_Z_THRESHOLD`, `count ≥ RATE_MIN_COUNT`, and there are at least
  `RATE_MIN_HISTORY_MINUTES` of history. Flagged minutes enter the baseline clipped at the threshold, so
  a long incident does not absorb itself.
- **De-duplication**: a spike within `SPIKE_MERGE_GAP_MINUTES` of an existing spike for the same
  template extends that row (`window_end`, max `score`) instead of inserting a new one.
- **Severity** is derived at read time (not stored): spike z ≥ 6 high, ≥ 4 medium, else low; new
  template by the level of its first example line (error high, warn medium, else low).
- **All thresholds are env vars** with Zod-validated defaults; defaults and measured behaviour are
  documented only after the loggen test has been run.
- **Loggen change (flagged in design-decisions):** the existing `slow_database` incident only raises
  `duration_ms` and leaves every message unchanged, so a detector that looks at templates cannot see
  it by construction. I change that incident to emit `slow query detected` (the existing
  `db_warn_slow_query` template) with the same elevated durations. The existing loggen test
  (duration ≥ 500 during the incident) still holds. Latency-in-attrs anomalies stay out of scope.

## Steps

### 3.1 Migrations

`007_log_templates`, `008_template_minute_counts`, `009_anomalies`, `010_log_events_template_id`.
`log_templates(id, project_id, service, template, first_seen, last_seen, total_count,
example_event_ids bigint[], embedding vector(384) null)`; `template_minute_counts(template_id, minute,
count, PK(template_id, minute))`; `anomalies(id, project_id, template_id, type CHECK, detected_at, score,
window_start, window_end)`; `log_events.template_id` (FK, `ON DELETE SET NULL`) + index
`(template_id, ts DESC)`. Test: schema exists. CI already runs migrations before tests.

### 3.2 Drain parser (pure TS)

`apps/api/src/templates/{mask,drain}.ts`. Unit tests with known inputs/templates; fast-check: same line
→ same template, template count stays small for repetitive input, never throws.

### 3.3 Ingest-time mining

`templates/service.ts` wires the parser to the DB; `/ingest` sets `template_id`, upserts
`log_templates` and `template_minute_counts` in one transaction. Integration tests + failure test.
Re-run `npm run loadtest -w apps/api`; the script now writes its own marked section of
`docs/performance.md` instead of overwriting the file.

### 3.4 Templates API and page

`GET /projects/:id/templates` (counts, last_seen, sparkline of recent minute counts, sample lines) and
`GET /projects/:id/templates/:tid/events` (cursor paginated). React Templates page.

### 3.5 Worker and detector

Pure `detector/{config,ewma,rateSpike}.ts`, DB `detector/detect.ts`, entry `worker.ts`
(`npm run worker -w apps/api`, every `WORKER_INTERVAL_MS`, default 60 s, one failing project does not stop
the loop). Tests: EWMA unit tests, DB tests for dedupe / warm-up / thresholds.

### 3.6 Anomalies API, page, loggen evaluation

`GET /projects/:id/anomalies`, React Anomalies page (timeline + severity). A test replays a loggen run
minute by minute through ingest + `detect` and checks each of the three incidents is found in its
window, and reports the false-positive count.

### Docs

`docs/learning/phase-3.md`, `docs/design-decisions.md`, `docs/PROGRESS.md`, README feature list /
env table. Numbers only from runs that actually happened.

## Out of scope (do not build)

Alerts, embeddings, LLM summaries (Phase 4–5), attribute/latency anomalies, multi-process parser
sharing, template merging UI.
