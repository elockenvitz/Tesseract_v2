# Allocation security tests

Proves the tenant boundary and the two authorities for the allocation domain.
Run against a **disposable** database only — the fixtures create organisations
and users and flip RLS contexts. Never point this at production.

## Files

| File | What it proves |
|---|---|
| `00_harness.sql` | principals, assertions, fixtures. Loaded by the others. |
| `10_authority_cases.sql` | the 18 required authority and isolation cases |
| `20_adversarial.sql` | 7 adversarial cases — the client is assumed to be lying |
| `30_migration_modes.sql` | M1's two environments, plus M2's two abort conditions |
| `40_catalog.sql` | what `pg_policies` and `pg_proc` must say after M3 |

## Running

```
supabase db reset                      # or any scratch database
psql "$SCRATCH_DB" -f 10_authority_cases.sql
psql "$SCRATCH_DB" -f 20_adversarial.sql
psql "$SCRATCH_DB" -f 40_catalog.sql
```

`30_migration_modes.sql` is the exception: Mode B interleaves assertions with
migration application, so its three sections run either side of `M1` and `M2`.
The apply points are marked in the file.

Every file ends in `ROLLBACK`, so a run leaves no rows behind and the suite is
rerunnable without a reset.

## Why the tests look like this

**They become real principals.** Each case sets `request.jwt.claims` and
`SET LOCAL ROLE authenticated`, so the policies decide the outcome. Calling
`is_allocation_team_admin()` directly would prove the function works and
nothing about whether any policy uses it.

**Refusal has two shapes.** An `INSERT` blocked by RLS raises
`check_violation`; an `UPDATE` or `DELETE` blocked by RLS matches zero rows and
raises nothing. `alloc_test.refused()` covers the first,
`alloc_test.affected()` the second. Using only the first would make every
`UPDATE` case pass regardless of the policy.

**The catalog is asserted, not inferred.** Postgres ORs permissive policies, so
a surviving `USING (true)` beside a new restrictive one leaves a table exactly
as open as before while every happy-path test still passes. `40_catalog.sql`
asserts no `true` predicate remains and that no table has two permissive
policies for one command.

**The separation of authorities is asserted structurally.**
`40_catalog.sql` requires `is_org_admin_of` in the team-membership policies and
requires `is_allocation_team_admin` to be **absent** from them. If the latter
ever appears there, an allocation-team admin can appoint peers and the product
model has quietly collapsed — which no behavioural test would notice.
