-- ============================================================================
-- One investment situation, one notification.
--
-- The defect
-- ----------
-- AMZN had three expired price targets and the analyst was shown SIX
-- notifications. Two independent faults produced that number:
--
--   1. NO SEMANTIC GROUPING. Every raw `price_target_outcomes` row emitted its
--      own notification. Three expired targets on one name is one situation —
--      "AMZN targets expired, 3 need review" — not three lines to dismiss.
--
--   2. NO IDEMPOTENCY ON THE SWEEP. `check_and_expire_user_targets` runs a
--      read-then-write loop: it selects the pending outcomes, then updates
--      them and emits. Nothing locked the rows it had claimed, so two
--      overlapping executions each saw the same three pending records and each
--      emitted three notifications. The client fires that sweep from a mount
--      effect in `ExpiredTargetsAlert`, which React StrictMode double-invokes,
--      so the two executions overlap by construction. 3 + 3 = 6.
--
--   3. A SECOND PRODUCER WITH A GUARD THAT COULD NEVER FIRE.
--      `process_all_expired_price_targets` (added by 20260412000000) is a
--      parallel implementation of the same alert. Its only de-duplication test
--      was `context_data->>'price_target_id'`, a key `notify_price_target_
--      expired` has never written — so it could not see the rows it existed to
--      suppress, and it reads `price_targets` (the org-level bull/base/bear
--      table) for `user_id`/`target_date`/`is_expired` columns that live on
--      `analyst_price_targets` instead. Left in place it is a third copy per
--      target waiting for someone to schedule it.
--
-- The fix
-- -------
--   * `notifications.group_key` — a semantic identity, with a UNIQUE index on
--     (user_id, group_key). Identity is org + portfolio + asset + situation +
--     event window. Never a display string, never a bare ticker.
--   * `upsert_grouped_notification` — INSERT ... ON CONFLICT DO UPDATE that
--     folds a contributing record into the existing row. Contributing records
--     are a SET, so reprocessing the same record changes nothing at all.
--   * `SKIP LOCKED` on both sweeps, so concurrent executions cannot claim the
--     same outcome row.
--   * `process_all_expired_price_targets` becomes a thin delegate to the one
--     canonical producer, rather than a second producer racing it.
--
-- The same key is built in TypeScript by `src/lib/notifications/grouping.ts`,
-- whose test asserts the two templates are identical.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The identity column
-- ----------------------------------------------------------------------------

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS group_key text;

COMMENT ON COLUMN public.notifications.group_key IS
  'Semantic identity of the underlying situation: '
  '<situation>|org:<id>|pf:<id>|asset:<id>|w:<window>. NULL means the type '
  'does not consolidate — one record, one notification. Mirrored in '
  'src/lib/notifications/grouping.ts.';

-- ----------------------------------------------------------------------------
-- 2. The key builder. Mirrors notificationGroupKey() exactly.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notification_group_key(
  p_situation   text,
  p_org         uuid,
  p_portfolio   uuid,
  p_asset       uuid,
  p_window      text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  -- An asset-scoped situation with no asset has no identity worth grouping on.
  -- Returning NULL leaves the row ungrouped rather than folding unrelated
  -- situations together under a placeholder.
  SELECT CASE
    WHEN p_asset IS NULL THEN NULL
    ELSE p_situation
      || '|org:'   || COALESCE(p_org::text, '-')
      || '|pf:'    || COALESCE(p_portfolio::text, '-')
      || '|asset:' || p_asset::text
      || '|w:'     || COALESCE(p_window, '-')
  END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Collapse the duplicates already in storage, THEN add the unique index.
--
--    Order matters: the index cannot be created while the rows it forbids are
--    still present. Keep the earliest row of each group, fold the rest into
--    its provenance, delete the folded copies.
-- ----------------------------------------------------------------------------

-- Stamp the key onto every existing expiry notification.
UPDATE public.notifications n
SET group_key = public.notification_group_key(
      'price_target_expired',
      NULLIF(n.context_data->>'organization_id', '')::uuid,
      NULL,
      COALESCE(
        NULLIF(n.context_data->>'asset_id', '')::uuid,
        CASE WHEN n.context_type = 'asset' THEN n.context_id END
      ),
      to_char(n.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
    )
WHERE n.type = 'price_target_expired'
  AND n.group_key IS NULL;

-- Fold provenance into the survivor of each group.
WITH ranked AS (
  SELECT
    id,
    user_id,
    group_key,
    context_data,
    context_id,
    context_type,
    ROW_NUMBER() OVER (PARTITION BY user_id, group_key ORDER BY created_at, id) AS rn
  FROM public.notifications
  WHERE type = 'price_target_expired'
    AND group_key IS NOT NULL
),
folded AS (
  SELECT
    user_id,
    group_key,
    -- The contributing records, de-duplicated. Producer A wrote the price
    -- target id into context_id; producer B, had it ever run, would have put
    -- it in context_data. Read both.
    ARRAY(
      SELECT DISTINCT x FROM unnest(array_agg(
        COALESCE(
          NULLIF(context_data->>'price_target_id', ''),
          CASE WHEN context_type = 'price_target' THEN context_id::text END,
          id::text
        )
      )) AS x WHERE x IS NOT NULL
    ) AS members,
    MIN(id::text) FILTER (WHERE rn = 1) AS survivor
  FROM ranked
  GROUP BY user_id, group_key
)
UPDATE public.notifications n
SET context_data = COALESCE(n.context_data, '{}'::jsonb) || jsonb_build_object(
      'contributing_ids',   to_jsonb(f.members),
      'contributing_count', cardinality(f.members)
    ),
    title = CASE
      WHEN cardinality(f.members) > 1
        THEN COALESCE(n.context_data->>'asset_symbol', 'This asset') || ' targets expired'
      ELSE n.title
    END,
    message = CASE
      WHEN cardinality(f.members) > 1
        THEN cardinality(f.members)::text || ' targets need review'
      ELSE n.message
    END
FROM folded f
WHERE n.id::text = f.survivor;

-- Drop the copies that folded away.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY user_id, group_key ORDER BY created_at, id) AS rn
  FROM public.notifications
  WHERE type = 'price_target_expired'
    AND group_key IS NOT NULL
)
DELETE FROM public.notifications n
USING ranked r
WHERE n.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_group_key_uniq
  ON public.notifications (user_id, group_key)
  WHERE group_key IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 4. The canonical grouped emitter.
--
--    Every producer of a consolidating situation goes through this. It is the
--    single place a semantic notification comes into existence, which is what
--    stops two producers racing into two rows.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.upsert_grouped_notification(
  p_user_id      uuid,
  p_type         notification_type,
  p_group_key    text,
  p_member_id    text,
  p_title        text,
  p_message      text,
  p_context_type text,
  p_context_id   uuid,
  p_context_data jsonb DEFAULT '{}'::jsonb,
  -- Rendered when the group holds more than one record. Left NULL for
  -- situations that have no plural form yet, which then keep the single copy.
  p_group_title   text DEFAULT NULL,
  p_group_message text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id      uuid;
  v_members jsonb;
  v_count   integer;
BEGIN
  IF p_user_id IS NULL OR p_group_key IS NULL THEN
    RETURN NULL;
  END IF;

  v_members := CASE
    WHEN p_member_id IS NULL THEN '[]'::jsonb
    ELSE jsonb_build_array(p_member_id)
  END;

  INSERT INTO public.notifications (
    user_id, type, title, message, context_type, context_id, context_data,
    group_key, is_read
  ) VALUES (
    p_user_id, p_type, p_title, p_message, p_context_type, p_context_id,
    COALESCE(p_context_data, '{}'::jsonb) || jsonb_build_object(
      'contributing_ids',   v_members,
      'contributing_count', jsonb_array_length(v_members)
    ),
    p_group_key, false
  )
  ON CONFLICT (user_id, group_key) WHERE group_key IS NOT NULL
  DO UPDATE SET
    context_data = notifications.context_data || jsonb_build_object(
      'contributing_ids', (
        -- A SET, not a list. Reprocessing a record that already contributed
        -- must leave the row byte-identical — this is the idempotency the
        -- whole migration turns on.
        SELECT COALESCE(jsonb_agg(DISTINCT m), '[]'::jsonb)
        FROM jsonb_array_elements_text(
          COALESCE(notifications.context_data->'contributing_ids', '[]'::jsonb) || v_members
        ) AS m
      )
    )
  RETURNING id INTO v_id;

  -- Recompute the count and the reader-facing copy from what the row now
  -- holds, rather than trusting an increment.
  SELECT jsonb_array_length(COALESCE(context_data->'contributing_ids', '[]'::jsonb))
    INTO v_count
  FROM public.notifications WHERE id = v_id;

  UPDATE public.notifications
  SET context_data = context_data || jsonb_build_object('contributing_count', v_count),
      title   = CASE WHEN v_count > 1 AND p_group_title   IS NOT NULL THEN p_group_title   ELSE title   END,
      message = CASE WHEN v_count > 1 AND p_group_message IS NOT NULL
                     THEN replace(p_group_message, '{count}', v_count::text)
                     ELSE message END
  WHERE id = v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_grouped_notification(
  uuid, notification_type, text, text, text, text, text, uuid, jsonb, text, text
) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. The expiry emitter, now consolidating.
--
--    Signature is unchanged so both existing sweeps keep calling it.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_price_target_expired(
  p_price_target_id UUID,
  p_user_id         UUID,
  p_asset_id        UUID,
  p_asset_name      TEXT,
  p_asset_symbol    TEXT,
  p_scenario_name   TEXT,
  p_target_price    NUMERIC,
  p_target_date     DATE
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_key text;
BEGIN
  SELECT organization_id INTO v_org
  FROM analyst_price_targets WHERE id = p_price_target_id;

  v_key := notification_group_key(
    'price_target_expired',
    v_org,
    NULL,
    p_asset_id,
    to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')
  );

  -- No asset means no identity. Rather than drop the alert, fall back to the
  -- ungrouped insert the function has always done.
  IF v_key IS NULL THEN
    INSERT INTO notifications (
      user_id, type, title, message, context_type, context_id, context_data
    ) VALUES (
      p_user_id, 'price_target_expired',
      'Price Target Expired: ' || COALESCE(p_asset_symbol, '') || ' ' || COALESCE(p_scenario_name, ''),
      'Your ' || COALESCE(p_scenario_name, 'price') || ' price target of $' || ROUND(p_target_price, 2) ||
      ' expired on ' || TO_CHAR(p_target_date, 'Mon DD, YYYY') || '. Please set a new target for this scenario.',
      'price_target', p_price_target_id,
      jsonb_build_object('price_target_id', p_price_target_id, 'expired_at', NOW())
    );
    RETURN;
  END IF;

  PERFORM upsert_grouped_notification(
    p_user_id,
    'price_target_expired',
    v_key,
    p_price_target_id::text,
    -- Singular copy. Kept verbatim: for one expired target it says more than
    -- any summary could.
    'Price Target Expired: ' || p_asset_symbol || ' ' || p_scenario_name,
    'Your ' || p_scenario_name || ' price target of $' || ROUND(p_target_price, 2) || ' for ' || p_asset_name ||
    ' (' || p_asset_symbol || ') expired on ' || TO_CHAR(p_target_date, 'Mon DD, YYYY') ||
    '. Please set a new target for this scenario.',
    -- The destination is the asset. "3 targets need review" is answered on the
    -- asset page, not on any one of the three target records.
    'asset',
    p_asset_id,
    jsonb_build_object(
      'organization_id', v_org,
      'asset_id',        p_asset_id,
      'asset_name',      p_asset_name,
      'asset_symbol',    p_asset_symbol,
      'price_target_id', p_price_target_id,
      'scenario_name',   p_scenario_name,
      'target_price',    p_target_price,
      'target_date',     p_target_date,
      'expired_at',      NOW()
    ),
    p_asset_symbol || ' targets expired',
    '{count} targets need review'
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. Both sweeps claim their rows before emitting.
--
--    `FOR UPDATE OF pto SKIP LOCKED` is the fix for 3 -> 6: a concurrent sweep
--    skips the outcome rows this one has claimed instead of re-reading them as
--    still pending.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.process_expired_price_targets()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expired_count INTEGER := 0;
  v_record RECORD;
BEGIN
  FOR v_record IN
    SELECT
      pto.id AS outcome_id, pto.price_target_id, pto.user_id, pto.asset_id,
      pto.target_price, pto.target_date, pto.scenario_type,
      a.name AS asset_name, a.symbol AS asset_symbol
    FROM price_target_outcomes pto
    JOIN assets a ON a.id = pto.asset_id
    JOIN analyst_price_targets apt ON apt.id = pto.price_target_id
    WHERE pto.status = 'pending'
      AND pto.target_date < CURRENT_DATE
      AND COALESCE(apt.is_rolling, false) = false
    FOR UPDATE OF pto SKIP LOCKED
  LOOP
    UPDATE price_target_outcomes
    SET status = 'expired', evaluated_at = NOW(), updated_at = NOW(),
        notes = COALESCE(notes, '') ||
          CASE WHEN notes IS NOT NULL THEN E'\n' ELSE '' END ||
          'Auto-expired on ' || TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI')
    WHERE id = v_record.outcome_id;

    PERFORM notify_price_target_expired(
      v_record.price_target_id, v_record.user_id, v_record.asset_id,
      v_record.asset_name, v_record.asset_symbol,
      COALESCE(v_record.scenario_type, 'Unknown'),
      v_record.target_price, v_record.target_date
    );

    v_expired_count := v_expired_count + 1;
  END LOOP;

  RETURN v_expired_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_and_expire_user_targets(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expired_count INTEGER := 0;
  v_record RECORD;
BEGIN
  FOR v_record IN
    SELECT
      pto.id AS outcome_id, pto.price_target_id, pto.user_id, pto.asset_id,
      pto.target_price, pto.target_date, pto.scenario_type,
      a.name AS asset_name, a.symbol AS asset_symbol
    FROM price_target_outcomes pto
    JOIN assets a ON a.id = pto.asset_id
    JOIN analyst_price_targets apt ON apt.id = pto.price_target_id
    WHERE pto.user_id = p_user_id
      AND pto.status = 'pending'
      AND pto.target_date < CURRENT_DATE
      AND COALESCE(apt.is_rolling, false) = false
    FOR UPDATE OF pto SKIP LOCKED
  LOOP
    UPDATE price_target_outcomes
    SET status = 'expired', evaluated_at = NOW(), updated_at = NOW(),
        notes = COALESCE(notes, '') ||
          CASE WHEN notes IS NOT NULL THEN E'\n' ELSE '' END ||
          'Auto-expired on ' || TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI')
    WHERE id = v_record.outcome_id;

    PERFORM notify_price_target_expired(
      v_record.price_target_id, v_record.user_id, v_record.asset_id,
      v_record.asset_name, v_record.asset_symbol,
      COALESCE(v_record.scenario_type, 'Unknown'),
      v_record.target_price, v_record.target_date
    );

    v_expired_count := v_expired_count + 1;
  END LOOP;

  RETURN v_expired_count;
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. Retire the second producer.
--
--    It described the same situation from a table that does not carry the
--    columns it reads, guarded by a key the real producer never wrote. Kept as
--    a name so anything already scheduled against it keeps working — but it
--    now delegates, so there is exactly one producer of this alert.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.process_all_expired_price_targets()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN process_expired_price_targets();
END;
$$;
