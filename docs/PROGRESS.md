# Progress

## Phase 0 — Setup

- [x] 0.1 Repo basics (.gitignore, LICENSE, README, docs/)
- [x] 0.2 npm workspaces monorepo (TS strict, ESLint, Prettier, Vitest)
- [x] 0.3 docker-compose Postgres+pgvector, .env.example, DB-backed GET /health
- [x] 0.4 GitHub Actions CI (lint, typecheck, test, pgvector service container)

## Phase 1 — Ingestion and storage

- [x] 1.1 Migrations
- [x] 1.2 Auth
- [x] 1.3 Projects and API keys
- [x] 1.4 Ingestion endpoint
- [x] 1.5 packages/loggen
- [x] 1.6 Integration tests and load test

## Phase 2 — Search

- [x] 2.1 search_vector migration (tsvector + GIN)
- [x] 2.2 Query parser (unit + property tests)
- [x] 2.3 GET /projects/:id/logs with cursor pagination, timings recorded in docs/performance.md
- [x] 2.4 React explorer (auth, project switcher, filters, results, drawer)
- [x] 2.5 Events-per-minute endpoint and chart

Phase 2 is built and verified locally; the branch still needs a PR and green CI.

## Phase 3 — Template mining and anomaly detection

- [x] 3.1 Migrations (log_templates, template_minute_counts, anomalies, log_events.template_id)
- [x] 3.2 Drain-style parser (pure TS) with unit and property tests
- [x] 3.3 Template mining during ingest; ingest load test re-run (docs/performance.md)
- [x] 3.4 Templates API and React Templates page
- [x] 3.5 Worker (`npm run worker -w apps/api`) and detector (new templates, EWMA rate spikes)
- [x] 3.6 Anomalies API and React page; detector checked against loggen ground truth

Phase 3 is built and verified locally; the branch still needs a PR and green CI. Known costs and
gaps are in docs/design-decisions.md (ingest throughput dropped; slow-database scenario needed a
loggen change).

## Phase 4 — Alerts and embeddings

Not started.

## Phase 5 — Grounded AI summaries and evaluation

Not started.

## Phase 6 — Quality and shipping

Not started.
