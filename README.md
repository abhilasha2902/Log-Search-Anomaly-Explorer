# Log Search & Anomaly Explorer

## Problem statement

Teams running small services accumulate logs with no good way to search them, notice
when something new or unusual appears, or quickly understand what an incident was
about. This project is a self-hosted, free/open-source log search and anomaly
explorer: it ingests structured logs, makes them searchable, mines them into
templates, flags anomalies (new templates, rate spikes), surfaces similar past
incidents, and uses a local LLM to write grounded incident summaries that cite the
actual log lines they're based on.

## Planned features

- Structured log ingestion API, stored in PostgreSQL
- Search syntax over logs (`level:error service:api timeout`)
- Drain-style template mining to group similar log lines
- Anomaly detection: new templates, rate spikes
- Similar-incident lookup via pgvector embeddings
- Threshold-based alerts
- Local LLM (Ollama) incident summaries, grounded in retrieved logs with cited line IDs
- React dashboard for search, anomalies, alerts, and summaries
- Eval harness measuring the AI parts

## Stack

Monorepo (npm workspaces): `apps/api` (Node 20, Express, TypeScript), `apps/web`
(React + Vite + TypeScript), `packages/loggen`, `packages/eval`, plus `docs/`.

PostgreSQL 16 + pgvector, node-pg-migrate, `pg`. Zod, Pino, Vitest + Supertest,
fast-check, Playwright, autocannon, ESLint + Prettier. Embeddings via
Transformers.js (`all-MiniLM-L6-v2`). LLM via Ollama, run locally. CI on GitHub
Actions with a pgvector Postgres service container.

Free and open-source only — no paid APIs, no cloud LLMs.

## Status

Tracked in [`docs/PROGRESS.md`](docs/PROGRESS.md). Currently: Phase 0 (setup).

## How to run

Filled in as each phase lands. Phase 0 provides a `GET /health` endpoint backed by
a Dockerized Postgres instance — see `docs/plans/phase-0.md` for exact commands.

Setup (PowerShell, Docker Desktop running):

```powershell
npm install
docker compose up -d --wait   # starts Postgres and blocks until its healthcheck passes
npm run migrate:up -w apps/api
npm run verify
```

`--wait` returns only once `pg_isready` reports the database is accepting
connections, so the migration step never races a still-starting Postgres.

## Known limitations

- **Search matches whole words only.** It uses Postgres full-text search with the `simple`
  configuration: no stemming and no substring, partial-word or typo-tolerant matching. `timeo`
  will not find `timeout`, and `timeout` will not find `timeouts`.
- Punctuation is treated as a word separator, so `user_id=42` searches for the words `user_id`
  and `42`.

## License

[MIT](LICENSE)
