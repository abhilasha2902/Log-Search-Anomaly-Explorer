# Phase 0 — Setup

Goal: a working, CI-verified monorepo skeleton with no application logic yet.
Nothing here implements search, ingestion, or AI features — that starts in Phase 1.

## Repo state at time of writing

- `origin` → `https://github.com/abhilasha2902/Log-Search-Anomaly-Explorer.git` (correct)
- Branch: `main`, no commits yet
- Working tree: only `CLAUDE.md` (untracked). No README, LICENSE, or `.gitignore` exist on GitHub or locally.
- Per CLAUDE.md, Phase 0 work happens directly on `main` (no feature branch yet).

## 1. Prerequisites (check manually, PowerShell)

Run these once, before Step 0.1. None of this is scripted by Claude — verify yourself.

```powershell
node -v          # expect v20.x
npm -v
git --version
docker --version
docker compose version
code --version   # VS Code, optional but assumed
```

GitHub auth for pushing (pick one, verify it works):
```powershell
git config --global user.name
git config --global user.email
# If using HTTPS + credential manager, a `git push` will prompt for browser login once.
# If using gh CLI:
gh auth status
```

Docker Desktop must be **running** (not just installed) before Step 0.3 — `docker compose up` will fail silently/confusingly otherwise.

## 2. Final folder tree (end of Phase 0)

```
Log-Search-Anomaly-Explorer/
├── .github/workflows/ci.yml
├── .gitignore
├── .env.example
├── docker-compose.yml
├── LICENSE
├── README.md
├── CLAUDE.md
├── package.json                 (root, workspaces)
├── tsconfig.base.json
├── .eslintrc.cjs                (or eslint.config.js, see decision #4)
├── .prettierrc
├── docs/
│   ├── PROGRESS.md
│   ├── plans/
│   │   └── phase-0.md
│   └── learning/
│       └── phase-0.md
├── apps/
│   ├── api/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── health.ts
│   │   │   └── db.ts
│   │   └── src/health.test.ts
│   └── web/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       └── src/
│           ├── main.tsx
│           └── App.tsx
└── packages/
    ├── loggen/
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── src/index.ts
    └── eval/
        ├── package.json
        ├── tsconfig.json
        └── src/index.ts
```

## 3. Ordered steps

### 0.1 Repo basics

**Files:** `.gitignore`, `LICENSE` (MIT), `README.md`, `docs/PROGRESS.md`, `docs/learning/phase-0.md`

**`.gitignore` must include at minimum:**
```
node_modules/
dist/
build/
.env
*.local
coverage/
.vite/
```

**README.md** skeleton sections: Problem statement, Planned features (list from CLAUDE.md roadmap), Stack, Status (link to `docs/PROGRESS.md`), How to run (filled in as phases land), License.

**Commands:**
```powershell
git add .gitignore LICENSE README.md CLAUDE.md docs/PROGRESS.md docs/learning/phase-0.md docs/plans/phase-0.md
```

**Verify:** `git status` shows exactly these files staged; README renders sensibly on GitHub preview (optional, check after push).

**Commit:** `chore: add repo basics (gitignore, license, readme, docs)`

---

### 0.2 npm workspaces monorepo

**Files:** root `package.json` (with `"workspaces": ["apps/*", "packages/*"]`), `tsconfig.base.json`, per-workspace `package.json` + `tsconfig.json` for `apps/api`, `apps/web`, `packages/loggen`, `packages/eval`, root `.eslintrc.cjs`/`eslint.config.js`, `.prettierrc`, root `vitest.config.ts` (or per-workspace, see decision #5).

Each workspace gets a minimal placeholder entry file so `tsc` and `vitest` have something to run against (e.g. `apps/api/src/index.ts` logs "not implemented yet"; `apps/web` gets the default Vite React+TS template; `packages/loggen` and `packages/eval` export a stub function with one trivial Vitest test each).

**Commands:**
```powershell
npm init -y
# edit root package.json: add "workspaces", scripts (lint/typecheck/test), devDependencies
npm install -D typescript eslint prettier vitest @typescript-eslint/parser @typescript-eslint/eslint-plugin eslint-config-prettier
npm create vite@latest apps/web -- --template react-ts
npm init -y -w apps/api
npm init -y -w packages/loggen
npm init -y -w packages/eval
npm install -D -w apps/api typescript tsx @types/node express pg zod pino vitest supertest @types/supertest
npm install
```

**Verify:**
```powershell
npm run lint
npm run typecheck
npm run test
```
All three must pass (even if tests are trivial placeholders).

**Commit:** `chore: set up npm workspaces monorepo with TS, ESLint, Prettier, Vitest`

---

### 0.3 Docker Compose + DB health check

**Files:** `docker-compose.yml`, `.env.example`, `apps/api/src/db.ts`, `apps/api/src/health.ts`, `apps/api/src/index.ts` (Express app wiring `/health`), `apps/api/src/health.test.ts` (Supertest, against a real DB — not mocked, since this is the thing being verified).

**`docker-compose.yml`** (one service, named volume, host port per decision #6):
```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: loguser
      POSTGRES_PASSWORD: logpass
      POSTGRES_DB: logexplorer
    ports:
      - "5433:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
```

**`.env.example`:**
```
DATABASE_URL=postgres://loguser:logpass@localhost:5433/logexplorer
PORT=3000
```

`GET /health` queries `SELECT 1` through the `pg` pool and returns `{ status: "ok", db: "ok" }` or 503 with the error if the DB is unreachable.

**Commands:**
```powershell
docker compose up -d
Copy-Item .env.example .env
npm run dev -w apps/api      # or: npx tsx apps/api/src/index.ts
# in another terminal:
curl http://localhost:3000/health
npm run test -w apps/api     # runs health.test.ts against the real compose DB
docker compose down
```

**Verify:** `/health` returns 200 with `db: "ok"` while compose is up, and the Supertest test passes locally.

**Commit:** `feat: add docker-compose postgres+pgvector and DB-backed /health endpoint`

---

### 0.4 CI workflow

**Files:** `.github/workflows/ci.yml`

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg16
        env:
          POSTGRES_USER: loguser
          POSTGRES_PASSWORD: logpass
          POSTGRES_DB: logexplorer
        ports: ["5432:5432"]
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    env:
      DATABASE_URL: postgres://loguser:logpass@localhost:5432/logexplorer
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test
```

**Commands:**
```powershell
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow with pgvector postgres service"
git push origin main
```

**Verify:** open the Actions tab (link in section 4) and confirm the run is green.

**Commit:** `ci: add GitHub Actions workflow with pgvector postgres service`

## 4. Git / GitHub steps

1. Confirm identity before any commit:
   ```powershell
   git config user.name "Kumari Abhilasha"
   git config user.email "<your email>"
   ```
2. Commit each step above individually (not squashed) directly on `main`, per CLAUDE.md Phase 0 rule.
3. After step 0.4's commit:
   ```powershell
   git push origin main
   ```
   If this fails (auth prompt rejected, protected branch, etc.) — stop and report the exact error; do not force-push or bypass.
4. Watch the run at: https://github.com/abhilasha2902/Log-Search-Anomaly-Explorer/actions
5. Optional README badge, add once the first run is green:
   ```markdown
   ![CI](https://github.com/abhilasha2902/Log-Search-Anomaly-Explorer/actions/workflows/ci.yml/badge.svg)
   ```

## 5. Key decisions

1. **ESM over CommonJS** — `"type": "module"` in every `package.json`; Node 20 and Vite both default to ESM, avoids `require`/`import` interop friction later with Transformers.js (ESM-only).
2. **tsx over ts-node** — faster startup, zero config for ESM+TS, used for `npm run dev` on `apps/api`; production build still goes through `tsc`.
3. **Shared `tsconfig.base.json`** at root with `strict: true`, each workspace `tsconfig.json` does `"extends": "../../tsconfig.base.json"` — one place to enforce strictness, no drift between workspaces.
4. **ESLint flat config (`eslint.config.js`)** — current ESLint default, avoids pulling in the legacy `.eslintrc` resolver; simpler to share rules across workspaces via one array.
5. **Vitest per-workspace, not one root config** — `apps/web` needs jsdom, `apps/api` needs node + Supertest against a real DB; keeping configs separate avoids one environment leaking into the other.
6. **Postgres host port 5433** — 5432 is the common local-Postgres default on Windows installs (e.g. an existing pgAdmin/Postgres service); 5433 avoids a silent clash during `docker compose up`. CI uses 5432 inside its isolated runner, where no clash is possible.

## 6. Windows / Docker / CI / GitHub risks

- **Docker Desktop not running** → `docker compose up` errors with a pipe/connection error, not "Docker not found". Always confirm Docker Desktop is open first.
- **Line endings (CRLF vs LF)** → add a root `.gitattributes` with `* text=auto eol=lf` in step 0.1 to avoid ESLint/Prettier flip-flopping on Windows checkouts.
- **PowerShell `curl` is `Invoke-WebRequest`-aliased** — use `curl.exe` or `Invoke-RestMethod` if plain `curl` behaves unexpectedly when checking `/health`.
- **Port already in use** — if 5433 is still taken, `docker compose up` fails with "port is already allocated"; check with `netstat -ano | findstr 5433` and change the host port in `.env`/`docker-compose.yml` together.
- **npm workspaces + Windows path lengths** — keep the repo near the drive root (already the case) to avoid `node_modules` path-length errors.
- **GitHub push auth** — if using HTTPS without a stored credential, `git push` may hang waiting for a browser popup that doesn't appear in some terminals; prefer `gh auth login` once, then `git push` reuses it.
- **CI service container health** — the pgvector image takes a few seconds to accept connections; the `options: --health-cmd pg_isready ...` block above is required, not optional, or the API's health check will race the DB startup and fail intermittently.

## 7. Definition of done — Phase 0

- [ ] `README.md`, `LICENSE`, `.gitignore`, `docs/PROGRESS.md` committed
- [ ] `npm install` at root installs all four workspaces without errors
- [ ] `npm run lint`, `npm run typecheck`, `npm run test` all pass locally
- [ ] `docker compose up -d` starts Postgres+pgvector; `GET /health` returns 200 with `db: "ok"`
- [ ] `apps/api` health test passes against the real compose DB (Supertest, no mocks)
- [ ] `.github/workflows/ci.yml` exists, triggers on push/PR to `main`
- [ ] Latest push to `main` shows a **green** Actions run at the repo's Actions tab
- [ ] No `.env`, secrets, `node_modules`, or model files committed (spot-check `git log --stat`)
- [ ] `docs/learning/phase-0.md` has plain-language explanations for any new concept introduced (workspaces, pgvector, Docker Compose, CI service containers)
