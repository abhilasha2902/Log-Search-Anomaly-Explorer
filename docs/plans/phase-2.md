# Phase 2 — Search (plan)

## Context

Phase 1 stores logs (`log_events`) behind auth + ingestion. Phase 2 makes them searchable: Postgres full-text search, a safe query parser, a paginated search API, a React explorer, and a events-per-minute chart. No templates/anomalies/AI yet (Phases 3+).

Pre-flight checked: `main` clean, 0 ahead/behind `origin/main`, `gh` logged in as `abhilasha2902` (scopes: repo, workflow). Phase 2 goes on branch `phase-2-search`.

Existing code to reuse: `requireAuth` (`apps/api/src/auth/middleware.ts`), the `assertOwnedProject` pattern (`apps/api/src/projects/routes.ts`; non-owned → **404**, I keep that), Zod 422 error shape (`{error:"invalid_body", details}`), `createApp(pool)` wiring (`app.ts`), `logEventSchema` level enum (`debug|info|warn|error`), loggen (`packages/loggen`), `apps/api/src/loadtest.ts` + `docs/performance.md` (append a Phase 2 section, don't overwrite), CORS already `credentials: true` with `CORS_ORIGIN`.

## Pre-flight

```powershell
git checkout main; git pull origin main; git status      # clean, up to date
git checkout -b phase-2-search
docker compose up -d --wait   # healthcheck commit 9f61eb9 confirmed on main/origin
```

## Decisions already made (all open questions resolved)

- Web state: URL search params + plain fetch hook, no TanStack Query. Chart: uPlot in one small wrapper component, mocked in jsdom tests.
- Repeated `level:` tokens are OR'd. No time bounds is allowed (cursor + limit keep it bounded). Search `statement_timeout` 5s, configurable via env. `limit` over max → 422.
- Seed volume: start with 250,000 rows; run 1,000,000 only if the laptop copes. `docs/performance.md` records whichever volume was actually run.

- Whole-word matching only (`simple` config, no stemming, no stop words, no substring/typo search). Documented limitation.
- Cursor = opaque base64url of `{ts,id}`; Zod-validated on decode; garbage → 422.
- Time values: ISO-8601 (date or timestamp, **UTC**) or relative `Ns|Nm|Nh|Nd` (`15m`, `2h`, `7d`). Same grammar for `from:/to:` tokens and `from`/`to` URL params. Converted to absolute UTC **before** SQL. `from` inclusive, `to` exclusive. `now` is injected (read once per request) so the parser stays pure. Invalid value or `from >= to` → 422. Relative offset and `to - from` capped by `SEARCH_MAX_RANGE_DAYS` (default 30); over cap → 422. Only one bound given: other side is open (`from` only → up to now; `to` only → no lower bound), cap applies only to relative offsets then.

## Step 2.1 — Migration: `search_vector`

**Files:** `apps/api/migrations/006_log_events_search_vector.js`
- `ALTER TABLE log_events ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', message)) STORED;` (via `pgm.sql`)
- `CREATE INDEX idx_log_events_search_vector ON log_events USING gin (search_vector);`
- `down`: drop index, drop column.

Note: adding a stored generated column rewrites the table (fine now; mention in design-decisions for large tables).

**Verify:**
```powershell
npm run migrate:up -w apps/api
docker exec logexplorerproject-postgres-1 psql -U loguser -d logexplorer -c "\d log_events"
npm run migrate:down -w apps/api; npm run migrate:up -w apps/api     # reversible
```
Add one integration test: insert a row, `search_vector @@ plainto_tsquery('simple','timeout')` matches.

**Commit:** `feat: add generated search_vector column and GIN index to log_events`

## Step 2.2 — Query parser (pure TS, no DB)

**Files:** `apps/api/src/search/{parseQuery,parseTime,types}.ts`, `parseQuery.test.ts`, `parseQuery.property.test.ts`
```powershell
npm install -D -w apps/api fast-check
```
- `tokenize(q)` → free words, `"quoted phrase"`, `-negated` (word or phrase), `key:value` for `level`, `service`, `from`, `to`. Unknown `key:value` is treated as free text (so `error:500` still searches). Unterminated quote: treat rest as phrase. Max query length 500 chars and max 20 tokens → else 422.
- `parseQuery(q, { now, startParam })` → `{ where: string[], params: unknown[], filters: {level?, service?, from?, to?} }`. Fragments use only `$n` placeholders with a caller-supplied starting index; the SQL text is built from **constant strings only** — user input is never concatenated, only bound.
  - free word → `search_vector @@ plainto_tsquery('simple', $n)`; phrase → `phraseto_tsquery('simple', $n)`; negation → `NOT (...)`.
  - `level:` validated against the enum (invalid → 422). Repeated `level:`/`service:` tokens are OR'd (`= ANY($n)`); explicit `level=`/`service=` URL params are AND'd with the `q` tokens.
  - `from/to` handled by `parseTime(value, now, cap)` as decided above.
- Tests: tokenizer cases; each filter; negation + phrases; time (ISO date, ISO timestamp, `15m/2h/7d`, `0m`, `-5m`, `99999d`, `2024-13-45`, garbage, from ≥ to); **injection**: `'; DROP TABLE log_events;--`, `" OR 1=1 --`, `level:error' OR '1'='1`, `service:a);--`, `from:1d;DROP`, null bytes, very long strings → assert the SQL string never contains user text and the text appears only in `params`. fast-check properties: (1) for any string, `parseQuery` never throws anything but a typed `QueryError`; (2) number of `$n` in `where` equals `params.length` and indices are contiguous; (3) `where` is built only from a fixed whitelist of fragments (regex over allowed pieces); (4) parse is deterministic for the same `now`.

**Verify:** `npm run test -w apps/api` (no DB needed for these files), `npm run verify`.

**Commit:** `feat: add pure search query parser with parameterized SQL output and tests`

## Step 2.3 — `GET /projects/:id/logs`

**Files:** `apps/api/src/search/{routes,cursor,schema}.ts`, `search.test.ts`; wire in `app.ts`; `apps/api/src/scripts/seedSearchData.ts`, `apps/api/src/scripts/explainSearch.ts`; `docs/performance.md` (append).
- Zod query schema: `:id` is `z.string().uuid()` (avoids a Postgres `22P02` 500), `q` ≤ 500 chars, `level` enum, `service` ≤ 100, `from/to` via `parseTime`, `cursor` opaque string, `limit` int default **50**, max **200** (over max → 422, not silently clamped).
- Order: `ORDER BY ts DESC, id DESC`. Keyset predicate `(ts, id) < ($ts, $id)`. Query `limit+1` rows to decide `nextCursor`; response `{ items:[{id,ts,service,level,message,attrs}], nextCursor: string|null }`. No total count (expensive and not needed).
- Always `WHERE project_id = $1` first. Auth: `requireAuth`, then ownership check (404 if not owned); no data query runs before ownership passes.
- Express 4 does not catch async throws: wrap handlers so DB errors return a 500 `{error:"internal"}` instead of hanging (check whether a helper already exists; add a tiny `asyncHandler` if not).
- Tests (Supertest, real DB): returns only own project's rows; other user → 404; unauthenticated → 401; filters combine; phrase/negation; cursor walk returns every row exactly once with no duplicates, including rows sharing the same `ts`; bad cursor/limit/time → 422; `limit=201` → 422.
- **Performance (numbers only from real runs):** `seedSearchData.ts` uses loggen to insert a configurable volume (suggest 1,000,000 rows, in batches ≤1000 through the same bulk-insert path). `explainSearch.ts` runs `EXPLAIN (ANALYZE, BUFFERS)` for: (a) newest page, no filter; (b) `level:error service:api`; (c) one common word; (d) one rare word; (e) phrase; (f) negation only; (g) deep page via cursor; (h) 1-hour time range. Run **before** adding any index, then add an index only where a plan shows a Seq Scan/slow sort (candidate: `(project_id, ts DESC, id DESC)` to match the sort exactly), re-run, and record before/after timings + machine specs + exact commands in `docs/performance.md`. If no index is needed, the doc says so.

```powershell
npm run migrate:up -w apps/api
npx tsx apps/api/src/scripts/seedSearchData.ts --rows 250000 --seed 42   # 1000000 only if the laptop copes
npx tsx apps/api/src/scripts/explainSearch.ts | Tee-Object -FilePath explain-before.txt
# add index migration (007) only if needed, then:
npm run migrate:up -w apps/api
npx tsx apps/api/src/scripts/explainSearch.ts | Tee-Object -FilePath explain-after.txt
```
I write the scripts; **you run them** and paste the output, I fill `docs/performance.md`.

**Commit:** `feat: add GET /projects/:id/logs with cursor pagination and search` (+ `perf: add index for log search ordering` and `docs: record Phase 2 search timings` only if applicable)

## Step 2.4 — React explorer

**Dependencies:**
```powershell
npm install -w apps/web react-router-dom
npm install -D -w apps/web @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom
```
**Config:** `apps/web/vite.config.ts` — dev **proxy** `/api` → API origin (port from `.env.example`), so browser requests are same-origin and the `httpOnly` `SameSite=Lax` cookie works without cross-site tricks; the API client uses `credentials: "include"` anyway, and `CORS_ORIGIN=http://localhost:5173` stays set for direct calls. Vitest `environment: "jsdom"` + a setup file for jest-dom.
**Files:** `src/api/client.ts` (typed `fetch` wrapper, 401 → redirect to login, Zod-free, small), `src/auth/{LoginPage,RegisterPage,useAuth}.tsx`, `src/projects/ProjectSwitcher.tsx`, `src/explorer/{ExplorerPage,SearchBar,Filters,TimeRange,ResultsTable,LevelBadge,RowDrawer,LoadMore}.tsx`, `*.test.tsx`.
- Needs a tiny API addition: `GET /auth/me`-style check (existing `/me` returns `{id}`; reuse it for session detection — no new endpoint).
- State: **URL search params are the source of truth** for `q, level, service, from, to, project` (shareable, back button works); plain `useState` for loaded rows/drawer; a small `useLogs` hook; no Redux, no TanStack Query.
- Pagination: "Load more" button using `nextCursor` (not page numbers — keyset pagination can't jump to page N).
- Drawer: opens on row click, closes on Esc/close button, focus returns to the row, shows full message + pretty `attrs`. Level badge = text + color (not color alone). Messages rendered as text (React escapes; no `dangerouslySetInnerHTML`).
- Tests (RTL, `fetch` mocked at the client boundary): login success/failure, project switcher, typing a query updates URL and calls API, filters, results render, badge per level, drawer open/close with keyboard, load-more appends and hides at `nextCursor: null`, empty and error states.

**Verify:**
```powershell
npm run test -w apps/web
npm run dev -w apps/api      # terminal 1
npm run dev -w apps/web      # terminal 2 → http://localhost:5173
```
Manual: register → create project → ingest loggen data (existing CLI/loadtest) → search `level:error service:api timeout`, a `"quoted phrase"`, `-noise`, `from:15m`, scroll with Load more, open drawer. Confirm the cookie is set (DevTools → Application) and refresh keeps you logged in.

- README: add a short "Known limitations" section — search matches whole words only (no stemming, no substring/partial-word or typo-tolerant search; `timeo` won't find `timeout`).

**Commit:** `feat: add React log explorer with auth, filters, results table and detail drawer` (split into 2 commits if large: `feat: add web auth and API client`, then the explorer).

## Step 2.5 — Timeseries endpoint + chart

**Files:** `apps/api/src/search/timeseries.ts` + tests; `apps/web/src/explorer/EventsChart.tsx` + test.
- `GET /projects/:id/stats/timeseries?q&level&service&from&to` reuses `parseQuery` and the same ownership/validation path. SQL: `date_trunc('minute', ts)` + `count(*)` grouped, ordered ascending, filters identical to search. Defaults to last 1h if no `from`; **max range 24h** (1,440 buckets) → else 422. Returns only non-empty buckets `{buckets:[{t, count}]}`; the client fills zero gaps so the server never generates huge series.
- Chart library: **uPlot** (~50 KB, canvas, tiny; fits a single time-series bar chart). Honest trade-off: imperative API, so it's wrapped in one small component and mocked in jsdom tests (jsdom has no canvas). Alternative if you'd rather have declarative React: Recharts (heavier, ~10x the bundle). I recommend uPlot because you asked for lightweight; veto below if you want Recharts.
- Tests: counts per minute match inserted rows; filters apply the same as `/logs`; ownership 404; range > 24h → 422; chart component renders for data and empty state; clicking nothing else (no brush/zoom this phase).

**Commit:** `feat: add events-per-minute timeseries endpoint and explorer chart`

## Docs (final step, `docs:` commit)

`docs/learning/phase-2.md` (plain-language + analogy per CLAUDE rule 9): full-text search and `tsvector`, GIN/inverted index (book index), `simple` config vs stemming, keyset vs offset pagination (bookmark vs "page 500"), query parsing and why bound params stop injection, time bucketing, `EXPLAIN ANALYZE`. `docs/design-decisions.md`: "logout does not revoke JWTs" is **already recorded** from Phase 1 (section "Stateless JWT, no revocation list") — verify it's still there and don't duplicate; add: whole-word only, generated-column rewrite, 404 vs 403, no total count, URL-as-state, uPlot choice. `docs/PROGRESS.md`: tick 2.1–2.5. README "How to run": add search/dev steps (no unmeasured numbers).

**Commit:** `docs: add Phase 2 learning notes, design decisions and progress`

## Security checklist

- [ ] No string-built SQL: parser output is constant fragments + `$n`; user text only in `params` (asserted in unit + property tests).
- [ ] Injection corpus tested in free text, phrases, `level:`, `service:`, `from:`, `to:`, cursor.
- [ ] `level` validated against the enum; `service` length-capped; `:id` is a UUID.
- [ ] Ownership check before any log query; non-owned and nonexistent both → 404 (no existence leak); every log query filters `project_id`.
- [ ] `limit` default 50, hard max 200, over max → 422; `q` ≤ 500 chars / ≤ 20 tokens; time range and relative offset capped; timeseries ≤ 24h.
- [ ] Cursor is validated on decode and only used as bound params; cannot cross projects (project filter always applied).
- [ ] Postgres `statement_timeout` for search queries (e.g. 5s) so a pathological query can't hang the pool.
- [ ] Web: no `dangerouslySetInnerHTML`; cookie stays `httpOnly`; CORS allow-list stays env-driven (never `*`); no secrets in the web bundle; log messages are untrusted text.
- [ ] No sensitive values logged (Pino redaction unchanged; don't log full `q` at info level if it could hold secrets — log length only).

## Design questions

All resolved — see "Decisions already made". Add `SEARCH_STATEMENT_TIMEOUT_MS` (default 5000) and `SEARCH_MAX_RANGE_DAYS` (default 30) to `.env.example` and the CI `env:` block. `seedSearchData.ts` defaults to `--rows 250000`.

## Risks

- Generated-column migration rewrites the table; only safe at this scale (documented).
- `simple` config: no stemming, so `timeout` ≠ `timeouts`; `plainto_tsquery` ignores punctuation, so `user_id=42` becomes tokens — documented limitation.
- Planner may prefer the FTS GIN index over the ordering index for rare words and the ordering index for common ones; the EXPLAIN pass decides — don't pre-optimize.
- Express 4 async error handling; a missed `await` could hang requests (covered by a test that forces a DB error).
- Seeding 1M rows on a laptop may take minutes and disk space; numbers are machine-specific and labelled so.
- Vite 8 / TS 6 / React 19 / Vitest 5 are new; RTL + jsdom compatibility may need version pinning.
- uPlot in jsdom (no canvas) needs a mock; Recharts is the fallback.
- Web scope creep (routing, auth UX); keep to the listed screens.

## Definition of done

- [ ] Migration 006 up/down clean; `search_vector` GIN index exists
- [ ] Parser pure, unit + property tests (incl. injection) pass
- [ ] `/logs` validated, owner-only, cursor walk returns every row once (tested)
- [ ] `/stats/timeseries` tested incl. filters, ownership, 24h cap
- [ ] `docs/performance.md` has real before/after EXPLAIN timings, machine specs and exact commands (or states no index was needed)
- [ ] Web explorer works end-to-end in the browser with the Vite dev server (cookie auth, CORS verified); RTL tests pass
- [ ] `npm run verify` passes; CI green with migration 006 (+007 if added)
- [ ] `docs/learning/phase-2.md`, `design-decisions.md`, `PROGRESS.md`, README updated; no unmeasured numbers anywhere
- [ ] Branch `phase-2-search` pushed; PR link ready for you to open and merge after CI is green. Phase 3 not started.
