-- =============================================================================
-- Process attribution and audit history
--
-- WHAT WAS WRONG
--
-- 874 process runs, every one with `started_by` NULL. 186 of 188 completed
-- runs with no `completed_by`. And not one row in `audit_events` for any
-- process action, against 3,101 for Trade Lab and trade ideas — because
-- `audit_events.valid_entity_type` has no process entity, so a process event
-- was not merely unwritten, it was impossible.
--
-- WHY A TRIGGER AND NOT A CLIENT CALL
--
-- Run state is written from ten places: six client files with fifteen write
-- statements, two BEFORE triggers, and two cron functions. Auditing from the
-- client would mean fifteen edits, would miss both cron paths entirely, and
-- would leave every event able to fail silently after its mutation
-- committed. One trigger per table sits below all ten, in the same
-- transaction as the state change.
--
-- WHY NOT record_audit_event()
--
-- It raises `'record_audit_event: no session'` when `auth.uid()` is NULL.
-- Called from a trigger under cron that exception would abort the cron
-- transaction and break `check-ending-rules` every five minutes and
-- `process-branch-ending-rules` every fifteen. So this file adds a sibling
-- writer that tolerates a null session, reproduces the search-text and
-- checksum formulas exactly, and differs only where it must.
--
-- ORIGIN IS AN EXECUTION CONTEXT, NOT AN INTENT
--
--   direct       an authenticated session, not nested inside another trigger
--   cascade      an authenticated session, nested inside another trigger
--   unspecified  no reliable authenticated actor
--
-- `unspecified` is deliberately not called `cron`. A service-role call and a
-- migration arrive the same way, and `pg_trigger_depth()` says only that
-- another trigger is on the stack — never which feature caused it.
--
-- NOT APPLIED. Authored for review.
-- Rollback: 20261023130001_process_attribution_and_audit_DOWN.sql.rollback
-- Test:     supabase/tests/process-attribution-and-audit.sql
-- Depends:  20261023120000 (tenant integrity) should be applied first — see
--           the note on run-event tenancy in record_process_event.
-- =============================================================================

BEGIN;

-- ─── 1. Let Process into the ledger ──────────────────────────────────────────
-- The only change to an existing object. Every current value is preserved;
-- two are added.
ALTER TABLE audit_events DROP CONSTRAINT valid_entity_type;
ALTER TABLE audit_events ADD CONSTRAINT valid_entity_type CHECK (entity_type = ANY (ARRAY[
  'trade_idea', 'pair_trade', 'order', 'execution', 'asset', 'coverage',
  'portfolio', 'simulation', 'user', 'team', 'comment', 'attachment',
  'audit_explorer', 'lab_variant', 'trade_lab_view', 'layout_template',
  'organization', 'morph_session',
  -- added here
  'process_run', 'process_requirement'
]));

-- ─── 2. The writer ───────────────────────────────────────────────────────────
-- SECURITY DEFINER because `authenticated` holds no INSERT on `audit_events`
-- and must not; the whole point is that a client says what happened and never
-- who did it or where.
--
-- `p_org` is passed in rather than read from `current_org_id()`, because under
-- cron there is no session to read one from. Its callers are the three trigger
-- functions in this file and nothing else — they derive it from the row, never
-- from the caller. See each for which column and why.
CREATE OR REPLACE FUNCTION public.record_process_event(
  p_entity_type        text,
  p_entity_id          uuid,
  p_action_type        text,
  p_action_category    text,
  p_org                uuid,
  p_entity_display_name text    DEFAULT NULL,
  p_parent_entity_type text     DEFAULT NULL,
  p_parent_entity_id   uuid     DEFAULT NULL,
  p_from_state         jsonb    DEFAULT NULL,
  p_to_state           jsonb    DEFAULT NULL,
  p_changed_fields     text[]   DEFAULT NULL,
  p_metadata           jsonb    DEFAULT '{}'::jsonb,
  p_asset_id           uuid     DEFAULT NULL,
  p_asset_symbol       text     DEFAULT NULL
) RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor      uuid := auth.uid();
  v_actor_type text;
  v_origin     text;
  v_email      text;
  v_name       text;
  v_now        timestamptz := now();
  v_meta       jsonb;
  v_id         uuid;
BEGIN
  -- An event with no organization is an event nobody can ever read: the
  -- SELECT policy is `org_id = current_org_id() OR is_platform_admin()`.
  -- Refusing is better than writing an invisible row, and because this runs
  -- inside the caller's transaction it also aborts the mutation that could
  -- not be attributed to a tenant.
  IF p_org IS NULL THEN
    RAISE EXCEPTION 'record_process_event: no organization for % %', p_entity_type, p_entity_id;
  END IF;

  IF v_actor IS NULL THEN
    v_actor_type := 'system';
    v_origin     := 'unspecified';
  ELSE
    v_actor_type := 'user';
    -- Depth > 1 means another trigger is already on the stack. That is all it
    -- means, and all this records.
    v_origin     := CASE WHEN pg_trigger_depth() > 1 THEN 'cascade' ELSE 'direct' END;
    SELECT u.email,
           COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email)
      INTO v_email, v_name
      FROM public.users u WHERE u.id = v_actor;
  END IF;

  v_meta := COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('origin', v_origin);

  INSERT INTO public.audit_events (
    occurred_at, recorded_at,
    actor_id, actor_type, actor_role,
    entity_type, entity_id, entity_display_name,
    parent_entity_type, parent_entity_id,
    action_type, action_category,
    from_state, to_state, changed_fields,
    metadata, search_text,
    actor_email, actor_name, asset_symbol, asset_id,
    org_id, team_id, checksum
  ) VALUES (
    v_now, v_now,
    v_actor, v_actor_type, NULL,
    p_entity_type, p_entity_id, p_entity_display_name,
    p_parent_entity_type, p_parent_entity_id,
    p_action_type, p_action_category,
    p_from_state, p_to_state, p_changed_fields,
    v_meta,
    -- Same shape as record_audit_event's, so one search behaves the same
    -- across both families.
    NULLIF(CONCAT_WS(' ', p_entity_display_name, p_action_type,
                     v_meta->>'reason', array_to_string(p_changed_fields, ' '),
                     p_asset_symbol, v_email), ''),
    v_email, v_name, p_asset_symbol, p_asset_id,
    p_org, NULL,
    -- The existing formula, with one difference: actor_type is the VARIABLE,
    -- not the literal 'user' that record_audit_event hardcodes inside its
    -- hash. A system event must hash 'system' or the column disagrees with
    -- its own inputs. For a user event the output is byte-identical.
    encode(sha256(convert_to(jsonb_build_object(
      'occurred_at', v_now, 'actor_id', v_actor, 'actor_type', v_actor_type,
      'entity_type', p_entity_type, 'entity_id', p_entity_id,
      'action_type', p_action_type, 'from_state', p_from_state,
      'to_state', p_to_state, 'org_id', p_org)::text, 'UTF8')), 'hex')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END $function$;

-- No client may call it. The three trigger functions below are SECURITY
-- DEFINER, so inside them the effective user is this function's owner and the
-- revoke does not block them — which is the only reason trigger-only access
-- works at all, and is asserted by the test rather than assumed.
REVOKE ALL ON FUNCTION public.record_process_event(
  text, uuid, text, text, uuid, text, text, uuid, jsonb, jsonb, text[], jsonb, uuid, text
) FROM PUBLIC, anon, authenticated;

-- ─── 3. Run attribution ──────────────────────────────────────────────────────
-- Transition-specific. A run whose `started_by` has been NULL since 2025 must
-- not acquire a starter because somebody edited its stage today, so nothing
-- here fires on an unrelated update.
--
-- `IS NOT TRUE` throughout, never `= false`: `is_completed` is nullable, and
-- `NULL = false` is NULL — the comparison that would silently skip every
-- transition out of a null.
-- Attribution is write-once, by transition. Every path that is not a genuine
-- lifecycle transition is forced back to the stored value, so these columns
-- are not writable by a client at all — only earnable.
--
-- The earlier draft set them ON the transition and left them alone otherwise,
-- which read as safe and was not: `UPDATE asset_workflow_progress SET
-- started_by = <somebody else>` on an already-started run simply stood,
-- because "otherwise" included the forgery. The ELSE branches below are the
-- fix, and they are the whole fix.
CREATE OR REPLACE FUNCTION public.process_run_attribution()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A row that arrives started is attributed to whoever is inserting it —
    -- `auth.uid()`, never the supplied value, and NULL under cron rather
    -- than a fabricated human. A row that arrives not-started carries no
    -- starter at all, whatever the caller put there.
    IF NEW.is_started IS TRUE THEN
      NEW.started_by := auth.uid();
    ELSE
      NEW.started_by := NULL;
    END IF;

    IF NEW.is_completed IS TRUE THEN
      NEW.completed_by := auth.uid();
    ELSE
      NEW.completed_by := NULL;
      NEW.completed_at := NULL;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE — including the UPDATE half of an upsert, which is how the
  -- application's `onConflict: 'asset_id,workflow_id'` writes arrive.

  IF OLD.is_started IS NOT TRUE AND NEW.is_started IS TRUE THEN
    NEW.started_by := auth.uid();                 -- genuine start
  ELSE
    NEW.started_by := OLD.started_by;             -- immutable otherwise
  END IF;

  IF OLD.is_completed IS NOT TRUE AND NEW.is_completed IS TRUE THEN
    NEW.completed_by := auth.uid();               -- genuine completion
  ELSIF OLD.is_completed IS TRUE AND NEW.is_completed IS NOT TRUE THEN
    -- Reopened. A run that is open again was completed by nobody, and a
    -- later recompletion must attribute to whoever recompletes it.
    NEW.completed_by := NULL;
    NEW.completed_at := NULL;
  ELSE
    NEW.completed_by := OLD.completed_by;         -- immutable otherwise
    NEW.completed_at := OLD.completed_at;
  END IF;

  RETURN NEW;
END $function$;
--
-- COMPATIBILITY, checked rather than assumed:
--
-- `InvestmentTimeline.tsx` does supply attribution on two paths — it upserts
-- `started_by: user?.id` when starting a run (:655) and `completed_by:
-- user?.id` when completing one (:677). Both send the session's OWN user, so
-- `auth.uid()` substitutes the identical value and neither path changes
-- behaviour. No other client path writes these columns.
--
-- `completed_at` is now also held to the stored value outside a transition.
-- The same two paths set it together with `is_completed`, which is a genuine
-- transition, so they are unaffected. Nothing else in the codebase writes it.

-- ─── 4. Requirement attribution ──────────────────────────────────────────────
-- `asset_checklist_items`' UPDATE policy carries no column restrictions, so
-- any active member can set `completed_by` to any user id — including one in
-- another organization, since the FK only requires `users(id)`. Verified
-- against production. So this OVERWRITES on the transition rather than
-- filling when NULL: trusting the supplied value would ratify the forgery.
CREATE OR REPLACE FUNCTION public.process_requirement_attribution()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_old text;
  v_new text;
BEGIN
  v_new := COALESCE(NEW.status, CASE WHEN NEW.completed THEN 'completed' ELSE 'unchecked' END);

  IF TG_OP = 'INSERT' THEN
    IF v_new IN ('completed', 'na') THEN
      NEW.completed_by := auth.uid();
    ELSE
      -- A requirement that arrives open carries no completion, whatever the
      -- caller supplied.
      NEW.completed_by := NULL;
      NEW.completed_at := NULL;
    END IF;
    RETURN NEW;
  END IF;

  v_old := COALESCE(OLD.status, CASE WHEN OLD.completed THEN 'completed' ELSE 'unchecked' END);

  IF v_old IS DISTINCT FROM v_new THEN
    IF v_new IN ('completed', 'na') THEN
      NEW.completed_by := auth.uid();
    ELSE
      NEW.completed_by := NULL;
      NEW.completed_at := NULL;
    END IF;
  ELSE
    -- No status transition: attribution is not the caller's to edit. This is
    -- the alternate path that would otherwise stay open — forging
    -- `completed_by` on an already-completed row without touching status.
    NEW.completed_by := OLD.completed_by;
    NEW.completed_at := OLD.completed_at;
  END IF;

  RETURN NEW;
END $function$;

-- ─── 5. Run events ───────────────────────────────────────────────────────────
-- Tenancy comes from the workflow. That is authorization-consistent here and
-- only here: `asset_workflow_progress`'s own INSERT and UPDATE policies
-- require the workflow to be in the caller's organization, so a cross-org run
-- cannot exist — verified. Under cron there is no session, and the workflow is
-- then the only truth available.
CREATE OR REPLACE FUNCTION public.process_run_audit()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org    uuid;
  v_wfname text;
  v_symbol text;
  v_meta   jsonb;
BEGIN
  SELECT w.organization_id, w.name INTO v_org, v_wfname
    FROM public.workflows w WHERE w.id = NEW.workflow_id;
  SELECT a.symbol INTO v_symbol FROM public.assets a WHERE a.id = NEW.asset_id;

  v_meta := jsonb_build_object(
    'workflow_id', NEW.workflow_id,
    'run_id',      NEW.id,
    'stage_key',   NEW.current_stage_key
  );

  IF TG_OP = 'INSERT' THEN
    -- One event per row that arrives started. The branch machinery
    -- (`auto_create_workflow_branch`, BEFORE INSERT on this table) can insert
    -- further rows, and each is a genuinely separate run, so each gets its
    -- own event. A row inserted not-started gets none.
    IF NEW.is_started IS TRUE THEN
      PERFORM public.record_process_event(
        'process_run', NEW.id, 'process.started', 'lifecycle', v_org,
        v_wfname, 'asset', NEW.asset_id,
        NULL,
        jsonb_build_object('is_started', true, 'current_stage_key', NEW.current_stage_key),
        ARRAY['is_started', 'started_by'], v_meta, NEW.asset_id, v_symbol);
    END IF;
    IF NEW.is_completed IS TRUE THEN
      PERFORM public.record_process_event(
        'process_run', NEW.id, 'process.completed', 'lifecycle', v_org,
        v_wfname, 'asset', NEW.asset_id,
        NULL, jsonb_build_object('is_completed', true),
        ARRAY['is_completed', 'completed_by'], v_meta, NEW.asset_id, v_symbol);
    END IF;
    RETURN NULL;
  END IF;

  IF OLD.is_started IS NOT TRUE AND NEW.is_started IS TRUE THEN
    PERFORM public.record_process_event(
      'process_run', NEW.id, 'process.started', 'lifecycle', v_org,
      v_wfname, 'asset', NEW.asset_id,
      jsonb_build_object('is_started', OLD.is_started),
      jsonb_build_object('is_started', true, 'current_stage_key', NEW.current_stage_key),
      ARRAY['is_started', 'started_by'], v_meta, NEW.asset_id, v_symbol);
  END IF;

  IF NEW.current_stage_key IS DISTINCT FROM OLD.current_stage_key THEN
    PERFORM public.record_process_event(
      'process_run', NEW.id, 'process.stage_changed', 'state_change', v_org,
      v_wfname, 'asset', NEW.asset_id,
      jsonb_build_object('current_stage_key', OLD.current_stage_key),
      jsonb_build_object('current_stage_key', NEW.current_stage_key),
      ARRAY['current_stage_key'], v_meta, NEW.asset_id, v_symbol);
  END IF;

  IF OLD.is_completed IS NOT TRUE AND NEW.is_completed IS TRUE THEN
    PERFORM public.record_process_event(
      'process_run', NEW.id, 'process.completed', 'lifecycle', v_org,
      v_wfname, 'asset', NEW.asset_id,
      jsonb_build_object('is_completed', OLD.is_completed),
      jsonb_build_object('is_completed', true),
      ARRAY['is_completed', 'completed_by'], v_meta, NEW.asset_id, v_symbol);
  ELSIF OLD.is_completed IS TRUE AND NEW.is_completed IS NOT TRUE THEN
    PERFORM public.record_process_event(
      'process_run', NEW.id, 'process.reopened', 'lifecycle', v_org,
      v_wfname, 'asset', NEW.asset_id,
      jsonb_build_object('is_completed', true),
      jsonb_build_object('is_completed', NEW.is_completed),
      ARRAY['is_completed', 'completed_by'], v_meta, NEW.asset_id, v_symbol);
  END IF;

  RETURN NULL;
END $function$;

-- ─── 6. Requirement events ───────────────────────────────────────────────────
-- Tenancy comes from the requirement's OWN `organization_id`, never from its
-- workflow. Before migration 20261023120000 a member of one organization
-- could point a requirement at another's workflow; taking tenancy from the
-- workflow would then have written that member's actions into the other
-- organization's history. The row's own column is session-derived and already
-- enforced by its INSERT policy's WITH CHECK.
CREATE OR REPLACE FUNCTION public.process_requirement_audit()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_old     text;
  v_new     text;
  v_action  text;
  v_run     uuid;
  v_symbol  text;
  v_parent_type text;
  v_parent_id   uuid;
  v_meta    jsonb;
BEGIN
  IF NEW.organization_id IS NULL THEN
    -- A quarantined row has no tenant, so it has no history to write to.
    -- Silent on purpose: these rows are deliberately parked, and raising
    -- would make them unwritable.
    RETURN NULL;
  END IF;

  SELECT a.symbol INTO v_symbol FROM public.assets a WHERE a.id = NEW.asset_id;

  -- The run, where there is one. `(asset_id, workflow_id)` is unique on
  -- `asset_workflow_progress`, so this is unambiguous — but 22 of 140
  -- requirements have no run row at all, so the asset is the fallback and the
  -- workflow always travels in metadata.
  SELECT p.id INTO v_run
    FROM public.asset_workflow_progress p
   WHERE p.asset_id = NEW.asset_id AND p.workflow_id = NEW.workflow_id;

  IF v_run IS NOT NULL THEN
    v_parent_type := 'process_run'; v_parent_id := v_run;
  ELSE
    v_parent_type := 'asset';       v_parent_id := NEW.asset_id;
  END IF;

  v_meta := jsonb_build_object(
    'workflow_id', NEW.workflow_id,
    'run_id',      v_run,
    'stage_id',    NEW.stage_id,
    'item_id',     NEW.item_id
  );

  v_old := COALESCE(OLD.status, CASE WHEN OLD.completed THEN 'completed' ELSE 'unchecked' END);
  v_new := COALESCE(NEW.status, CASE WHEN NEW.completed THEN 'completed' ELSE 'unchecked' END);

  IF v_old IS DISTINCT FROM v_new THEN
    v_action := CASE
      WHEN v_new = 'completed'                        THEN 'requirement.completed'
      WHEN v_new = 'na'                               THEN 'requirement.marked_na'
      WHEN v_new = 'unchecked' AND v_old = 'completed' THEN 'requirement.reopened'
      WHEN v_new = 'unchecked' AND v_old = 'na'        THEN 'requirement.restored'
      ELSE NULL
    END;
    IF v_action IS NOT NULL THEN
      PERFORM public.record_process_event(
        'process_requirement', NEW.id, v_action, 'state_change', NEW.organization_id,
        NEW.item_text, v_parent_type, v_parent_id,
        jsonb_build_object('status', v_old),
        jsonb_build_object('status', v_new),
        ARRAY['status', 'completed', 'completed_at', 'completed_by'],
        v_meta, NEW.asset_id, v_symbol);
    END IF;
  END IF;

  IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
    PERFORM public.record_process_event(
      'process_requirement', NEW.id, 'requirement.assignment_changed', 'relationship',
      NEW.organization_id,
      NEW.item_text, v_parent_type, v_parent_id,
      jsonb_build_object('assignee_id', OLD.assignee_id),
      jsonb_build_object('assignee_id', NEW.assignee_id),
      ARRAY['assignee_id'], v_meta, NEW.asset_id, v_symbol);
  END IF;

  RETURN NULL;
END $function$;

-- ─── 7. The triggers ─────────────────────────────────────────────────────────
-- Every existing trigger on both tables is BEFORE, so by AFTER time `NEW`
-- already reflects the branch rewrite and the org stamp. These write only
-- `audit_events`, which has no triggers, so they cannot re-enter.
--
-- The attribution triggers are named to sort AFTER the existing BEFORE
-- triggers alphabetically (`asset_checklist_items_set_org_trg`,
-- `trigger_auto_create_workflow_branch`), because Postgres fires BEFORE
-- triggers in name order and the org stamp must land first.

DROP TRIGGER IF EXISTS zz_process_run_attribution_trg ON asset_workflow_progress;
CREATE TRIGGER zz_process_run_attribution_trg
  BEFORE INSERT OR UPDATE ON asset_workflow_progress
  FOR EACH ROW EXECUTE FUNCTION public.process_run_attribution();

DROP TRIGGER IF EXISTS zz_process_requirement_attribution_trg ON asset_checklist_items;
CREATE TRIGGER zz_process_requirement_attribution_trg
  BEFORE INSERT OR UPDATE ON asset_checklist_items
  FOR EACH ROW EXECUTE FUNCTION public.process_requirement_attribution();

-- Two triggers, not one: a WHEN clause that reads OLD is only legal on
-- UPDATE, so an INSERT-and-UPDATE trigger cannot carry the transition guard
-- that keeps a no-op update from emitting anything.
DROP TRIGGER IF EXISTS process_run_audit_ins_trg ON asset_workflow_progress;
CREATE TRIGGER process_run_audit_ins_trg
  AFTER INSERT ON asset_workflow_progress
  FOR EACH ROW EXECUTE FUNCTION public.process_run_audit();

DROP TRIGGER IF EXISTS process_run_audit_upd_trg ON asset_workflow_progress;
CREATE TRIGGER process_run_audit_upd_trg
  AFTER UPDATE ON asset_workflow_progress
  FOR EACH ROW
  WHEN (
    OLD.is_started        IS DISTINCT FROM NEW.is_started
    OR OLD.is_completed      IS DISTINCT FROM NEW.is_completed
    OR OLD.current_stage_key IS DISTINCT FROM NEW.current_stage_key
  )
  EXECUTE FUNCTION public.process_run_audit();

DROP TRIGGER IF EXISTS process_requirement_audit_trg ON asset_checklist_items;
CREATE TRIGGER process_requirement_audit_trg
  AFTER UPDATE ON asset_checklist_items
  FOR EACH ROW
  WHEN (
    OLD.status      IS DISTINCT FROM NEW.status
    OR OLD.completed   IS DISTINCT FROM NEW.completed
    OR OLD.assignee_id IS DISTINCT FROM NEW.assignee_id
  )
  EXECUTE FUNCTION public.process_requirement_audit();

COMMIT;

-- --- Verification (run after applying) ---------------------------------------
--   SELECT tgname, tgenabled FROM pg_trigger
--    WHERE tgrelid IN ('asset_workflow_progress'::regclass, 'asset_checklist_items'::regclass)
--      AND NOT tgisinternal ORDER BY tgrelid::regclass::text, tgname;
--
--   SELECT has_function_privilege('authenticated',
--     'public.record_process_event(text,uuid,text,text,uuid,text,text,uuid,jsonb,jsonb,text[],jsonb,uuid,text)',
--     'execute');   -- must be false
--
--   SELECT count(*) FROM audit_events WHERE entity_type LIKE 'process_%';
