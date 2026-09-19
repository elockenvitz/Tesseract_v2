# Validating the expiry-notification migration on staging

`supabase/migrations/20260907120000_notification_semantic_grouping.sql` is
written and **unapplied everywhere**. It does two irreversible things in one
transaction: it rewrites the surviving row of each group, and it deletes the
copies that folded into it. Both need to be seen working on real rows before
production.

Staging has no migration ledger, so the state it is in is whatever was last run
against it by hand. Check before assuming.

## Before

Capture the rows the migration will touch. This is the rollback material, and
it is the only copy, because the migration deletes.

```sql
-- 1. The whole population, saved off. Export to CSV and keep it.
SELECT * FROM notifications WHERE type = 'price_target_expired';

-- 2. What the migration is about to group, without changing anything.
SELECT
  user_id,
  context_data->>'asset_symbol'            AS symbol,
  left(context_data->>'target_date', 10)   AS expiry_event,
  count(*)                                 AS rows_today,
  count(DISTINCT COALESCE(
    context_data->>'price_target_id',
    CASE WHEN context_type = 'price_target' THEN context_id::text END
  ))                                       AS distinct_targets
FROM notifications
WHERE type = 'price_target_expired'
GROUP BY 1, 2, 3
ORDER BY rows_today DESC;
```

The AMZN row of that second query is the prediction to check against: it should
read `rows_today = 6`, `distinct_targets = 3`. If `distinct_targets` is 6, the
six rows are six different targets and this is not the duplication we think it
is — stop and re-diagnose rather than running the migration.

Also record the count that must not move:

```sql
SELECT count(*) FROM notifications;               -- total
SELECT count(*) FROM notifications WHERE is_read; -- read state
```

## Run

Apply to staging only. Inside a transaction, so a failed assertion rolls the
whole thing back rather than leaving the table half-collapsed:

```sql
BEGIN;
\i supabase/migrations/20260907120000_notification_semantic_grouping.sql
-- run every AFTER check below, then COMMIT or ROLLBACK
```

The index creation is the natural failure point. `notifications_user_group_key_uniq`
cannot be created while two rows still share a key, so if the collapse missed a
group the migration fails there rather than silently proceeding.

## After

```sql
-- 1. One row per (user, asset, expiry event). Must return nothing.
SELECT user_id, group_key, count(*)
FROM notifications
WHERE type = 'price_target_expired' AND group_key IS NOT NULL
GROUP BY 1, 2 HAVING count(*) > 1;

-- 2. AMZN is one row saying three.
SELECT title, message,
       context_data->>'contributing_count' AS count,
       jsonb_array_length(context_data->'contributing') AS detail_rows,
       context_type, context_id
FROM notifications
WHERE type = 'price_target_expired'
  AND context_data->>'asset_symbol' = 'AMZN';

-- 3. The three targets are still named, not just counted.
SELECT jsonb_pretty(context_data->'contributing')
FROM notifications
WHERE type = 'price_target_expired'
  AND context_data->>'asset_symbol' = 'AMZN';

-- 4. Nothing else in the table was touched.
SELECT count(*) FROM notifications WHERE type <> 'price_target_expired';
```

Expected on the AMZN row: `count` and `detail_rows` both 3, `context_type`
`asset`, `context_id` the AMZN asset id, and the contributing array carrying
Bull, Base and Bear with their prices and one shared `target_date`.

## Then prove the producer, not just the backfill

The backfill collapsing history says nothing about whether new duplicates stop.
Re-run the sweep against already-expired data and confirm nothing changes:

```sql
SELECT count(*) FROM notifications WHERE type = 'price_target_expired';
SELECT process_expired_price_targets();     -- no pending rows left, returns 0
SELECT process_all_expired_price_targets(); -- now delegates to the same one
SELECT count(*) FROM notifications WHERE type = 'price_target_expired';
```

Both counts must be identical. Then the real test, which needs a fresh
situation:

1. Create three analyst price targets on one asset with one timeframe, so the
   trigger writes three `price_target_outcomes` rows sharing a `target_date`.
2. Backdate that `target_date` to yesterday.
3. Call `check_and_expire_user_targets(<that user>)` **twice in a row**.
4. Expect exactly one new notification, `contributing_count = 3`, and three
   entries in `contributing`.

Step 3 run twice is the StrictMode case. Two overlapping executions is the
original 3 → 6 mechanism, and it is now defended twice over: `SKIP LOCKED` stops
the second sweep claiming the same outcome rows, and the unique index on
`(user_id, group_key)` folds anything that gets past it.

Then confirm the boundaries hold:

- a fourth target on the same asset with a **different** `target_date`, expired,
  produces a **second** notification
- the same three targets on a **different** asset produce a **separate**
  notification
- an unrelated `price_target_change` on AMZN stays its own row

## Rollback

There is no down migration, and there cannot be a faithful one: the deleted
copies are gone. Recovery is restoring the CSV from step 1, then

```sql
DROP INDEX IF EXISTS notifications_user_group_key_uniq;
```

so the restored duplicates can be inserted. Do not skip the export.

## Only then, production

Production carries the same shape of data and the same unapplied migration. Run
the same before-query there first: if its `rows_today` / `distinct_targets`
profile differs materially from staging, the collapse has not actually been
rehearsed on that shape and staging did not prove what it looked like it proved.
