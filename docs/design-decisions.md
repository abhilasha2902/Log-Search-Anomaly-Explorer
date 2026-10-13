# Design decisions

## Stateless JWT, no revocation list (Phase 1)

Auth uses a signed JWT in an httpOnly cookie. Logout clears the cookie, but a
stolen token stays valid until it expires (60 minutes by default).

**What I'd do next:** add a `sessions` table keyed by the JWT id (`jti`) and check
it on every request, so logout and revocation take effect immediately. Deferred
because it adds a DB round trip to every authed request and a new table, which is
out of scope for Phase 1.

## API keys hashed with sha256, not argon2

An API key is 256 random bits, so brute-forcing it is infeasible and a fast hash
is enough. argon2 is deliberately slow to protect low-entropy human passwords;
using it here would only make every `/ingest` request slower.

## Rate limiter state is in memory

Limits reset when the process restarts and are not shared between processes.
Acceptable while there is a single API process.

## JWT secret length is not validated at runtime

`.env.example` models a 32+ byte value, but the API does not reject a short one.
Known gap.

## Search performance: no new index, one known slow case (Phase 2)

With 250,000 rows in a project, `GET /projects/:id/logs` was measured with
`EXPLAIN (ANALYZE, BUFFERS)` (numbers in `docs/performance.md`). No index was added in Phase 2:
`idx_log_events_project_ts` (project, ts DESC) already provides the newest-first ordering, so
the common queries read about 50 rows and finish in well under 3 ms (warm cache, one laptop). The
`id DESC` tie-break costs only a small Incremental Sort.

The trade-off: a query that matches nothing, or very few rows, can still be slow. A phrase query
that matched zero rows (case e, `"u query"`) took about 64 ms because the planner expected
about 15,000 matches, chose to walk the time index in order, and discarded all 250,000 rows. A
fresh `ANALYZE` did not change that plan. I recorded it as a worst case instead of tuning around it.
Not measured: any volume above 250,000 rows (no 1,000,000-row run was done).

**What I'd do next:** (1) test whether a phrase query planned through the GIN index on
`search_vector` first is faster for rare phrases, for example by checking the plan with the
word-level `@@` conditions added alongside `phraseto_tsquery`, and measure it before changing
the SQL; (2) bound worst cases with a default time range (such as the last 24 hours) when the
user gives no `from`, which caps how many rows a no-match query can scan; (3) re-measure at
1,000,000 rows before relying on any of this.