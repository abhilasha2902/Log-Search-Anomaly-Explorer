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
## Search is whole-word only (Phase 2)

Search uses a `tsvector` built with the `simple` text-search configuration, so it matches
whole, lower-cased words: no stemming, no substring, partial-word or typo-tolerant search.
This keeps behaviour predictable and easy to explain. "What I'd do next": add a `pg_trgm` index
for substring matching if users need it, accepting a larger index and more to maintain.

## `search_vector` is a stored generated column

Postgres maintains it automatically, so ingestion code does not change. The catch: adding a
stored generated column rewrites the whole table, which is fine at this size but would lock a
large production table. "What I'd do next": add the column as nullable, backfill in batches, then
attach the index.

## 404 for projects you don't own, not 403

A project that is not yours and one that does not exist both return 404, so the API never
confirms that someone else's project id exists. It matches the Phase 1 API-key routes.

## No total result count on the logs endpoint

`/logs` returns a page and a `nextCursor`, not "N results". An exact count means scanning every
matching row, which is the cost the cursor avoids. The UI shows how many rows are loaded so far.

## The search state lives in the URL

Query, filters, time range and project are URL search params; React `useState` is used only for
what has been loaded and which row is open. No state library or data-fetching library was added.
The trade-off is a little hand-written loading/error handling in two small hooks.

## uPlot for the chart

uPlot is about 50 KB and fast, and one bar chart is all the app needs. The trade-off is an
imperative canvas API, so it is confined to one wrapper component and replaced by a stub in jsdom
tests (jsdom has no canvas), which means tests check what is passed to the chart, not pixels.
The chart does not yet react to the OS switching between light and dark while it is on screen:
colours are read when it is drawn. "What I'd do next": redraw on `prefers-color-scheme` changes.

## The row drawer is not a full focus trap

The drawer closes with Escape or its button and returns focus to the row; Tab is held on its
close button, which is the only control inside. A dialog with more controls would need a proper
focus-trap implementation.

## Logout still does not revoke tokens

Unchanged from Phase 1 (see "Stateless JWT, no revocation list" above): signing out clears the
cookie, but a stolen JWT stays valid until it expires. The new search endpoints inherit that.