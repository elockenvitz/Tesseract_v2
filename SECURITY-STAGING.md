# Security gate — what runs where, and the staging config it needs

`npm run security:check` is the single platform security gate (`scripts/security-check.mjs`). It has three
tiers by infrastructure dependency. This file is the operator's reference: which tier runs offline, which
needs a database, and the exact GitHub secrets the founder must provide. **No tier ever runs against
production** — both DB tiers refuse the production ref (`wfcebeagznzgeuyysbnt`).

## Tier 1 — STATIC (no database, runs anywhere)

Run with `npm run security:check:static`. Needs nothing but the repo checkout. This is the tier that goes
required in branch protection first (once green and proven non-vacuous).

| Check | Script | What it fails on |
|---|---|---|
| frontend tenant lint | `frontend-tenant-lint.mjs` | client Supabase queries with no `organization_id` filter / org-scoped hook, above a committed baseline |
| unconditional-policy guard | `unconditional-policy-guard.mjs` | new `USING(true)` / unconditional RLS policies in the committed policy snapshot, above a `KNOWN_UNRESOLVED` ratchet |
| edge-function authz guard | `edge-authz-guard.mjs` | an Edge Function missing from `authz-registry.json`, a serviceRole flag that disagrees with source, an unreviewed service_role function, or a privileged class (`platform-admin`/`user-jwt`) whose runtime test is missing, an empty placeholder, or outside the vitest unit scope |

CI: the `static` job in `.github/workflows/security.yml` runs this on every PR. No secrets.

## Tier 2 — DB STRUCTURAL LINT (needs a non-prod Postgres)

`tenant-boundary-lint.mjs` queries a live database and asserts every non-exempt table has RLS enabled, an
`organization_id` column (or is FK-chain / global exempt), and at least one policy. It **fails closed** if
its credentials are absent — it is never silently skipped.

Credentials (both required):
- `SECURITY_SUPABASE_REF` — a **non-production** project ref. The PostgREST URL is derived as
  `https://<ref>.supabase.co`.
- `SECURITY_SUPABASE_SERVICE_KEY` — that project's service-role key (used only to read `pg_catalog` /
  `information_schema` for the structural lint).

It also needs the helper RPC `exec_sql` (or `get_tenant_lint_tables`) on the target project — see
`scripts/tenant-boundary-lint.sql`.

## Tier 3 — DB ISOLATION SUITES (needs a non-prod Supabase with synthetic data)

`security-suite.mjs` runs the SQL suites `supabase/tests/asset-workspace-tenant-isolation.sql` and
`supabase/tests/platform-rls-baseline.sql` via the Supabase **Management API**. Each suite seeds two orgs +
users, impersonates them via `request.jwt.claims`, asserts cross-org read/write is denied and same-org access
is allowed, and cleans up after itself. **Fails closed** without credentials.

Credentials (both required):
- `SECURITY_SUPABASE_REF` — the same non-production ref as tier 2.
- `SECURITY_SUPABASE_TOKEN` — a Supabase **Management API** access token (Account → Access Tokens). This is
  a different credential from the service key; the suites run SQL through the Management API, not PostgREST.

## GitHub secrets the founder must set

Add these as repository (or environment) secrets so the `db` job in `security.yml` can run:

| Secret | Tier | What it is |
|---|---|---|
| `SECURITY_SUPABASE_REF` | 2 + 3 | staging/synthetic project ref — **never** the prod ref |
| `SECURITY_SUPABASE_SERVICE_KEY` | 2 | staging service-role key |
| `SECURITY_SUPABASE_TOKEN` | 3 | Supabase Management API token |

Until these exist, the `db` job is red (fail-closed) and is deliberately **not** run on PRs — only on
`workflow_dispatch` and on pushes to the security branches — so it never blocks a PR while staging is unwired.
The `static` job runs regardless.

## Local rehearsal without staging

Tiers 2 and 3 can be rehearsed against the local `r3` prod-schema replica (localhost:55432) with `psql`: run
the tier-2 introspection query or a tier-3 suite assertion inside a `BEGIN … ROLLBACK` so the replica stays
pristine. This is how the non-vacuousness proofs in `project-security-followups` / the evidence directory were
produced. It is a rehearsal aid, not the gate — the gate runs the scripts as-integrated against staging.
