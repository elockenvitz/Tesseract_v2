# Tesseract

Tesseract is a research, decision, and outcomes platform for investment
teams. Analysts capture ideas, develop a thesis, run sizing simulations,
and hand recommendations to portfolio managers. Portfolio managers
review, commit, and later reflect on whether the thesis played out — all
within a single closed loop:

```
Capture → Develop → Decide → Review → Analyze
```

The platform is multi-tenant: each organization sees only its own
portfolios, ideas, and decisions, enforced at the database layer via
Supabase row-level security (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)).

---

## Quick start

### Prerequisites

- Node 22+ (we target `node-version: 22` in CI)
- npm 11+ (ships with Node 22)
- A Supabase project to point at (production or staging). Get the
  project URL + anon key from the Supabase dashboard
  (`Settings → API`).

### Install + run

```bash
git clone https://github.com/elockenvitz/Tesseract_v2.git
cd Tesseract_v2
cp .env.example .env.local
# Open .env.local and fill in your Supabase URL + anon key
npm install --legacy-peer-deps
npm run dev
```

Visit `http://localhost:5173`. If the dev server reports `Missing
Supabase environment variables`, your `.env.local` isn't being read —
double-check it sits at the repo root and the variable names start
with `VITE_`.

### Common scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the Vite dev server with HMR |
| `npm run build` | Production build into `dist/` |
| `npm test` | Run the Vitest unit suite (interactive watch) |
| `npm test -- --run` | One-shot test run (matches CI) |
| `npm run lint` | Run ESLint (see TODOs — lint isn't yet enforced in CI) |
| `npm run storybook` | Start Storybook on port 6006 |
| `npm run tenant:lint:all` | Custom guard against cross-org data leakage (requires `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` env vars) |

---

## How we ship

We use a trunk-based workflow with branch protection on `main`. Every
change goes through:

```
feature branch → PR → CI (typecheck + tests) → review → squash-merge → auto-deploy
```

A separate `staging` branch deploys to a staging Netlify site backed by
a staging Supabase project — used to verify risky changes before they
reach pilots in production. See
[docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for the full flow.

---

## Tech stack

- **Frontend**: React 18, Vite 5, TypeScript, Tailwind CSS
- **State**: TanStack Query (server state), Zustand (client state)
- **Editor**: TipTap (rich text)
- **Backend**: Supabase (Postgres 15, Auth, Realtime, Storage, Edge Functions)
- **Multi-tenancy**: Per-org RLS policies enforced via
  `is_active_org_admin_of_current_org()` helpers + a custom
  `tenant-boundary-lint` step (see `scripts/`)
- **Hosting**: Netlify (frontend), Supabase (backend)
- **CI**: GitHub Actions (`.github/workflows/ci.yml`)
- **Testing**: Vitest, Testing Library, Playwright (Storybook visual tests)
- **Observability**: planned — see open items in
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

---

## Repo layout

```
src/
  components/    React components, grouped by domain
  contexts/      React contexts (org, auth)
  engine/        Decision engine — the trade-flow state machine
  features/      Cross-cutting feature modules
  hooks/         Custom React hooks (~120 of them — typed and reused)
  lib/           Pure utilities, services, integrations
  pages/         Top-level route components
  services/      Domain services that talk to Supabase
  stores/        Zustand stores
  test/          Test helpers (setup.ts, utils.tsx)
  types/         Shared TypeScript types

supabase/
  migrations/    Versioned SQL migrations (250+ files)
  functions/     Edge functions
  tests/         RLS test suites (pgTAP)

scripts/
  tenant-boundary-lint.mjs     Scans SQL for unsafe cross-org patterns
  frontend-tenant-lint.mjs     Scans React for unsafe org access
  sql/                         Ad-hoc operational SQL (not migrations)

docs/
  ARCHITECTURE.md
  CONTRIBUTING.md
  archive/                     Historical planning / refactoring notes
```

---

## Documentation

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — system overview,
  multi-tenancy model, data flow
- **[docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)** — branch / PR / review flow
- **[docs/archive/](docs/archive/)** — historical refactoring and feature plans

---

## License

Proprietary. All rights reserved.
