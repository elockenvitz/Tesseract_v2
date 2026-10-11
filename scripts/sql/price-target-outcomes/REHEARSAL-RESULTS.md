# Rehearsal results — production, 2026-10-11

Ran `scripts/sql/price-target-outcomes/rehearsal.sql` against production
(`wfcebeagznzgeuyysbnt`). The script applies migration `20261011120000`,
asserts ten properties, and ends by raising deliberately — so the transaction
**cannot commit**. Production was verified unchanged afterwards.

The permanent migration has **not** been applied.

---

## Harness proof, first

The pattern is only trustworthy if the Management API runs a multi-statement
payload inside one transaction. Probed before trusting it:

```sql
begin;
create table public._rehearsal_probe_zz (x int);
do $$ begin raise exception 'PROBE_ABORT'; end $$;
```

The error came back, and `_rehearsal_probe_zz` **did not exist** afterwards.
One transaction; an exception discards the whole payload.

## Assertions — 10 of 10 passed

```
OK 3a  rows preserved=30  owners derived=30  fabricated=0
OK 3b  no unconditional predicate; policies now=2
OK 3c  anon revoked; authenticated now holds SELECT,UPDATE
OK 3d  Tesseract user keeps 27 rows and all 7 timeline rows
OK 3e  Caffrey user: own rows=3  timeline=0  escaped=0  (was 30 / 7 / 27)
OK 3f  cross-tenant UPDATE touched 0 rows
OK 3g  forged owner discarded and re-derived to the parent's org
OK 3h  price_target_id is immutable; repointing refused
OK 3i  unresolvable row quarantined to NULL: preserved=1 visible=0
OK 3j  live write path created an outcome owned by the writer's org
REHEARSAL COMPLETE — ROLLING BACK
(all assertions passed; nothing committed)
```

Each assertion raises its own message on failure, so reaching the final abort
is what proves the cases passed rather than merely not erroring.

The line that matters most is **3e**: the foreign tenant went from reading
30 rows, 7 of them rendered on the Decision Timeline, with 27 rows whose parent
it could not see — to reading only its own 3, zero timeline rows, and zero rows
outliving an invisible parent. The child now agrees with its parent.

**3g, 3h and 3i exist to prove the guard is not decoration.** 3g forges an
`organization_id` and shows the trigger discards it. 3h repoints a row at a
foreign parent and shows it is refused. 3i manufactures the quarantine case
that does not occur in today's data — strips a parent's organization, confirms
the child resolves to NULL, is preserved, and is invisible to the very
organization that would otherwise own it.

## Production unchanged — 11 of 11

| check | expected | actual |
|---|---|---|
| `organization_id` column exists | 0 | 0 |
| derivation fn `price_target_outcome_org` | 0 | 0 |
| stamp trigger present | 0 | 0 |
| AUTH_ONLY SELECT policy still live | 1 | **1** |
| policies on the table | 3 | 3 |
| anon grants | 7 | 7 |
| total rows | 30 | 30 |
| rows carrying the 3f write attempt | 0 | 0 |
| rows carrying the 3j test price 123.45 | 0 | 0 |
| parents with NULL org (3i artifact) | 0 | 0 |
| harness probe table | 0 | 0 |

The vulnerability is still open — which is the correct state after a rehearsal,
and the reason this document is not `APPLIED.md`.

## Next

Awaiting explicit approval to apply `20261011120000` for real. On approval:
apply, re-run these assertions against the committed state, reconcile
`supabase_migrations.schema_migrations` by INSERT (the query endpoint writes no
ledger row), then refresh `docs/audit/baselines/ci-policy-inventory.json` from
production **after** deployment.
