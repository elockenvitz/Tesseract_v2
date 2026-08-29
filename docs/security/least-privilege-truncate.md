# Least privilege — schema-wide `TRUNCATE` / `REFERENCES` / `TRIGGER` grants

**Status:** open, not scheduled. Deliberately **not** part of Security C1.
**Raised:** 2026-08-29, from the C1 grant audit.

## The finding

On production, `information_schema.role_table_grants` reports:

| Role | `TRUNCATE` | `UPDATE` | `DELETE` | `INSERT` | `SELECT` |
|---|---|---|---|---|---|
| `anon` | **271 tables** | 269 | 269 | 269 | 271 |
| `authenticated` | **293 tables** | 292 | 293 | 291 | 296 |

**RLS does not apply to `TRUNCATE`.** Row-level security filters `SELECT`,
`INSERT`, `UPDATE` and `DELETE`; `TRUNCATE` is a table-level operation checked
only against the table privilege. So no policy anywhere in this codebase — C1's
included — constrains it.

## Reachability, stated with its limits

This is a **least-privilege defect with no demonstrated exploit path**, not a
live destructive capability:

* PostgREST, which is what an `anon` or `authenticated` JWT actually reaches,
  does not emit `TRUNCATE`. Its table interface is `SELECT`/`INSERT`/`UPDATE`/
  `DELETE` plus RPC.
* Those roles are not reachable over a direct Postgres connection without the
  database password, which is a separate credential.

It should not be described as an exploitable path, and this document exists
partly so it is not. What it is: a privilege that serves no purpose, is not
constrained by the mechanism everything else relies on, and would become
reachable the moment any `SECURITY INVOKER` function issued a `TRUNCATE`, or a
direct connection was ever exposed.

The `anon` grants are the sharper half. They are currently inert only because
every policy on these tables is `TO authenticated`, so `anon` matches no policy
and sees nothing. That is one policy edit away from not being true.

## What C1 did, and did not, do

C1 revoked `ALL` from `anon` and `TRUNCATE`/`REFERENCES`/`TRIGGER` from
`authenticated` on the **15 tables it was already remediating**:

```
tdf_holdings, tdf_holdings_snapshots, theme_assets, object_links, scenarios,
asset_revisions, asset_revision_events, asset_contributions,
contribution_visibility_targets, asset_contribution_history,
asset_field_history, asset_workflow_progress, asset_workflow_priorities, assets
```

It did **not** touch the other ~256 tables. Widening a tenant-boundary release
into hundreds of unrelated tables would have made it unreviewable, and the
security value of the C1 change does not depend on it.

## Proposed shape when it is scheduled

1. Enumerate every table where `anon` holds any privilege, and diff against the
   set that legitimately needs anonymous access — currently only
   `asset_earnings_dates` and `estimate_metrics`, per the guard's
   `ANON_READ_ALLOWLIST`. Everything else: `REVOKE ALL ... FROM anon`.
2. `REVOKE TRUNCATE, REFERENCES, TRIGGER ... FROM authenticated` schema-wide.
   None of the three is used by the application.
3. Add a check to `scripts/audit/schema-baseline.mjs` /
   `scripts/unconditional-policy-guard.mjs` so a re-grant is a guard failure
   rather than something that has to be re-discovered. The inventory already
   records per-table grants for `anon` and `authenticated`, so the data is
   there; nothing asserts on it.
4. The likely root cause is a blanket `GRANT ALL ON ALL TABLES IN SCHEMA public`
   in an early migration, plus `ALTER DEFAULT PRIVILEGES`. Fixing the default
   privileges matters as much as the one-time revoke, or the next table created
   arrives with the same grants.

Step 3 is the one that stops this recurring. Steps 1 and 2 are a single
migration; the risk is a table that turns out to depend on a grant nobody
expected, so it should ship with the same before/after behavioural evidence C1
used rather than as a blind sweep.
