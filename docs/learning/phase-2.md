# Phase 2 — Learning notes

**Full-text search and `tsvector`.** Searching `message LIKE '%timeout%'` reads every row.
Full-text search instead pre-computes, for each message, a `tsvector`: the list of words in it
(lower-cased, with positions). A query like `timeout` is turned into a `tsquery` and matched
with `@@`. Analogy: instead of re-reading every book in a library for a word, you look it up
in a catalogue that was built when each book arrived. We store that catalogue in a *generated
column* (`search_vector`), so Postgres keeps it up to date itself whenever a row is inserted.

**The `simple` configuration (whole words only).** Postgres can also stem words (`running` ->
`run`) and drop filler words like "the". We chose `simple`, which does neither: it only lower-cases
and splits on punctuation. What you type is what is matched, which is easy to explain and
predictable for log text (`timeo` will not find `timeout`, and `timeout` will not find
`timeouts`). The cost is no fuzzy matching; that is a documented limitation, not a bug.

**GIN index (inverted index).** A GIN index maps each *word* to the list of rows containing it.
Analogy: the index at the back of a textbook: look up "timeout" and get the page numbers
directly. That is why a rare word is found in well under a millisecond in our measurements
(`docs/performance.md`).

**Keyset (cursor) pagination vs offset.** `OFFSET 100000` makes the database walk past 100,000
rows to throw them away, and rows shift if new logs arrive while you page. A cursor says
"continue after the last row I saw" using the sort key `(ts, id)`. Analogy: a bookmark versus
"turn to page 2,000 by counting from the front". The `id` is a tie-breaker so rows with the
same timestamp are never skipped or repeated. Our cursor is an opaque base64url blob so clients
do not depend on its shape; the trade-off is that you can only go forward, not jump to page N.

**Parsing a query language safely.** The search box accepts `level:error "disk full" -retry`.
A small tokenizer splits it into words, phrases, negations and filters. The key safety rule:
the parser builds SQL only from fixed text plus numbered placeholders (`$1`, `$2`, ...); every
piece the user typed travels separately as a bound parameter. Analogy: a form letter with blanks.
Nobody can change the wording of the letter by what they write in a blank. Tests include
injection strings (`'; DROP TABLE ...`) and property tests (fast-check) that throw thousands of
random strings at the parser and check it only ever fails in the expected way.

**Property-based testing.** Instead of hand-picking examples, you state a rule that should hold
for *any* input ("the number of placeholders always equals the number of parameters") and the
tool generates hundreds of inputs, including nasty ones, to try to break it.

**Time ranges.** Users type `15m` or an ISO date; the server converts both to an absolute UTC
instant *before* building SQL, using a single "now" read once per request. `from` is inclusive
and `to` is exclusive so adjacent ranges never double-count an event on the boundary (we saw this
when measuring: an event exactly at `01:00:00.000` is excluded from `to=01:00:00`).

**Time bucketing.** The chart counts events per minute with `date_trunc('minute', ts)` plus
`GROUP BY`. Analogy: sorting receipts into one pigeonhole per minute and counting each. The
server returns only minutes that have events; the browser fills in the empty minutes with zero so
quiet periods show as gaps instead of disappearing.

**`EXPLAIN ANALYZE`.** Asking Postgres to run a query and report the plan it chose and how long
each step really took. Analogy: a GPS that tells you the route it took *and* the minutes each leg
cost. Reading it showed that most searches stop after about 50 rows because the time index is
already in the right order, and also found one slow case (a phrase that matches nothing).

**Why URL search params hold the search state in the web app.** The query, filters and project
live in the address bar, so a search can be bookmarked or shared and the Back button works; the
page does not need a state library. Analogy: writing your search on the envelope instead of
remembering it in your head.

**Same-origin proxy in development.** The browser talks only to the Vite dev server, which
forwards `/api/*` to the API. The login cookie is `httpOnly` (page scripts cannot read it) and
`SameSite=Lax`; because everything is one origin it behaves exactly like a normal website login
and needs no cross-site cookie workarounds.