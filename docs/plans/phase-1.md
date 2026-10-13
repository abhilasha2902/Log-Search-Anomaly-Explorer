# Phase 1 — Ingestion and storage

Goal: durable schema, auth, project/API-key management, a validated ingestion
endpoint, a synthetic log generator with ground truth, and real integration/load
test numbers. No search syntax, template mining, or AI features yet — those start
in later phases.

## Pre-flight

```powershell
git checkout main
git pull origin main
git status            # expect: clean, up to date
git checkout -b phase-1-ingestion
```

## Node version pin

Add `.nvmrc` (content: `20`) and `"engines": { "node": ">=20 <21" }` to root
`package.json`. Local Node is v26 and this doesn't block it (no `engine-strict`
enforced) — it just documents intent and matches what CI actually runs. Decision,
not a question.

## Env vars

Added to `.env.example` (safe local defaults) and to the CI workflow's `env:`
block (test-only values, never real secrets):

| Var | Default (local) | Purpose |
|---|---|---|
| `JWT_SECRET` | `dev-only-change-me-32-bytes-min` | HMAC signing key for auth JWTs |
| `JWT_EXPIRES_IN` | `60m` | Token lifetime |
| `COOKIE_SECURE` | `false` (derived from `NODE_ENV !== "production"` at runtime, but kept as an explicit var for clarity) | Sets the `Secure` cookie flag |
| `CORS_ORIGIN` | `http://localhost:5173` | Comma-separated allow-list for the web app |
| `AUTH_RATE_LIMIT_MAX` | `10` | Max requests per window on `/auth/*` |
| `AUTH_RATE_LIMIT_WINDOW_MS` | `60000` | Window size for auth rate limit |
| `INGEST_RATE_LIMIT_MAX` | `1000` | Max requests per window per API key on `/ingest` |
| `INGEST_RATE_LIMIT_WINDOW_MS` | `60000` | Window size for ingest rate limit |

CI gets its own `JWT_SECRET` test value (same pattern as `DATABASE_URL` today) —
never the same value as any real deployment.

## Security checklist (apply across all steps)

- [ ] All SQL parameterized (no string-built queries) — already a hard rule.
- [ ] Passwords hashed with argon2id, no plaintext/reversible storage.
- [ ] API keys hashed (sha256) before storage; only a short prefix kept in
      plaintext for display/lookup; full key shown exactly once at creation.
- [ ] JWT secret read from env, never hard-coded; length is not validated at
      runtime in Phase 1 (documented as a known gap) but `.env.example` models a
      32+ byte value.
- [ ] Auth cookie: `httpOnly`, `SameSite=Lax`, `Secure` in production.
- [ ] Rate limiting on `/auth/*` (per-IP) and `/ingest` (per-API-key).
- [ ] CORS allow-list from env, never `*`.
- [ ] Pino configured to redact `password`, `authorization`, cookie header, and
      `x-api-key` from logs.
- [ ] Zod validation at every request boundary (auth bodies, project bodies,
      ingest batch).
- [ ] Users can only read/modify their own projects and that project's API keys
      (enforced by filtering every query on `user_id`, not just by hiding UI).

## Step 1.1 — Migrations

**Files:** `apps/api/package.json` (add `node-pg-migrate`, migration scripts),
`apps/api/migrations/`, `apps/api/.pgmigrate.json` or equivalent config pointing
at `DATABASE_URL`.

Migrations, in order:
1. `001_enable_pgvector.js` — `CREATE EXTENSION IF NOT EXISTS vector;`
2. `002_users.js` — `users(id uuid pk default gen_random_uuid(), email text unique not null, password_hash text not null, created_at timestamptz default now())`
3. `003_projects.js` — `projects(id uuid pk default gen_random_uuid(), user_id uuid references users(id), name text not null, created_at timestamptz default now())`
4. `004_api_keys.js` — `api_keys(id uuid pk default gen_random_uuid(), project_id uuid references projects(id), key_hash text not null, key_prefix text not null, revoked_at timestamptz, created_at timestamptz default now())`
5. `005_log_events.js` — `log_events(id bigserial pk, project_id uuid references projects(id), ts timestamptz not null, service text not null, level text not null, message text not null, attrs jsonb default '{}', created_at timestamptz default now())` plus indexes:
   - `idx_log_events_project_ts on log_events(project_id, ts desc)`
   - `idx_log_events_project_service_level_ts on log_events(project_id, service, level, ts desc)`
   - `idx_log_events_attrs_gin on log_events using gin(attrs)`

Uses `pgcrypto` (`gen_random_uuid()`) — add `CREATE EXTENSION IF NOT EXISTS pgcrypto;`
to migration 001 alongside `vector`.

**Commands:**
```powershell
npm install -D -w apps/api node-pg-migrate
npx node-pg-migrate create enable-pgvector -w apps/api   # repeat per migration
docker compose up -d
npx node-pg-migrate up -w apps/api
docker exec -it logexplorerproject-postgres-1 psql -U loguser -d logexplorer -c "\dt"
docker exec -it logexplorerproject-postgres-1 psql -U loguser -d logexplorer -c "\d log_events"
```

**Verify:** all 5 tables + indexes exist; `npx node-pg-migrate down` then `up` again
is idempotent.

**Commit:** `feat: add node-pg-migrate migrations for users, projects, api_keys, log_events`

## Step 1.2 — Auth

**Files:** `apps/api/src/auth/{hash,jwt,middleware,routes}.ts`, `apps/api/src/auth/auth.test.ts`

- `hash.ts`: `hashPassword`/`verifyPassword` using `argon2.hash`/`argon2.verify`
  (argon2id, default params — documented as tunable later).
- `jwt.ts`: sign/verify using `jsonwebtoken`, reads `JWT_SECRET`/`JWT_EXPIRES_IN`
  from env.
- `middleware.ts`: `requireAuth` reads the cookie, verifies JWT, attaches
  `req.user = { id }` or 401s.
- `routes.ts`: `POST /auth/register` (email+password, Zod, argon2 hash, insert),
  `POST /auth/login` (lookup, argon2 verify, sign JWT, set cookie), `POST /auth/logout`
  (clear cookie). All three behind `express-rate-limit` (`AUTH_RATE_LIMIT_*`).
- Cookie options: `{ httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: <parsed from JWT_EXPIRES_IN> }`.

**Commands:**
```powershell
npm install -w apps/api argon2 jsonwebtoken express-rate-limit cookie-parser
npm install -D -w apps/api @types/jsonwebtoken @types/cookie-parser
docker compose up -d
npm run test -w apps/api
```

**Verify:** Supertest: register → 201; duplicate email → 409; login with wrong
password → 401; login with correct password → 200 + `Set-Cookie`; hitting a
`requireAuth`-protected stub route without cookie → 401, with cookie → 200;
logout → cookie cleared.

**Commit:** `feat: add register/login/logout with argon2 + httpOnly JWT cookie`

## Step 1.3 — Projects & API keys

**Files:** `apps/api/src/projects/{routes,apiKeys}.ts`, `apps/api/src/projects/projects.test.ts`

- `POST /projects` (authed, Zod `{ name }`, insert with `user_id = req.user.id`).
- `GET /projects` (authed, filtered by `user_id`).
- `POST /projects/:id/api-keys` — 403 if project doesn't belong to `req.user.id`;
  generate a random 32-byte key (`crypto.randomBytes(32).toString("base64url")`),
  store `sha256(key)` + an 8-char prefix, return the full key **once** in the
  response body (never retrievable again).
- `DELETE /projects/:id/api-keys/:keyId` — sets `revoked_at = now()` (soft
  revoke, keeps audit trail) instead of deleting the row.

API keys are hashed with **sha256**, not argon2: argon2's deliberate slowness
defends against offline brute-forcing of human-chosen, low-entropy passwords.
An API key is a 256-bit random value — brute-forcing it is already infeasible, so
a fast hash is correct here and keeps every `/ingest` request cheap.

**Verify:** Supertest: user A cannot see/modify/revoke user B's project or keys
(403/404); created key is only ever present in the creation response; revoked key
fails ingest auth (covered more fully once 1.4 lands, but add a check that
`revoked_at is not null` rows are excluded from the auth lookup query here too).

**Commit:** `feat: add project and API key management scoped to the owning user`

## Step 1.4 — Ingestion endpoint

**Files:** `apps/api/src/ingest/{middleware,schema,routes}.ts`, `apps/api/src/ingest/ingest.test.ts`

- `apiKeyAuth` middleware: reads `x-api-key`, looks up by prefix + `sha256` match
  among non-revoked keys, attaches `req.projectId` or 401s.
- Zod schema: array of `{ ts: datetime, service: string, level: enum, message: string, attrs?: record }`,
  max **1000** events per batch (422 if exceeded), body size cap **1 MB**
  (`express.json({ limit: "1mb" })`).
- Per-key rate limit via `INGEST_RATE_LIMIT_*`, keyed on `req.projectId` (not IP).
- One bulk insert per batch using a parameterized multi-row `INSERT ... VALUES
  ($1,$2,...),($...)` built from the validated array (not `unnest` — simpler to
  keep type-safe with `pg` and still a single round trip).
- Returns `{ accepted: <row count> }`.

**Verify:** Supertest: valid batch → 200 + correct count, row count in DB matches;
batch over 1000 events → 422; missing/garbage `x-api-key` → 401; revoked key → 401;
malformed event in batch → 422 with no partial insert (all-or-nothing).

**Commit:** `feat: add POST /ingest with API-key auth, validation, and bulk insert`

## Step 1.5 — packages/loggen

**Files:** `packages/loggen/src/{generator,incidents,groundTruth}.ts`,
`packages/loggen/src/generator.test.ts`, `packages/loggen/src/cli.ts`

- Seedable PRNG (small mulberry32-style function, no extra dependency) so a given
  seed always produces the same run.
- 4 services: `api`, `payments`, `auth`, `db`. Baseline: mostly `info`, a small
  steady fraction of `warn`/`error`, realistic per-service message templates.
- 3 injected incidents, each with a start time, duration, and cause:
  1. **Slow database** — `db` service's `info` template gains an `attrs.duration_ms`
     field with elevated values during the window.
  2. **Bad deploy** — `api` service starts emitting one brand-new error template
     never seen in the baseline, for the window's duration.
  3. **Downstream timeout burst** — `payments` emits a spike (e.g. 20x baseline
     rate) of an existing "timeout calling downstream" error template.
- `groundTruth.ts` writes a JSON file: `{ templates: [{id, text}], events: [{line, templateId}], incidents: [{cause, startTs, endTs, service}] }` next to the generated log output.
- `cli.ts`: `loggen --seed 42 --out logs.json --truth truth.json --count 5000`.

**Verify:** Vitest: same seed → byte-identical output across two runs; different
seed → different output; incident windows appear in the ground-truth file with the
documented causes; template count matches what the generator actually emits (no
hard-coded number asserted independently of the generator's own logic).

**Commit:** `feat: add packages/loggen synthetic log generator with ground truth`

## Step 1.6 — Integration tests + load test

**Files:** `apps/api/src/**/*.test.ts` (already added per-step above — this step is
the consolidation pass + the load script), `packages/loggen/src/loadtest.ts`,
`docs/performance.md`.

- Confirm all integration tests in 1.1–1.5 run together against one real Postgres
  (`docker compose up -d`), no mocks, matching the existing `health.test.ts` style.
- `loadtest.ts`: uses `autocannon` programmatically — registers a user, creates a
  project + API key, generates N events via loggen, fires them at `/ingest` for a
  fixed duration, prints the autocannon summary (req/sec, latency p50/p99,
  throughput) to stdout and writes it to `docs/performance.md` verbatim.
- `docs/performance.md`: machine specs (CPU, RAM, OS — gathered via
  `Get-ComputerInfo` / `systeminfo`, not guessed), the exact command run, and the
  raw autocannon output. No numbers are invented — if the script hasn't been run
  yet, the doc says so instead of a placeholder number.

**Commands:**
```powershell
docker compose up -d
npm run test                      # full workspace suite
npx tsx packages/loggen/src/loadtest.ts | Tee-Object -FilePath loadtest-raw.txt
Get-ComputerInfo | Select-Object CsProcessors, CsTotalPhysicalMemory, OsName
```

**Commit:** `test: add full integration suite and autocannon load test for /ingest`

## docs/design-decisions.md (new file)

Records: stateless JWT with no revocation list — logout clears the cookie but a
stolen token remains valid until natural expiry (60 min default). "What I'd do
next": add a `sessions` table keyed by JWT id (`jti`), checked on every request,
so logout/revocation is immediate — deferred because it adds a DB round trip to
every authed request and a new table, out of scope for Phase 1's goals.

## docs/learning/phase-1.md (new file)

Plain-language + analogy explanations of: password hashing, JWT + httpOnly
cookies, API-key hashing, bulk insert vs row-by-row, rate limiting, what a load
test measures.

## Risks

- **argon2 native build on Windows** — prebuilt binaries usually cover Node 20/22;
  if `npm install` tries to compile from source, this blocks the step until a
  prebuilt binary is available or bcrypt is substituted.
- **pgvector/pgcrypto extension creation** needs superuser-ish privilege; the
  `loguser` role from `docker-compose.yml` is the DB owner so this should work,
  but CI's service container must grant the same.
- **Bulk insert with malformed batch** — must be all-or-nothing (wrap in a
  transaction or rely on a single multi-row statement's atomicity) so a partial
  batch never leaves inconsistent row counts.
- **Rate-limiter state is in-memory** — resets on dev-server restart; acceptable
  for Phase 1 (single process, no HA requirement yet).
- **Load test numbers are machine-specific** — `docs/performance.md` must say so
  explicitly, not present them as general benchmarks.

## Definition of done — Phase 1

- [ ] All 5 migrations run cleanly up and down against the compose Postgres
- [ ] `/auth/register`, `/auth/login`, `/auth/logout` pass their Supertest suite
- [ ] `/projects` and `/projects/:id/api-keys` enforce per-user ownership (tested)
- [ ] `/ingest` validates, rate-limits, and bulk-inserts (tested)
- [ ] `packages/loggen` produces seedable output + ground truth (tested)
- [ ] Full workspace `npm run verify` passes with Docker Postgres up
- [ ] `docs/performance.md` has real, just-measured autocannon numbers + machine specs
- [ ] `docs/design-decisions.md` and `docs/learning/phase-1.md` exist
- [ ] `docs/PROGRESS.md` ticks off 1.1–1.6
- [ ] No secrets committed; `.env.example` and CI env block updated
- [ ] Branch pushed, PR link ready, CI green or fixed
