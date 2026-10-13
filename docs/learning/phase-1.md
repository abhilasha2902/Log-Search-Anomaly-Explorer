# Phase 1 — Learning notes

**Password hashing (argon2).** We never store passwords, only a one-way
scrambled version. Analogy: a meat grinder. You can turn a steak into mince but
not back. argon2 is a grinder that is deliberately slow, so an attacker trying
billions of guesses is slowed down too.

**JWT + httpOnly cookie.** After login the server hands you a signed
wristband (the JWT) saying who you are. The server only checks the signature,
it does not look you up. An httpOnly cookie means page JavaScript cannot read the
wristband, so an injected script cannot steal it.

**API-key hashing.** Like a password, the key is stored only as a hash, and the
full key is shown once at creation. A short prefix stays in plain text so we can
find the right row quickly, like the first letters on a luggage tag.

**Bulk insert vs row-by-row.** Sending 500 rows in one `INSERT` is one trip to
the database. Row-by-row is 500 trips. Analogy: carrying 500 groceries in one
trolley instead of 500 separate walks to the car. One statement is also
all-or-nothing, so a batch never half-saves.

**Rate limiting.** A cap on requests per time window, per client. Analogy: a
turnstile that lets N people through per minute. Auth routes are limited per IP
(to slow password guessing); ingest is limited per API key.

**What a load test measures.** How many requests per second the endpoint
handles and how long each takes (latency percentiles: p50 is the typical
request, p99 is the slow tail). Results only describe the machine they ran on;
see `docs/performance.md`.
