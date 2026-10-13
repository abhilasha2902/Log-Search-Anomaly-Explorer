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

Monorepo (npm workspaces): `apps/api` (Node 22, Express, TypeScript), `apps/web`
(React + Vite + TypeScript), `packages/loggen`, `packages/eval`, plus `docs/`.

PostgreSQL 16 + pgvector, node-pg-migrate, `pg`. Zod, Pino, Vitest + Supertest,
fast-check, Playwright, autocannon, ESLint + Prettier. Embeddings via
Transformers.js (`all-MiniLM-L6-v2`). LLM via Ollama, run locally. CI on GitHub
Actions with a pgvector Postgres service container.

Free and open-source only — no paid APIs, no cloud LLMs.

## Status

Tracked in [`docs/PROGRESS.md`](docs/PROGRESS.md). Currently: Phase 3 (template mining and anomaly detection) built on branch `phase-3-templates`.

## How to run

Filled in as each phase lands. Everything below is PowerShell, with Docker Desktop running.

```powershell
npm install
Copy-Item .env.example .env              # first time only; local-only defaults, no real secrets
docker compose up -d --wait              # Postgres + pgvector; blocks until its healthcheck passes
npm run migrate:up -w apps/api
npm run verify                           # lint + typecheck + tests (needs the database above)
```

Start the API (http://localhost:3000) and the web app (http://localhost:5173) in two terminals:

```powershell
npm run dev -w apps/api
npm run dev -w apps/web
```

In development the browser only talks to the Vite server, which forwards `/api/*` to the API.
That keeps the login cookie same-origin, so no extra cookie or CORS settings are needed.

### Try the explorer with sample data

1. Open http://localhost:5173, create an account, and create a project in the page header.
2. Create an API key, generate synthetic logs with loggen, and ingest them (PowerShell; use the
   email and password you registered with):

```powershell
$cred = @{ email = "you@example.com"; password = "your-password" } | ConvertTo-Json
Invoke-RestMethod http://localhost:3000/auth/login -Method Post -ContentType application/json -Body $cred -SessionVariable session | Out-Null
$project = Invoke-RestMethod http://localhost:3000/projects -WebSession $session   # pick your project (use $project[0] if several)
$key = (Invoke-RestMethod "http://localhost:3000/projects/$($project.id)/api-keys" -Method Post -WebSession $session).key

npx tsx packages/loggen/src/cli.ts --seed 42 --count 5000 --out logs.json --truth truth.json
$events = Get-Content logs.json -Raw | ConvertFrom-Json
for ($i = 0; $i -lt $events.Count; $i += 1000) {
  $batch = $events[$i..([Math]::Min($i + 999, $events.Count - 1))]
  Invoke-RestMethod http://localhost:3000/ingest -Method Post -Headers @{ "x-api-key" = $key } `
    -ContentType application/json -Body (ConvertTo-Json -InputObject @($batch) -Depth 5) | Out-Null
}
```

The generated events carry fixed timestamps from 2026-01-01 00:00 to 01:00 UTC, so choose
**Custom range** with From `2026-01-01T00:00Z` and To `2026-01-01T01:01Z` (`to` is exclusive).
The "Any time" and "Last N" options will not show them, and the chart defaults to the last hour.
`logs.json` and `truth.json` are generated files; do not commit them.

### Templates and anomalies (Phase 3)

Ingestion groups every line into a template (`GET /orders/<*> <*>`) and counts it per minute.
Templates are on the **Templates** page; anomalies on the **Anomalies** page.

Anomalies are found by a separate worker process. In a third terminal:

```powershell
npm run worker -w apps/api      # checks every minute (WORKER_INTERVAL_MS); Ctrl+C to stop
```

The worker only judges the last minute of data, so it will not report anything for the
2026-01-01 sample data above. To see anomalies for that sample, replay the detector over it
(use your project id, e.g. `$project[0].id` from the snippet above):

```powershell
npm run detect:replay -w apps/api -- --project $project[0].id
```

Detector thresholds are environment variables (see `.env.example`): `RATE_Z_THRESHOLD`,
`RATE_MIN_COUNT`, `RATE_MIN_HISTORY_MINUTES`, `RATE_EWMA_ALPHA`, `RATE_LOOKBACK_MINUTES`,
`SPIKE_MERGE_GAP_MINUTES`, `NEW_TEMPLATE_WINDOW_MINUTES`, `SERVICE_WARMUP_MINUTES`,
`WORKER_INTERVAL_MS`.

### Search syntax

```text
timeout                      a word (whole words only, case-insensitive)
"disk full"                  an exact phrase
-retry                       exclude a word (also -"a phrase")
level:error  service:api     filters; repeat level: or service: to match either
from:15m  to:2024-05-01      time bounds: ISO-8601 (UTC) or 30s / 15m / 2h / 7d before now;
                             from is inclusive, to is exclusive, ranges are capped at 30 days
```

Example: `level:error service:payments timeout -retry from:1h`.

## Known limitations

- **Search matches whole words only.** It uses Postgres full-text search with the `simple`
  configuration: no stemming and no substring, partial-word or typo-tolerant matching. `timeo`
  will not find `timeout`, and `timeout` will not find `timeouts`.
- Punctuation is treated as a word separator, so `user_id=42` searches for the words `user_id`
  and `42`.

- **Templates are approximate.** Drain groups by word count and first word; a variable first word
  (`alice logged in`) makes one template per distinct word. See docs/design-decisions.md.
- **Ingest is slower with template mining** than before Phase 3 (measured in docs/performance.md),
  and the template parser lives in the memory of a single API process.
- **Anomaly detection sees messages and their rates only.** A latency increase that does not change
  any message is not detected. Late-arriving events and worker downtime are not re-evaluated.
- The anomaly evaluation uses loggen's synthetic incidents (large and clean); it does not show how the
  detector behaves on real traffic.

## License

[MIT](LICENSE)
