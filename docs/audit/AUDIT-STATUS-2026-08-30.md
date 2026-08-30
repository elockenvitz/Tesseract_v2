# Audit status as of 2026-08-30

The four audits in this repository were written against a codebase that has
since changed underneath them. This note says which findings have been closed
and which have not, so that a reader who opens one of those documents does not
act on a finding that was fixed days ago — or, worse, assume the whole document
is stale and skip a finding that is still live.

**No audit conclusion has been rewritten.** Every document is preserved exactly
as its author left it. This file is the only place status is tracked.

| Audit | Written against | Still accurate? |
|---|---|---|
| `platform-readiness-2026-08.md` | `32bf2b3`, 2026-08-26 | **partly** — see below |
| `production-verification-pack.md` | companion to the above | **partly** — same caveats |
| `access-onboarding-audit.md` | 2026-08-27 | **largely** — invite authority since shipped |
| `audits/trade-idea.md` | `12c6225`, 2026-08-29 | **yes** — written after C1 |

---

## Closed since the platform audit was written

**P0-1 — the active-organization pointer is a client-writable column.** Fixed
and deployed. Three migrations landed via PR #211 (`8b11243`):

- `20260826100000_p0_current_org_id_validates_membership.sql` — `current_org_id()`
  now validates an active, unexpired membership, so a forged or stale
  `users.current_organization_id` resolves to NULL and the policies that trust
  it deny rather than serve another tenant.
- `20260826100100_p0_users_authority_column_grants.sql` — the table-wide
  INSERT/UPDATE grant on `public.users` is replaced by a column allowlist.
- `20260826100200_p0_users_authority_column_guard.sql` — a trigger restates the
  invariant so a re-granted privilege cannot silently reopen the bypass.

The audit marked this **[VERIFY]**. It was verified, and it was real.

**P0-5 — the security-critical half of the schema is not in version control.**
Partly closed. `scripts/audit/schema-baseline.mjs` now produces a sanitized
inventory, and `docs/audit/baselines/README.md` records the split between the
committed inventory and the local-only raw snapshot. The underlying point — that
production and `supabase/migrations/` describe different databases — still
stands.

## Partly closed

**P0-2 — 88 live `USING (true)` policies across 44 tables.** Security C1
(2026-08-29) closed nine of those tables: `object_links`, `theme_assets`,
`scenarios`, `tdf_holdings`, `tdf_holdings_snapshots`,
`asset_contribution_history`, `asset_field_history`, `asset_revisions`,
`asset_revision_events`. The ratchet in `scripts/unconditional-policy-guard.mjs`
shrank from 64 table names to 55 to record it.

The count itself has **not** moved: the guard still reports **106 known
findings, 0 new** against production. C1 closed the tables it scoped; it did not
close the schema. The remainder is tracked as a separate hardening backlog.

**Two related items C1 also addressed**, which the platform audit did not
separate out: proprietary research and workflow state on 506 of 912 assets were
readable and full-text searchable by every authenticated user across all 27
organizations, and `anon` held grants on every C1 table. Both are closed —
`assets` now exposes 22 reference columns and no proprietary ones, and `anon`
grants on the fourteen C1 tables are zero. See `docs/security/c1-production-completion.md`.

## Still open, to the best of this note's knowledge

- **P0-3** five service-role edge functions performing no authorization
- **P0-4** the flat, cross-tenant `assets` storage bucket
- **P0-6** AI context retrieval inheriting RLS gaps
- **P1-2** market-data provider keys in the browser bundle
- **P1-3** vulnerable production dependencies with no scanning
- the ~258 tables outside C1 that still carry `anon` grants, and the
  schema-wide `TRUNCATE` over-granting

**P1-1** — the tenant-boundary guard not in CI — should be re-checked rather
than assumed either way. `guard:policies` exists and passes now, but whether it
gates CI is a separate question this note has not verified.

---

## A limitation of `scripts/audit/policy-state.mjs`

The script is safe: it never opens a database connection, takes no credentials,
and only parses `supabase/migrations/*.sql` to track `DROP POLICY` /
`CREATE POLICY` pairs. It runs clean against current `main` and reports 88 live
unconditionally permissive policies.

But that number is now **an over-report**, and the reason matters. Security C1
shipped its remediation as `scripts/sql/security-c1/*.sql`, executed directly
against production — deliberately, and not as `supabase/migrations/` files. A
static reader of the migrations directory therefore cannot see it. The script
still lists `theme_assets` as unconditionally permissive when production has had
an org-scoped policy on it since 2026-08-29.

Treat its output as *what the migration history describes*, not as *what
production enforces*. For the latter, regenerate the inventory with
`scripts/audit/schema-baseline.mjs` and run `npm run guard:policies`.
