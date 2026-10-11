# APPLIED — coverage bulk notification context

Applied to production (`wfcebeagznzgeuyysbnt`) on **2026-10-11** with explicit
approval, after a rehearsal that was re-run against the schema as it stood at
apply time.

Migration: `supabase/migrations/20261011130000_coverage_bulk_notification_context.sql`
Ledger: recorded as version `20261011130000`.

**Daniel Adam Capital was not deleted. Its 7 coverage rows and the
organization itself are intact.**

---

## 1. Pre-flight

**The rehearsed function is the shipped function.** Both files carry the same
`CREATE OR REPLACE FUNCTION` statement; extracted from each, comments stripped
and whitespace collapsed:

```
migration function sha256: 1794b6127417683343e837a5e3931e139384f132c0ca2b0ff73b29c871fd7b6a
rehearsed function sha256: 1794b6127417683343e837a5e3931e139384f132c0ca2b0ff73b29c871fd7b6a
MATCH
```

**No drift.** Eight structural assertions against the live emitter, all
matching: argument list `recipient_id uuid, action_kind text, symbols text[],
asset_ids uuid[], actor_id uuid`; still wrote `ELSE 'coverage_bulk'` and
`THEN asset_ids[1] ELSE NULL END`; had no singular `asset_id` key; already
carried `asset_ids`; insert column list unchanged; `SECURITY DEFINER` with
`search_path` pinned to `public, pg_temp`.

Both notification triggers were still in place
(`coverage_added_notification` → `notify_coverage_added_bulk`,
`coverage_removed_notification` → `notify_coverage_removed_bulk`), the enum
still carried `coverage_added` and `coverage_removed`, and production still had
**zero** `coverage_bulk` notifications.

The rehearsal was then re-run in full against that schema: **7 of 7**,
including check 1 reproducing the reported error before the fix.

## 2. Post-apply verification — 6 of 6

Writes run inside a transaction that ends by raising, so only the probes roll
back; the migration stays applied.

```
OK P3  notifications.context_id is still NOT NULL
OK P3b no NULL branch, no coverage_bulk, asset_id + asset_ids both written, still DEFINER
OK P4  2-asset ADD succeeded; context_id=86e88b4c-2a60-4115-afed-da5d42c31a90 count=2 asset_ids=2
       2 assets added to your coverage / Eric Lockenvitz added 2 assets to your coverage: MSFT, ORCL
OK P5  2-asset REMOVE succeeded; 2 assets removed from your coverage
OK P6  single-asset path unchanged; Coverage added: CRM
OK P7  the 7 coverage rows that blocked the org delete now delete cleanly
```

**P3 and P3b are the pair that matter structurally:** the constraint was not
weakened, and the applied body genuinely lost its NULL branch rather than
merely being replaced. P4 and P5 assert the contract field by field —
`context_id` non-NULL, `context_type = 'asset'`,
`context_data.asset_id = context_id`, `asset_ids` holding both assets,
`count = 2`, and `context_id` being one of the assets actually changed rather
than an arbitrary id.

P7 deletes **coverage rows only**, inside the aborting transaction. The
organization was not touched.

## 3. No residue, and nothing else moved

| check | expected | actual |
|---|---|---|
| fix is applied (no NULL branch) | true | true |
| `notifications.context_id` nullable | NO | NO |
| probe coverage rows left behind | 0 | 0 |
| probe notifications left behind | 0 | 0 |
| Daniel Adam Capital coverage rows | 7 | 7 |
| Daniel Adam Capital still exists | 1 | 1 |
| ledger row recorded | 1 | 1 |

## 4. Ledger

```sql
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261011130000', 'coverage_bulk_notification_context', null)
on conflict (version) do nothing;
```

`statements` is NULL deliberately — the CLI did not run this. No SQL was
re-executed.

## 5. What changes for users

Bulk coverage notifications **begin existing**. Before this, a multi-asset
coverage change for another person threw and the whole operation failed, so
there is no backlog to flood — only new operations produce notifications. A
multi-asset notification anchors on the first asset and carries the complete
list in `context_data`, so the existing `case 'asset'` routing in all three
notification panes handles it with no client change.

Unblocked by this: multi-asset coverage assignment and removal for another
analyst anywhere in the app, and organization deletion for the six
organizations that were stuck behind it.

## 6. RLS posture

Unchanged. One `SECURITY DEFINER` function body was replaced. No table,
policy, grant or column was altered, and `notifications.context_id` keeps its
`NOT NULL` constraint — the fix satisfies the constraint rather than removing
it.

## 7. Known weakness this exposed in the other lane

The atomic-org-delete rehearsal's key assertion used **this bug** as its
failure mode. With the bug fixed, that fixture no longer fails and the
assertion would pass vacuously. It is being re-pointed at a stable failure
injection (`decision_reviews` / `messages`, both `ON DELETE NO ACTION` on
`organizations`) before that lane is applied.
