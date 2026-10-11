-- ===========================================================================
-- Coverage bulk notification — rehearsal and non-vacuity proof.
--
-- Applies 20261011130000 against production rows inside a transaction that
-- CANNOT commit: the final statement raises deliberately. The harness was
-- probed beforehand — a multi-statement payload here runs in one transaction,
-- and a table created before a raised exception does not survive.
--
-- Section 1 proves the defect is real BEFORE the fix: a two-asset coverage
-- assignment for another user must fail with the NOT NULL violation. A gate
-- that cannot observe its own failure mode is decoration, so this runs first.
--
-- Identities (all real, all in Tesseract):
--   ACTOR     fa46cffc-dafb-4071-a3ea-5536240d462e  elockenvitz@gmail.com
--             (users.coverage_admin = true, so is_coverage_admin() passes)
--   RECIPIENT edcae6bc-3a38-4b7c-a843-63ee5fccb7ae  jefflockenvitz@gmail.com
--             (holds zero coverage rows, so the add is clean)
--   ORG       4b4713e8-d5da-4dc9-a465-c06a71248a12  Tesseract
--   ASSETS    86e88b4c-2a60-4115-afed-da5d42c31a90  MSFT
--             c8d2fbe8-aa26-4932-9558-e8535b9ead06  ORCL
--
-- Both rows are inserted in ONE statement, because the notification triggers
-- are STATEMENT-level and read the `new_rows` / `old_rows` transition tables.
-- Two single-row inserts would take the single-asset branch twice and prove
-- nothing about the bulk path.
-- ===========================================================================
begin;

create temp table rlog (seq serial, line text) on commit drop;

-- ---------------------------------------------------------------------------
-- 1. NON-VACUITY: the defect, before the fix.
-- ---------------------------------------------------------------------------
do $pre$
declare failed boolean := false; msg text;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"fa46cffc-dafb-4071-a3ea-5536240d462e","role":"authenticated"}', true);
  set local role authenticated;
  begin
    insert into coverage (asset_id, user_id, organization_id, coverage_scope, created_by, changed_by)
    values
      ('86e88b4c-2a60-4115-afed-da5d42c31a90','edcae6bc-3a38-4b7c-a843-63ee5fccb7ae',
       '4b4713e8-d5da-4dc9-a465-c06a71248a12','org',
       'fa46cffc-dafb-4071-a3ea-5536240d462e','fa46cffc-dafb-4071-a3ea-5536240d462e'),
      ('c8d2fbe8-aa26-4932-9558-e8535b9ead06','edcae6bc-3a38-4b7c-a843-63ee5fccb7ae',
       '4b4713e8-d5da-4dc9-a465-c06a71248a12','org',
       'fa46cffc-dafb-4071-a3ea-5536240d462e','fa46cffc-dafb-4071-a3ea-5536240d462e');
  exception when not_null_violation then
    failed := true; msg := sqlerrm;
  end;
  reset role;

  if not failed then
    raise exception
      'FAIL 1: the two-asset assignment SUCCEEDED before the fix — the premise of this change is wrong';
  end if;
  insert into rlog(line) values
    ('OK 1  BEFORE the fix, a 2-asset assignment for another user fails: ' || msg);
end $pre$;

-- ---------------------------------------------------------------------------
-- 2. THE FIX UNDER TEST
--    (body identical to
--     supabase/migrations/20261011130000_coverage_bulk_notification_context.sql)
-- ---------------------------------------------------------------------------
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
    IF action_kind = 'removed' THEN
      msg_t := COALESCE(actor_name, 'A coverage admin') ||
               ' removed you from coverage of ' || symbols[1];
    END IF;
  ELSE
    title_t := count_n || ' assets ' || action_kind ||
               (CASE action_kind WHEN 'added' THEN ' to' WHEN 'removed' THEN ' from' END) ||
               ' your coverage';
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
    'asset',
    asset_ids[1],
    jsonb_build_object(
      'action',          action_kind,
      'count',           count_n,
      'asset_id',        asset_ids[1],
      'asset_ids',       to_jsonb(asset_ids),
      'asset_symbols',   to_jsonb(symbols),
      'changed_by',      actor_id,
      'changed_by_name', actor_name
    ),
    false
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. The NOT NULL constraint is untouched — this fix does not weaken it.
-- ---------------------------------------------------------------------------
do $c$
declare nullable text;
begin
  select is_nullable into nullable from information_schema.columns
   where table_schema='public' and table_name='notifications' and column_name='context_id';
  if nullable <> 'NO' then
    raise exception 'FAIL 3: notifications.context_id became nullable (%)', nullable;
  end if;
  insert into rlog(line) values ('OK 3  notifications.context_id is still NOT NULL');
end $c$;

-- ---------------------------------------------------------------------------
-- 4. MULTI-ASSET ASSIGNMENT for another user now succeeds, with a complete
--    and routable notification.
-- ---------------------------------------------------------------------------
do $add$
declare
  n_cov int; n_notif int;
  ctx_type text; ctx_id uuid; data jsonb; ttl text; msg text;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"fa46cffc-dafb-4071-a3ea-5536240d462e","role":"authenticated"}', true);
  set local role authenticated;
  insert into coverage (asset_id, user_id, organization_id, coverage_scope, created_by, changed_by)
  values
    ('86e88b4c-2a60-4115-afed-da5d42c31a90','edcae6bc-3a38-4b7c-a843-63ee5fccb7ae',
     '4b4713e8-d5da-4dc9-a465-c06a71248a12','org',
     'fa46cffc-dafb-4071-a3ea-5536240d462e','fa46cffc-dafb-4071-a3ea-5536240d462e'),
    ('c8d2fbe8-aa26-4932-9558-e8535b9ead06','edcae6bc-3a38-4b7c-a843-63ee5fccb7ae',
     '4b4713e8-d5da-4dc9-a465-c06a71248a12','org',
     'fa46cffc-dafb-4071-a3ea-5536240d462e','fa46cffc-dafb-4071-a3ea-5536240d462e');
  get diagnostics n_cov = row_count;
  reset role;

  if n_cov <> 2 then
    raise exception 'FAIL 4: inserted % coverage rows, expected 2', n_cov;
  end if;

  select count(*) into n_notif from notifications
   where user_id='edcae6bc-3a38-4b7c-a843-63ee5fccb7ae'
     and type='coverage_added'::notification_type;
  if n_notif <> 1 then
    raise exception 'FAIL 4: % coverage_added notifications, expected exactly 1', n_notif;
  end if;

  select context_type, context_id, context_data, title, message
    into ctx_type, ctx_id, data, ttl, msg
    from notifications
   where user_id='edcae6bc-3a38-4b7c-a843-63ee5fccb7ae'
     and type='coverage_added'::notification_type;

  if ctx_id is null then raise exception 'FAIL 4: context_id is NULL'; end if;
  if ctx_type <> 'asset' then
    raise exception 'FAIL 4: context_type is %, expected asset', ctx_type;
  end if;
  if (data->>'asset_id') is null then
    raise exception 'FAIL 4: context_data.asset_id missing';
  end if;
  if (data->>'asset_id')::uuid <> ctx_id then
    raise exception 'FAIL 4: context_data.asset_id does not match context_id';
  end if;
  if jsonb_array_length(data->'asset_ids') <> 2 then
    raise exception 'FAIL 4: asset_ids has % entries, expected 2',
      jsonb_array_length(data->'asset_ids');
  end if;
  if jsonb_array_length(data->'asset_symbols') <> 2 then
    raise exception 'FAIL 4: asset_symbols has % entries, expected 2',
      jsonb_array_length(data->'asset_symbols');
  end if;
  if (data->>'count')::int <> 2 then
    raise exception 'FAIL 4: count is %, expected 2', data->>'count';
  end if;
  -- context_id must be one of the assets actually assigned, not an arbitrary id.
  if not (data->'asset_ids' @> to_jsonb(ctx_id::text)) then
    raise exception 'FAIL 4: context_id % is not in asset_ids %', ctx_id, data->'asset_ids';
  end if;

  insert into rlog(line) values
    ('OK 4  2-asset ADD for another user succeeded; context_id=' || ctx_id
      || ' asset_ids=' || (data->'asset_ids')::text);
  insert into rlog(line) values ('      title:   ' || ttl);
  insert into rlog(line) values ('      message: ' || msg);
end $add$;

-- ---------------------------------------------------------------------------
-- 5. MULTI-ASSET REMOVAL for another user now succeeds too.
-- ---------------------------------------------------------------------------
do $del$
declare n_cov int; ctx_id uuid; data jsonb; ttl text; n_notif int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"fa46cffc-dafb-4071-a3ea-5536240d462e","role":"authenticated"}', true);
  set local role authenticated;
  delete from coverage
   where user_id='edcae6bc-3a38-4b7c-a843-63ee5fccb7ae'
     and asset_id in ('86e88b4c-2a60-4115-afed-da5d42c31a90',
                      'c8d2fbe8-aa26-4932-9558-e8535b9ead06');
  get diagnostics n_cov = row_count;
  reset role;

  if n_cov <> 2 then
    raise exception 'FAIL 5: deleted % coverage rows, expected 2', n_cov;
  end if;

  select count(*) into n_notif from notifications
   where user_id='edcae6bc-3a38-4b7c-a843-63ee5fccb7ae'
     and type='coverage_removed'::notification_type;
  if n_notif <> 1 then
    raise exception 'FAIL 5: % coverage_removed notifications, expected 1', n_notif;
  end if;

  select context_id, context_data, title into ctx_id, data, ttl
    from notifications
   where user_id='edcae6bc-3a38-4b7c-a843-63ee5fccb7ae'
     and type='coverage_removed'::notification_type;

  if ctx_id is null then raise exception 'FAIL 5: context_id is NULL on removal'; end if;
  if jsonb_array_length(data->'asset_ids') <> 2 then
    raise exception 'FAIL 5: removal asset_ids has % entries, expected 2',
      jsonb_array_length(data->'asset_ids');
  end if;
  if (data->>'asset_id')::uuid <> ctx_id then
    raise exception 'FAIL 5: removal context_data.asset_id does not match context_id';
  end if;

  insert into rlog(line) values
    ('OK 5  2-asset REMOVE for another user succeeded; context_id=' || ctx_id);
  insert into rlog(line) values ('      title:   ' || ttl);
end $del$;

-- ---------------------------------------------------------------------------
-- 6. The single-asset path is unchanged — same wording, same anchoring.
-- ---------------------------------------------------------------------------
do $one$
declare ctx_id uuid; data jsonb; ttl text; msg text;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"fa46cffc-dafb-4071-a3ea-5536240d462e","role":"authenticated"}', true);
  set local role authenticated;
  insert into coverage (asset_id, user_id, organization_id, coverage_scope, created_by, changed_by)
  values ('5e31c19e-15fc-4663-ba14-5742e7ad0aa8','edcae6bc-3a38-4b7c-a843-63ee5fccb7ae',
          '4b4713e8-d5da-4dc9-a465-c06a71248a12','org',
          'fa46cffc-dafb-4071-a3ea-5536240d462e','fa46cffc-dafb-4071-a3ea-5536240d462e');
  reset role;

  select context_id, context_data, title, message into ctx_id, data, ttl, msg
    from notifications
   where user_id='edcae6bc-3a38-4b7c-a843-63ee5fccb7ae'
     and type='coverage_added'::notification_type
     and (context_data->>'count')::int = 1;

  if ctx_id <> '5e31c19e-15fc-4663-ba14-5742e7ad0aa8' then
    raise exception 'FAIL 6: single-asset context_id is %, expected the CRM asset', ctx_id;
  end if;
  if ttl <> 'Coverage added: CRM' then
    raise exception 'FAIL 6: single-asset title changed: %', ttl;
  end if;
  insert into rlog(line) values ('OK 6  single-asset path unchanged; title: ' || ttl);
end $one$;

-- ---------------------------------------------------------------------------
-- 7. The org-delete cascade that started this: deleting an organization's
--    coverage no longer aborts. Uses Daniel Adam Capital's 7 coverage rows,
--    which belong to a non-actor — exactly the case that threw.
--    Deletes the COVERAGE ONLY, and rolls back. The organization is NOT
--    deleted here; that needs separate approval.
-- ---------------------------------------------------------------------------
do $cascade$
declare n_cov int; n_notif int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"fa46cffc-dafb-4071-a3ea-5536240d462e","role":"authenticated"}', true);
  set local role authenticated;
  -- As postgres this would skip notifications entirely (auth.uid() is null),
  -- which would prove nothing; so it runs as the real actor.
  reset role;

  delete from coverage where organization_id = 'fd58ca21-8140-4fa7-97eb-87623a3b5d33';
  get diagnostics n_cov = row_count;

  if n_cov <> 7 then
    raise exception 'FAIL 7: deleted % coverage rows for that org, expected 7', n_cov;
  end if;
  insert into rlog(line) values
    ('OK 7  the 7 coverage rows that blocked the org delete now delete cleanly');
end $cascade$;

-- ---------------------------------------------------------------------------
-- FINAL: abort. This transaction cannot commit.
-- ---------------------------------------------------------------------------
do $z$
declare report text;
begin
  select string_agg(line, E'\n' order by seq) into report from rlog;
  raise exception E'COVERAGE REHEARSAL COMPLETE — ROLLING BACK\n%\n(nothing committed)', report;
end $z$;
