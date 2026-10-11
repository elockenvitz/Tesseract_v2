-- ============================================================================
-- Coverage notifications: stop writing a NULL context_id.
--
-- The defect
-- ----------
-- `_emit_coverage_notification` has written `context_id = NULL` on purpose
-- since `20260427100700_coverage_handoff_notifications_with_bulk.sql`, whenever
-- a recipient's change covers more than one asset:
--
--     CASE WHEN count_n = 1 THEN 'asset' ELSE 'coverage_bulk' END,
--     CASE WHEN count_n = 1 THEN asset_ids[1] ELSE NULL END,
--
-- but `notifications.context_id` is `uuid NOT NULL` with no default
-- (`20250827230714_crimson_paper.sql:51`). That migration added the
-- NULL-writing branch and never dropped the constraint, so the two halves of
-- it contradict each other and the bulk branch has never been able to insert.
--
-- Proof it never ran, measured in production 2026-10-11:
--   * 0 notifications with `context_type = 'coverage_bulk'`
--   * 0 notifications of type `coverage_added` or `coverage_removed`, ever,
--     though both are in the `notification_type` enum
--
-- Blast radius
-- ------------
-- Both directions reach this function through statement-level triggers on
-- `coverage`: `coverage_added_notification` → `notify_coverage_added_bulk`
-- (INSERT) and `coverage_removed_notification` → `notify_coverage_removed_bulk`
-- (DELETE). So assigning OR removing 2+ coverage assets for another person has
-- always failed — anywhere in the app, not only in the ops portal.
--
-- It hid because both callers skip rows where `user_id = actor` and return
-- early when `auth.uid()` is NULL, so self-assigned coverage and every
-- service_role/SQL write were unaffected. It only throws when one person
-- changes coverage for another.
--
-- Because `coverage.organization_id` is `ON DELETE CASCADE`, this also made
-- organization deletion impossible for any org holding 2+ coverage rows for a
-- single non-actor: the failed notification insert aborts the whole delete.
-- Six production orgs were blocked this way.
--
-- The fix
-- -------
-- Use the notification contract that already exists and already works, rather
-- than inventing a `coverage_bulk` context no client has ever handled:
--
--   context_type   always 'asset'
--   context_id     always asset_ids[1] — never NULL, so the column's
--                  constraint is satisfied rather than fought
--   context_data   carries `asset_id` (singular, what
--                  `src/lib/notifications/grouping.ts` reads first) AND the
--                  complete `asset_ids` / `asset_symbols` lists, so no
--                  information is lost and a list view remains possible
--
-- Nothing else changes: the title and message text, the single-asset grammar,
-- the recipient grouping and the actor-skip are all preserved exactly.
--
-- Why not drop the NOT NULL instead: `coverage_bulk` has no handler in
-- `NotificationCenter.tsx`, `NotificationPane.tsx` or `NotificationPanel.tsx`,
-- so the insert would succeed and then navigate nowhere. Dropping the
-- constraint also makes a NULL `context_id` legal for all 20+ other
-- notification producers, which is a far wider change for the same outcome.
--
-- RLS posture: unchanged. This replaces one `SECURITY DEFINER` function body.
-- No table, policy, grant or column is touched, and `notifications` keeps its
-- `context_id NOT NULL`.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._emit_coverage_notification(
  recipient_id uuid,
  action_kind  text,
  symbols      text[],
  asset_ids    uuid[],
  actor_id     uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  count_n     int;
  actor_name  text;
  title_t     text;
  msg_t       text;
  symbols_str text;
BEGIN
  count_n := array_length(symbols, 1);
  IF count_n IS NULL OR count_n = 0 THEN RETURN; END IF;

  -- A notification must point at something. The caller groups by recipient and
  -- always passes at least one asset id alongside the symbols; if that ever
  -- stops being true, fail loudly here rather than writing a row the
  -- notification UI cannot route.
  IF array_length(asset_ids, 1) IS NULL OR asset_ids[1] IS NULL THEN
    RAISE EXCEPTION
      '_emit_coverage_notification: % symbol(s) for recipient % carried no asset id',
      count_n, recipient_id;
  END IF;

  SELECT COALESCE(first_name || ' ' || last_name, email) INTO actor_name
  FROM users WHERE id = actor_id;

  IF count_n = 1 THEN
    title_t := CASE action_kind
      WHEN 'added'   THEN 'Coverage added: ' || symbols[1]
      WHEN 'removed' THEN 'Coverage removed: ' || symbols[1]
    END;
    msg_t := COALESCE(actor_name, 'A coverage admin') || ' ' || action_kind ||
             ' you to coverage of ' || symbols[1];
    -- Adjust grammar for 'removed' which reads "removed you from"
    IF action_kind = 'removed' THEN
      msg_t := COALESCE(actor_name, 'A coverage admin') ||
               ' removed you from coverage of ' || symbols[1];
    END IF;
  ELSE
    title_t := count_n || ' assets ' || action_kind ||
               (CASE action_kind WHEN 'added' THEN ' to' WHEN 'removed' THEN ' from' END) ||
               ' your coverage';
    -- Show first ~5 symbols inline so the recipient can see WHICH assets.
    symbols_str := array_to_string(symbols[1:LEAST(5, count_n)], ', ');
    IF count_n > 5 THEN
      symbols_str := symbols_str || ', +' || (count_n - 5) || ' more';
    END IF;
    msg_t := COALESCE(actor_name, 'A coverage admin') || ' ' || action_kind || ' ' ||
             count_n || ' assets ' ||
             (CASE action_kind WHEN 'added' THEN 'to' WHEN 'removed' THEN 'from' END) ||
             ' your coverage: ' || symbols_str;
  END IF;

  INSERT INTO notifications (
    user_id, type, title, message, context_type, context_id, context_data, is_read
  ) VALUES (
    recipient_id,
    (CASE action_kind WHEN 'added' THEN 'coverage_added'::notification_type
                      WHEN 'removed' THEN 'coverage_removed'::notification_type END),
    title_t,
    msg_t,
    -- One contract for both shapes. A multi-asset notification anchors on the
    -- first asset so `context_id` is always a real, routable id, and the full
    -- list travels in context_data for any surface that wants to render it.
    'asset',
    asset_ids[1],
    jsonb_build_object(
      'action',          action_kind,
      'count',           count_n,
      -- Singular key: what src/lib/notifications/grouping.ts reads first.
      'asset_id',        asset_ids[1],
      -- The complete lists. Nothing is lost by anchoring on the first asset.
      'asset_ids',       to_jsonb(asset_ids),
      'asset_symbols',   to_jsonb(symbols),
      'changed_by',      actor_id,
      'changed_by_name', actor_name
    ),
    false
  );
END;
$function$;
