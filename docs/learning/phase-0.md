# Phase 0 — concepts explained

## npm workspaces

A monorepo is one git repository holding several related packages. npm workspaces
is npm's built-in way to manage that: one root `package.json` lists the
sub-packages (`apps/api`, `apps/web`, `packages/loggen`, `packages/eval`), and
`npm install` run once at the root installs dependencies for all of them,
symlinking shared ones into a single `node_modules` instead of duplicating them.

**Analogy:** think of an apartment building (the repo) with several units
(the packages). Each unit has its own rooms (its own code and dependencies), but
the building has one shared water and electricity line (shared dependencies
installed once at the root) instead of each unit running its own utility hookup.

## TypeScript strict mode

TypeScript checks your code's types before it runs. "Strict mode" turns on the
full set of strictness flags at once (no implicit `any`, null checks enforced,
etc.), so the compiler catches more mistakes — like forgetting a value could be
`null` — before the code ever executes.

**Analogy:** it's the difference between a spell-checker that only flags
misspelled words (loose mode) and one that also flags grammar, missing
punctuation, and ambiguous pronouns (strict mode). More gets caught before
anyone else reads it.

## What a health check is

A health check is an endpoint (here, `GET /health`) that a running service
exposes so something else — a load balancer, a monitoring tool, a developer, CI —
can ask "are you actually working?" without doing a full end-to-end test. This
project's health check queries the database (`SELECT 1`), so it tells you whether
the API can both start *and* talk to Postgres, not just whether the Node process
is alive.

**Analogy:** it's like a nurse checking a patient's pulse. A pulse doesn't tell
you everything about the patient, but its absence tells you something is badly
wrong, fast, without a full exam.

## What CI is, and why a service container

CI (Continuous Integration) is a server that automatically runs your checks
(lint, type-check, tests) every time code is pushed or a pull request is opened,
so broken code is caught before it's merged, not after.

This project's tests need a real Postgres database (the health check test is
against a real DB, not a mock — mocking it would let the test pass even if the
real `pg` connection logic were broken). GitHub Actions lets a CI job declare a
"service container": a throwaway Docker container (here, `pgvector/pgvector:pg16`)
that's started fresh for that one CI run, alongside the job's own container,
and torn down afterward.

**Analogy:** CI is a quality-control inspector who checks every delivery truck
before it leaves the warehouse, every single day, instead of someone checking
once a month. A service container is a temporary test rig the inspector sets up
and tears down for each truck — real enough to catch real problems, but never
left lying around afterward.
