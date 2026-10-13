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
