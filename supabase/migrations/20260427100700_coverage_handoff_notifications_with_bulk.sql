-- ============================================================================
-- Coverage handoff notifications.
--
-- Per the user: when an analyst is added to or removed from coverage, notify
-- them. For bulk uploads, send ONE summary notification per recipient
-- ("12 assets added to your coverage") instead of N notifications. We use
-- statement-level triggers with transition tables to detect bulk and
-- aggregate per (recipient, action) pair in a single fire.
--
-- Self-actions are skipped (you don't notify yourself for adding yourself).
-- System writes (auth.uid() IS NULL) skip notification entirely — those are
-- backfills and shouldn't generate user-facing alerts.
-- ============================================================================

-- ─── Helper: format the message + insert per recipient ───────────────────
-- Encapsulates the "1 vs N" branching used by both INSERT and DELETE
-- triggers below.
CREATE OR REPLACE FUNCTION public._emit_coverage_notification(
  recipient_id  uuid,
  action_kind   text,        -- 'added' | 'removed'
  symbols       text[],      -- distinct symbols, ordered
  asset_ids     uuid[],
  actor_id      uuid
)
RETURNS void
LANGUAGE plpgsql
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
    -- For single-row, point at the asset; for bulk, leave context_id null
    -- and stash the list in context_data so the UI can render a list view.
    CASE WHEN count_n = 1 THEN 'asset' ELSE 'coverage_bulk' END,
    CASE WHEN count_n = 1 THEN asset_ids[1] ELSE NULL END,
    jsonb_build_object(
      'action',         action_kind,
      'count',          count_n,
      'asset_ids',      to_jsonb(asset_ids),
      'asset_symbols',  to_jsonb(symbols),
      'changed_by',     actor_id,
      'changed_by_name', actor_name
    ),
    false
  );
END;
$function$;

-- ─── INSERT trigger (statement-level, bulk-aware) ────────────────────────
CREATE OR REPLACE FUNCTION public.notify_coverage_added_bulk()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  actor    uuid;
  rec      RECORD;
BEGIN
  actor := auth.uid();
  IF actor IS NULL THEN
    RETURN NULL;  -- system writes (backfills) skip notifications
  END IF;

  FOR rec IN
    SELECT user_id,
           array_agg(DISTINCT a.symbol  ORDER BY a.symbol) AS symbols,
           array_agg(DISTINCT a.id      ORDER BY a.id)     AS asset_ids
    FROM new_rows nr
    JOIN assets a ON a.id = nr.asset_id
    WHERE nr.user_id IS NOT NULL
      AND nr.user_id <> actor
    GROUP BY user_id
  LOOP
    PERFORM _emit_coverage_notification(rec.user_id, 'added', rec.symbols, rec.asset_ids, actor);
  END LOOP;

  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS coverage_added_notification ON public.coverage;
CREATE TRIGGER coverage_added_notification
  AFTER INSERT ON public.coverage
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.notify_coverage_added_bulk();

-- ─── DELETE trigger (statement-level, bulk-aware) ────────────────────────
CREATE OR REPLACE FUNCTION public.notify_coverage_removed_bulk()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  actor uuid;
  rec   RECORD;
BEGIN
  actor := auth.uid();
  IF actor IS NULL THEN
    RETURN NULL;
  END IF;

  FOR rec IN
    SELECT user_id,
           array_agg(DISTINCT a.symbol ORDER BY a.symbol) AS symbols,
           array_agg(DISTINCT a.id     ORDER BY a.id)     AS asset_ids
    FROM old_rows o
    JOIN assets a ON a.id = o.asset_id
    WHERE o.user_id IS NOT NULL
      AND o.user_id <> actor
    GROUP BY user_id
  LOOP
    PERFORM _emit_coverage_notification(rec.user_id, 'removed', rec.symbols, rec.asset_ids, actor);
  END LOOP;

  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS coverage_removed_notification ON public.coverage;
CREATE TRIGGER coverage_removed_notification
  AFTER DELETE ON public.coverage
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.notify_coverage_removed_bulk();
