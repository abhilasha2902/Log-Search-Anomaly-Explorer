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

## Drain, not an LLM per line (Phase 3)

Grouping lines into templates uses a small hand-written Drain-style parser, not a language model.
Ingest handles hundreds of lines per request; Drain is a few in-memory lookups per line (its cost was not timed on its own), needs no model
download, is deterministic (the same line always lands in the same template, which a property test
checks) and can be unit-tested with plain strings. An LLM per line would be slow, costly in
hardware, non-deterministic, and would make ingest depend on a model server being up. CLAUDE.md
also rules it out ("LLM parsing of every line" is deferred). The LLM's job in this project is to
explain what the statistics found (Phase 5), not to do the counting.

Known weaknesses of Drain here: the first word of a line decides which branch it goes down, so a
variable first word (`alice logged in`) makes one template per distinct word until the 100-children
fan-out limit is hit; and templates generalise only as far as the lines seen so far.

## Statistical detection, not a trained model (Phase 3)

Anomalies come from two rules, a never-seen-before template and a per-template rate EWMA z-score,
because they are explainable in one sentence each, need no labelled data and every threshold is an
environment variable. The cost: it only sees changes in _which messages appear and how often_. A
slow database that logs the same message with a larger `duration_ms` is invisible to it.

**Loggen change to keep the evaluation honest.** The original `slow_database` incident only raised
`duration_ms` and left every message unchanged, so no message-based detector could ever see it. I
changed that incident so it emits the existing `slow query detected` warning (still with long
durations), which is what a slow database looks like in real logs. This makes the evaluation
meaningful but it also means the "slow database" result describes a scenario I adjusted so that
this detector could see it. Attribute-based (latency) anomalies are out of scope for Phase 3.

## Template mining runs inside `POST /ingest`

Mining happens in the request so `template_id` and the counts are correct as soon as a row exists
(no "wait for the worker" in the API or tests). The price is ingest throughput: measured with the
same load test, the handler went from 68.5 to 23.3 requests/second on this machine (numbers and
caveats in `docs/performance.md`). Not measured: where the time goes. A likely cause is that the
load test sends all traffic to one project, so every request updates the same ~13 template rows.

**What I'd do next:** write only the events in the request and let the worker assign templates and
counts for new rows in batches (fewer, larger updates and no hot rows), then re-run the load test;
or drop the foreign key on `log_events.template_id` and measure whether the per-row key check is
the cost.

## Parser state lives in API memory

One Drain tree per (project, service) is kept in the API process and rebuilt from `log_templates`
after a restart. That is fine for one API process (a project constraint) but would not work with
several: each would build its own tree and create duplicate templates. Two smaller gaps: memory
grows with the number of projects (there is no eviction), and a template whose _first_ word had
been generalised before a restart is rebuilt in the wildcard branch, so one duplicate can appear.

## No unique constraint on templates

A unique index on `(project, service, template text)` would need the text to stay stable, but
Drain rewrites a template when it generalises. Uniqueness is enforced by the parser plus a
per-project queue (concurrent requests are tested), not by the database.

## Events and statistics commit together; template rows do not

A request inserts its events and updates `total_count`, `first_seen`/`last_seen`, examples and
minute counts in one transaction. Template rows themselves are created _before_ that transaction
so the in-memory parser and the database stay in step; if the transaction then fails, an unused
template row with a count of 0 remains. Harmless, and cheaper than keeping the parser in step with a
rollback.

## Severity is derived at read time

`anomalies` stores the score; severity (low/medium/high) is computed when listing. A spike is high
at z ≥ 10, medium at z ≥ 6; a new template is graded by the level of its first example line.
These tiers are display heuristics I chose, not calibrated against real incidents. Because the
tiers are not stored, they can change without a migration.

## Detection reads "data time", and late events are not re-judged

The detector judges the last complete minute of what is in `template_minute_counts`, using `now`
passed in. Events that arrive late (a timestamp older than the minute the detector already
judged) change the counts but are never re-evaluated. If the worker is down for ten minutes,
those minutes are not caught up.
