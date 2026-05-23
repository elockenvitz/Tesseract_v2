# Architecture

This is a one-page picture of how Tesseract is built. Read this before
touching unfamiliar parts of the codebase, or after a long break.

---

## System diagram

```
┌──────────────────────────┐         ┌──────────────────────────┐
│   Browser (React SPA)    │         │   Netlify (CDN + Edge)   │
│                          │         │                          │
│  • Vite 5 + React 18     │ ◀────── │  Static asset hosting    │
│  • TanStack Query        │         │  Build = `vite build`    │
│  • Zustand               │         │  Branch deploy:          │
│  • Tailwind              │         │    main      → prod      │
│                          │         │    staging   → staging   │
└────────────┬─────────────┘         └──────────────────────────┘
             │
             │ HTTPS (REST + Realtime WS)
             │ Uses VITE_SUPABASE_ANON_KEY
             ▼
┌──────────────────────────────────────────────────────────────────┐
│                       Supabase project                           │
│  ┌────────────┐   ┌────────────┐   ┌────────────┐                │
│  │  Postgres  │   │   Auth     │   │  Storage   │                │
│  │  + RLS     │   │  (JWT)     │   │            │                │
│  └────────────┘   └────────────┘   └────────────┘                │
│  ┌────────────────────────────┐   ┌────────────────────────┐     │
│  │  Realtime (Postgres CDC)   │   │  Edge Functions (Deno) │     │
│  └────────────────────────────┘   └────────────────────────┘     │
└──────────────────────────────────────────────────────────────────┘
```

Two Supabase projects exist:

- **Production** — backs the live `tesseract.com` (Netlify `main` branch).
- **Staging** — backs `tesseract-platform-staging.netlify.app`
  (Netlify `staging` branch). Pilots never see staging.

---

## Multi-tenancy model

**Every domain table carries an `organization_id` column** and is
gated by Postgres row-level security (RLS) policies that resolve the
caller's active org from their JWT.

Three RLS helper functions are used everywhere:

| Helper | What it returns | Used for |
|---|---|---|
| `auth.uid()` | The current logged-in user's ID | "Is this row mine?" checks |
| `is_active_org_admin_of_current_org()` | True iff caller is an active org admin of the org the row belongs to | Admin-only mutations on org data |
| `portfolio_in_current_org(p_id)` | True iff portfolio `p_id` is in the caller's current org | Portfolio-scoped table policies |

Cross-org access is **never** allowed — even for platform staff. (Ops
staff use the `is_platform_admin()` function and a separate set of
SELECT-only policies on telemetry tables.)

Pilot orgs additionally carry an `organizations.settings.pilot_mode`
boolean. When that flag is on, the frontend swaps in a guided
onboarding experience (the System Loop dashboard, in-banner Get Started
checklists, etc.). The per-user progress through that flow is tracked
in `users.pilot_progress` JSONB with per-org keys
(`trade_book_unlocked_at_<orgId>`, `outcomes_unlocked_at_<orgId>`,
`graduated_at_<orgId>`) and per-step events in `pilot_telemetry_events`.

### Tenant-boundary lint

Because RLS alone can't protect against frontend code that *queries
across orgs without the org filter* (e.g. `supabase.from('trades')
.select('*')` with no `.eq('organization_id', currentOrgId)`), we run
two custom linters:

| Script | What it scans for |
|---|---|
| `scripts/tenant-boundary-lint.mjs` | Postgres functions that omit an `organization_id` filter on tables that should always be org-scoped |
| `scripts/frontend-tenant-lint.mjs` | React/TS code that calls `supabase.from(...)` without an org filter on org-scoped tables |

Both are wired into `npm run tenant:lint:all`. The frontend linter
runs in CI once `SUPABASE_*` secrets are provisioned (see
`.github/workflows/ci.yml` TODO).

---

## Domain concepts

The product is organized around a five-stage **decision loop**:

1. **Capture** — analyst logs a raw trade idea (`trade_queue_items`)
2. **Develop** — idea moves through research stages on the Idea Pipeline
   kanban (`research_stage`, `trade_idea_portfolios`)
3. **Decide** — PM reviews + executes the trade in Trade Lab
   (`simulations`, `lab_variants`, `simulation_trades`)
4. **Review** — committed trade lands on the Trade Book
   (`accepted_trades`, `trade_batches`)
5. **Analyze** — PM reflects on outcome (`decision_reviews`,
   `decision_quality`)

The **decision engine** (`src/engine/decisionEngine/`) computes
"what should this user pay attention to right now?" by reading the
above tables and assigning attention items to stages. The dashboard's
attention queues are downstream of this engine.

---

## State management

| Concern | Tool | Notes |
|---|---|---|
| Server state (DB reads) | TanStack Query | Cached by `[entity, filter]` keys. `staleTime` tuned per query. Invalidation via `queryClient.invalidateQueries` after mutations. |
| Client UI state | Zustand stores | Light, no boilerplate. Used for ephemeral things like UI selection, modal visibility. |
| Form state | React Hook Form + Zod | Resolved by `@hookform/resolvers`. |
| Realtime subscriptions | Supabase Realtime | Used for live decision-inbox updates and collaborative simulations. |

---

## Deployment topology

```
git push origin staging  →  Netlify builds staging branch  →  staging.tesseract-platform.netlify.app
                                                              (points at staging Supabase)

merge PR to main         →  Netlify builds main branch     →  tesseract.com (pilots)
                                                              (points at production Supabase)
```

Database migrations are versioned files in `supabase/migrations/` and
applied via the Supabase MCP or CLI (`supabase db push`) — never via
direct `psql`. Migrations should be additive when possible
(`ADD COLUMN nullable`, `IF NOT EXISTS`); destructive changes require
a two-phase deploy (ship code that ignores the column → drop later).

See [docs/CONTRIBUTING.md](CONTRIBUTING.md) for the full PR + deploy flow.

---

## What's intentionally NOT here yet

These are known gaps. Listing them so the absence isn't a surprise.

- **No product analytics** (PostHog / Mixpanel). Errors *are* tracked
  in Sentry (`src/main.tsx`), but we don't yet collect funnel/feature
  usage. The Ops portal's pilot funnel covers the most important
  conversion path.
- **No bundle-size budget**. Some pages are large (Simulation, Org
  page). To be sliced + lazy-loaded as part of the file-breakup
  refactor.
- **ESLint is not yet enforced in CI**. We have a 4.6K-error backlog
  to clear before flipping the gate on. Tracked separately.
- **Storybook visual-regression tests don't run in CI**. They need
  Playwright + Chromium in the runner. Will be added as a separate
  workflow when more stories exist (we have ~3 today).
- **ADRs (architecture decision records)**. Planned next sprint —
  one-page docs for the load-bearing choices (Supabase RLS, per-org
  pilot keys, decision engine design, etc.).

---

## Where to look first when something breaks

| Symptom | First file to check |
|---|---|
| Pilot can't log in | `src/contexts/OrganizationContext.tsx` (org-routing logic) |
| Trade idea won't move stages | `src/lib/services/trade-idea-service.ts` |
| Decision Inbox missing rows | `src/hooks/useDecisionRequests.ts` + RLS on `decision_requests` |
| Trade Lab variant won't save | `src/hooks/useIntentVariants.ts` (look for optimistic update / rollback) |
| Pilot funnel % looks wrong | `src/pages/ops/OpsClientDetailPage.tsx` + `src/pages/ops/OpsDashboardPage.tsx` |
| Cross-org data leak (worst case) | Run `npm run tenant:lint:all` first; then grep for the leaked table |
