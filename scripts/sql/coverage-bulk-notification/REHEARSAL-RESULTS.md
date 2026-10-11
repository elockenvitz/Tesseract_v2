# Coverage bulk notification — rehearsal results

Ran `scripts/sql/coverage-bulk-notification/rehearsal.sql` against production
(`wfcebeagznzgeuyysbnt`) on 2026-10-11. The script applies migration
`20261011130000`, asserts seven properties, and ends by raising deliberately —
so the transaction **cannot commit**.

**The migration has not been applied. Production is unchanged.**
**Daniel Adam Capital and its records were not deleted.**

---

## Results — 7 of 7

```
OK 1  BEFORE the fix, a 2-asset assignment for another user fails:
      null value in column "context_id" of relation "notifications"
      violates not-null constraint
OK 3  notifications.context_id is still NOT NULL
OK 4  2-asset ADD for another user succeeded;
      context_id=86e88b4c-2a60-4115-afed-da5d42c31a90
      asset_ids=["86e88b4c-...-da5d42c31a90", "c8d2fbe8-...-e8535b9ead06"]
      title:   2 assets added to your coverage
      message: Eric Lockenvitz added 2 assets to your coverage: MSFT, ORCL
OK 5  2-asset REMOVE for another user succeeded;
      context_id=86e88b4c-2a60-4115-afed-da5d42c31a90
      title:   2 assets removed from your coverage
OK 6  single-asset path unchanged; title: Coverage added: CRM
OK 7  the 7 coverage rows that blocked the org delete now delete cleanly
COVERAGE REHEARSAL COMPLETE — ROLLING BACK (nothing committed)
```

### Check 1 is the one that matters

It runs **before** the fix is applied and reproduces the reported error exactly:
`null value in column "context_id" of relation "notifications" violates
not-null constraint`. A gate that cannot observe its own failure mode is
decoration, so the proof that the defect is real comes first and the whole
rehearsal fails if the two-asset assignment ever succeeds beforehand.

### What checks 4 and 5 assert

Not merely "no exception" — the notification contract is verified field by
field:

- `context_id` is not NULL
- `context_type = 'asset'`, the contract every notification pane already routes
- `context_data.asset_id` is present and **equals** `context_id`
- `context_data.asset_ids` holds **both** assets
- `context_data.asset_symbols` holds both symbols
- `context_data.count = 2`
- `context_id` is one of the assets actually assigned, not an arbitrary id

Check 3 confirms the fix does not weaken the schema: `notifications.context_id`
is still `NOT NULL`. The constraint is satisfied rather than removed.

### Check 7

Deletes the 7 coverage rows of `Daniel Adam Capital` **as the real actor**, not
as `postgres` — running as `postgres` leaves `auth.uid()` NULL, both notify
functions return early, and the test would prove nothing. These are the rows
whose cascade aborted the organization delete. They now delete cleanly.

Only the coverage rows were deleted, inside the aborting transaction. The
organization itself was not touched.

## Identities used

All real, all in Tesseract, chosen because the evidence says what they must do:

| role | who | why |
|---|---|---|
| actor | `elockenvitz@gmail.com` | `users.coverage_admin = true`, so `is_coverage_admin()` passes the insert policy |
| recipient | `jefflockenvitz@gmail.com` | holds zero coverage rows, so a two-asset add is clean and unambiguous |
| assets | MSFT, ORCL (and CRM for the single-asset case) | not covered by the recipient anywhere |

Both coverage rows are inserted in **one statement**, because the notification
triggers are STATEMENT-level and read the `new_rows` / `old_rows` transition
tables. Two single-row inserts would take the single-asset branch twice and
prove nothing about the bulk path.

## No residue

| check | expected | actual |
|---|---|---|
| recipient's coverage rows | 0 | 0 |
| recipient's coverage notifications | 0 | 0 |
| Daniel Adam Capital coverage rows | 7 | 7 |
| Daniel Adam Capital still exists | 1 | 1 |
| emitter still writes NULL in production | true | true |
| `coverage_bulk` notifications | 0 | 0 |

The last two rows confirm the rollback: the defect is still live in production,
which is the correct state after a rehearsal.

## Next

Awaiting approval to apply `20261011130000`. On approval: apply, re-run checks
3-7 against the committed state (check 1 will then correctly fail to reproduce,
which is the point), reconcile `supabase_migrations.schema_migrations` by
INSERT, and open a focused PR.
