# create_new_template_version is permanently broken on a missing column

**Status:** open, deliberately not fixed in the November 2026 security release
**Opened:** 2026-11-06
**Priority:** medium — the function cannot succeed for any caller, but nothing
in the frontend currently calls it, so no user is hitting it today

## What is wrong

`public.create_new_template_version(uuid, text, text, text)` snapshots a
workflow's checklist into a new template version. Its body selects
`item_type` from `public.workflow_checklist_templates`:

```sql
'item_type', COALESCE(item_type, 'operational'),
```

`workflow_checklist_templates` has no `item_type` column. Every call raises:

```
ERROR: 42703: column "item_type" does not exist
```

The function has no code path that avoids the column, so it fails for every
caller, in every organization, with every argument.

## It is pre-existing, not caused by the security release

Migration `20261106160000_sec_workflow_structure_rpcs.sql` replaced this
function to add an authorization guard. It did not touch the snapshot body.

The proof is the pre-release capture taken before that migration was applied.
`C:\Users\elock\tesseract-backups\pre-release-20261106\02-restore-functions.sql`
line 457 holds the production definition as it stood beforehand and contains the
same line. The defect predates the release on both sides of the apply.

Confirmed unconditional rather than data-dependent: the same `42703` is raised
against a workflow with zero checklist rows (supplementary test T5b), so it is
not a bad row, it is the column reference itself.

## Why the guard tests expect it to fail

Two tests in the release verification suites assert `42703` from this function
rather than success:

- `verify-migration-a.mjs` T5 — the owner's legitimate path
- `verify-migration-a2.mjs` T5b — a workflow with no checklist rows

They are written to expect the failure so the suites stay honest about what the
release did and did not change. **When this ticket is fixed, both expectations
must be inverted to `SUCCEEDED`**, or the suites will start passing for the
wrong reason.

The guard itself is verified independently of this: the cross-organization
denial test for the same function (T4) reaches the guard and is refused with
`42501` before the body runs, so the authorization fix is proven despite the
body being broken.

## What to decide before fixing

The schema question comes first, and this is why the fix is not a one-liner.

1. **Should `workflow_checklist_templates` have an `item_type` column?**
   Its sibling `asset_checklist_items` distinguishes operational from decision
   items, and the two card components (`OperationalItemCard`,
   `DecisionItemCard`) render from that distinction. If templates are meant to
   carry the distinction forward into instantiated checklists, the column is
   missing and should be added with a default of `'operational'`.
2. **Or is the column reference simply wrong?** If the type is derived at
   instantiation rather than stored on the template, the `COALESCE` should be
   dropped and the key removed from the snapshot payload.

Reading the snapshot consumers (`activate_template_version`, which rebuilds
stages and checklist rows from the stored json) will settle which it is. Do not
guess: dropping the key changes what every future snapshot records, and adding
the column changes the table.

## Scope note

Not fixed in the security release because it is a functional defect with a
schema decision behind it, and the release is confined to authorization. Mixing
them would have made the security change unreviewable.
