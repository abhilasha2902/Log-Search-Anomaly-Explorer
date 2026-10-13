# Log Search & Anomaly Explorer

Portfolio project for Kumari Abhilasha (fresher full-stack dev, Windows laptop, PowerShell). It must be polished, tested, honest and explainable in interviews.

Repo: https://github.com/abhilasha2902/Log-Search-Anomaly-Explorer (remote: origin, default branch: main)

## What it does
Apps send structured logs to an ingestion API. The system stores them in PostgreSQL, supports a small search syntax (level:error service:api timeout), groups lines into templates (Drain-style), detects anomalies (new templates, rate spikes), finds similar past incidents (pgvector embeddings), fires threshold alerts, and uses a local LLM (Ollama) to write incident summaries grounded in retrieved logs with cited line IDs. A React dashboard shows everything. An eval harness measures the AI parts.

## Stack
- Monorepo (npm workspaces): apps/api (Node 22, Express, TS), apps/web (React + Vite + TS), packages/loggen, packages/eval, docs
- PostgreSQL 16 + pgvector (Docker image pgvector/pgvector), node-pg-migrate, pg driver
- Zod, Pino, Vitest + Supertest, fast-check, Playwright (1-2 e2e), autocannon, ESLint + Prettier
- Embeddings: Transformers.js all-MiniLM-L6-v2 (384 dims). LLM: Ollama (llama3.2:3b or qwen2.5:3b) over local HTTP
- CI: GitHub Actions with a pgvector Postgres service container

## Git workflow
- Work on main for Phase 0. From Phase 1 onward, use one branch per phase (phase-1-ingestion, phase-2-search, ...), commit per numbered step, push the branch at the end of the phase, and tell me to open a PR and merge it after CI is green.
- Conventional commits (feat:, fix:, chore:, docs:, test:, ci:).
- Never force-push. Never commit .env, secrets, node_modules or model files.
- If a push fails (auth, protected branch), stop and tell me the exact error instead of working around it.

## Hard rules
1. Free and open-source only. No paid APIs. Local models only.
2. Honesty: never invent features, metrics or results. Any number in README/docs must come from a test or benchmark that was actually run. If a number is needed, write the script and tell me to run it.
3. Every AI feature must work without the LLM (graceful fallback). The LLM only explains what the statistics found and must cite log line IDs that exist in the provided context.
4. No chatbot, fine-tuning, Kafka/Redis, multi-tenancy/billing, microservices. One monorepo, one API process plus one worker process.
5. TypeScript strict, Zod validation on all inputs, parameterized SQL only, never log secrets, no hard-coded secrets.
6. Keep code simple and tested. Commands must work in PowerShell.
7. Work ONE phase at a time. Never start the next phase. After each numbered step: run lint, typecheck and tests, then make one git commit with a clear message.
8. Do not guess when a requirement is ambiguous; ask me.
9. I am new to log processing, text-search internals, embeddings and RAG. When you introduce such a concept, add a short plain-language explanation with an analogy in docs/learning/phase-N.md so I can explain it in interviews.

## Roadmap
Phase 0 Setup | Phase 1 Ingestion and storage | Phase 2 Search | Phase 3 Template mining and anomaly detection | Phase 4 Alerts and embeddings | Phase 5 Grounded AI summaries and evaluation | Phase 6 Quality and shipping
Detailed plans live in docs/plans/phase-N.md. Progress is tracked in docs/PROGRESS.md.

## Deferred (do not build)
Chatbot over logs, fine-tuning, LLM parsing of every line, auto-remediation, multi-agent flows, Kafka, separate vector DB, multi-tenancy, billing, OpenTelemetry.