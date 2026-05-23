# ADR-001 — Multi-tenancy via Postgres RLS

**Status**: Accepted — 2025-01
**Last reviewed**: 2026-05

## Context

Tesseract is a B2B platform: each customer is an "organization" with
its own users, portfolios, trade ideas, notes, decisions, etc. A
single Tesseract deployment serves many orgs at once. Critical
invariant: **no org's data can ever leak into another org's view**.

We had two reasonable ways to enforce that boundary:

- **Application-level filtering** — every query in the React/TS
  client adds `.eq('organization_id', currentOrgId)`. If a developer
  forgets to add the filter, data leaks.
- **Database-level enforcement** — Postgres row-level security (RLS)
  policies, evaluated on every read/write, that resolve the caller's
  active org from their JWT and refuse to return rows from other
  orgs.

## Decision

**Postgres RLS, enforced on every domain table.**

Every domain table carries an `organization_id` column (or is in the
"global" exempt list — `assets`, `currencies`, etc.) and has at
least one RLS policy gating reads and writes on the caller's
active-org membership.

Three helper functions are used everywhere so the policies stay
short:

- `auth.uid()` — current user
- `is_active_org_admin_of_current_org()` — admin check
- `portfolio_in_current_org(p_id)` — portfolio scoping
- `user_is_portfolio_member(p_id)` — collaboration scoping

A custom linter (`scripts/tenant-boundary-lint.mjs`) verifies the
invariants programmatically: every non-exempt table has RLS on,
every org-scoped table has `organization_id NOT NULL`, every such
table has at least one policy. A second linter
(`scripts/frontend-tenant-lint.mjs`) scans React/TS code for
`supabase.from(...)` calls that lack an org filter on org-scoped
tables.

## Consequences

**Good:**

- A frontend developer can't accidentally leak data across orgs even
  if they forget to filter — Postgres refuses the rows.
- The same protection applies to direct API access (anyone with an
  anon key and a JWT only sees their org's data).
- Auditors and security reviewers can verify the invariant by
  reading SQL policies, not by trusting that every code path got
  the filter right.
- New devs don't have to memorize "always filter by org" — the
  database does it.

**Bad:**

- Every query goes through RLS, which has a non-trivial planning
  cost. Mitigated by aggressive use of indexes on `(organization_id,
  ...)` and by hot-path queries that batch.
- Policies are SQL, not TypeScript. Bugs in policies are harder to
  unit-test than bugs in app code.
- Some queries that should be cheap (e.g. "all assets the user can
  see") have to evaluate policy expressions per row. Not a problem
  yet but worth watching.

## Alternatives considered

- **App-layer filtering only.** Rejected: one missed `.eq('organization_id', …)`
  in one PR ships a cross-tenant data leak that's invisible until a
  customer reports it. The blast radius of a forgotten filter is
  enormous and there's no mechanical safeguard.
- **One Postgres schema per org.** Rejected: scaling to hundreds of
  orgs with hundreds of tables each becomes a migration nightmare.
  Also requires routing queries to the right schema, which is its own
  source of bugs.
- **One Postgres database per org.** Rejected: same problem as
  per-schema, plus much higher infrastructure cost. Not justified
  until a single customer needs hard data residency guarantees we
  can't meet with RLS.

## Related

- `docs/ARCHITECTURE.md` § Multi-tenancy model
- `scripts/tenant-boundary-lint.mjs`
- `scripts/frontend-tenant-lint.mjs`
