-- ============================================================================
-- SECURITY: RPCs that act as whoever the caller names
-- ============================================================================
-- Group D of the cross-tenant RPC remediation. Prepared 2026-11-06. NOT YET
-- APPLIED to any database.
--
-- Five SECURITY DEFINER functions take a user id, a lab id, a portfolio id or
-- an asset id and act on it with no check on who is asking. None of them was
-- exploited for data theft in this pass, so they are recorded as suspected
-- rather than confirmed, but each one writes a row on behalf of an identity
-- the caller supplies, and that is the same defect class the five confirmed
-- findings share.
--
-- 1. mark_conversation_read(p_conversation_id, p_user_id)
--    UPDATE conversation_participants SET last_read_at = NOW()
--      WHERE conversation_id = p_conversation_id AND user_id = p_user_id;
--    No caller check. Any logged-in user can clear another user's unread
--    marker on any conversation, in any organization, from two uuids. The
--    frontend already passes its own id (DirectMessaging.tsx:276), so forcing
--    auth.uid() changes nothing legitimate. Stays DEFINER: a comment at the
--    call site records that the RPC exists to avoid an RLS recursion problem
--    on conversation_participants, and this emergency pass does not reopen it.
--
-- 2. get_or_create_private_view(p_lab_id, p_user_id)
--    Creates a trade_lab_views row owned by p_user_id in lab p_lab_id, with
--    no check on either. Two defects: the caller names the owner, and no
--    organization term ties the lab to the caller. Fixed by forcing the owner
--    to auth.uid() and requiring the lab's portfolio to be in the caller's
--    current organization.
--
-- 3. get_or_create_trade_lab(p_portfolio_id)
--    Creates a trade_labs row for any portfolio uuid, reading that
--    portfolio's name in the process. Fixed with an explicit organization
--    guard on the portfolio.
--    NOT converted to SECURITY INVOKER: the body ends in
--    ON CONFLICT (portfolio_id) DO UPDATE, which under INVOKER would need an
--    UPDATE policy on trade_labs that this pass has not verified, and a
--    policy gap there would surface as a confusing failure rather than a
--    clean denial.
--
-- 4. ensure_pilot_decision_request_for_user(p_user_id DEFAULT auth.uid())
--    Inserts a decision_requests row with requested_by = p_user_id, sourced
--    from that user's pilot_scenarios. A caller can read another user's
--    pilot scenario into a decision request attributed to them. The frontend
--    calls it with no arguments (usePilotSeeding.ts:134), so the DEFAULT is
--    what is actually used today; the fix makes the default the only
--    behaviour. The DEFAULT itself is preserved verbatim, because
--    CREATE OR REPLACE cannot remove a parameter default (42P13).
--
-- 5. ensure_default_scenarios(p_asset_id)
--    No caller check at all, and no check that the asset exists. Measured:
--    `anon` is ALREADY refused with 42501 (it holds no EXECUTE), so this one
--    is reachable only by a logged-in user. The REVOKE below is belt and
--    braces against a database rebuilt from migrations, not a fix for a
--    measured anonymous write path.
--    MUST STAY SECURITY DEFINER. Converting it to INVOKER would break it:
--    the scenarios INSERT policy's WITH CHECK forbids is_default = true, and
--    all 138 existing default rows carry organization_id IS NULL. The
--    function is the only thing allowed to write them. The fix is therefore
--    the narrowest possible: require an authenticated caller and pin the
--    search_path. `assets` has no organization_id by design (global reference
--    data), so there is no organization term to add here.
--    DEFERRED, NOT FIXED BY THIS MIGRATION: those default scenarios are
--    written with organization_id NULL, so one organization's default
--    scenario rows are not tenant-scoped. That is a data-model question, not
--    an emergency authorization hole, and changing it would require
--    backfilling 138 rows. Recorded as a follow-up.
--
-- ALL FIVE also gain `SET search_path TO 'public','pg_temp'`. Four of them had
-- no pinned search_path, which means a SECURITY DEFINER function resolving
-- unqualified names through the caller's search_path. Every object reference
-- in the bodies below is schema-qualified as well.
--
-- RLS POSTURE: no policy is created, dropped or widened. EXECUTE grants are
-- restated at their existing level, except ensure_default_scenarios, where
-- `anon` is revoked.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. mark_conversation_read
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_conversation_read(
  p_conversation_id uuid,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  -- p_user_id is accepted for call compatibility and discarded. A caller can
  -- only ever mark their own participation row as read.
  UPDATE public.conversation_participants
  SET last_read_at = NOW()
  WHERE conversation_id = p_conversation_id
    AND user_id = v_actor;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 2. get_or_create_private_view
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_or_create_private_view(
  p_lab_id uuid,
  p_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_view_id uuid;
  v_ok boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  -- The lab must belong to a portfolio in the caller's current organization.
  SELECT EXISTS (
    SELECT 1
    FROM public.trade_labs tl
    JOIN public.portfolios p ON p.id = tl.portfolio_id
    WHERE tl.id = p_lab_id
      AND p.organization_id = public.current_org_id()
  ) INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Trade lab not found' USING ERRCODE = 'P0002';
  END IF;

  -- The owner is the caller, never the argument.
  SELECT id INTO v_view_id
  FROM public.trade_lab_views
  WHERE lab_id = p_lab_id
    AND owner_id = v_actor
    AND view_type = 'private'
    AND deleted_at IS NULL
  LIMIT 1;

  IF v_view_id IS NULL THEN
    INSERT INTO public.trade_lab_views (lab_id, owner_id, view_type, name, created_by)
    VALUES (p_lab_id, v_actor, 'private', 'My Workspace', v_actor)
    RETURNING id INTO v_view_id;
  END IF;

  RETURN v_view_id;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 3. get_or_create_trade_lab
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_or_create_trade_lab(p_portfolio_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_lab_id UUID;
  v_portfolio_name TEXT;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  -- The portfolio must be in the caller's current organization. Reading its
  -- name is itself a disclosure, so this check comes before the read.
  SELECT name INTO v_portfolio_name
  FROM public.portfolios
  WHERE id = p_portfolio_id
    AND organization_id = public.current_org_id();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Portfolio not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT id INTO v_lab_id
  FROM public.trade_labs
  WHERE portfolio_id = p_portfolio_id;

  IF v_lab_id IS NOT NULL THEN
    RETURN v_lab_id;
  END IF;

  INSERT INTO public.trade_labs (portfolio_id, name, created_by)
  VALUES (
    p_portfolio_id,
    COALESCE(v_portfolio_name || ' Trade Lab', 'Trade Lab'),
    v_actor
  )
  ON CONFLICT (portfolio_id) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_lab_id;

  RETURN v_lab_id;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 4. ensure_pilot_decision_request_for_user
--    The DEFAULT is reproduced verbatim: CREATE OR REPLACE cannot drop it.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_pilot_decision_request_for_user(
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_scenario RECORD;
  v_existing_id UUID;
  v_new_id UUID;
  v_action TEXT;
  v_target_weight NUMERIC;
  v_proposal_id UUID;
  v_proposal_sizing JSONB;
  v_baseline_weight NUMERIC;
  v_actor UUID;
BEGIN
  -- Identity comes from the session, not the argument.
  v_actor := auth.uid();
  IF v_actor IS NULL THEN RETURN NULL; END IF;

  SELECT ps.*, tqi.action AS tqi_action
    INTO v_scenario
  FROM public.pilot_scenarios ps
  JOIN public.trade_queue_items tqi ON tqi.id = ps.trade_queue_item_id
  WHERE ps.user_id = v_actor
    AND ps.status = 'active'
    AND ps.is_template = FALSE
    AND ps.trade_queue_item_id IS NOT NULL
    AND ps.portfolio_id IS NOT NULL
  ORDER BY ps.created_at DESC
  LIMIT 1;

  IF v_scenario.id IS NULL THEN RETURN NULL; END IF;

  SELECT id INTO v_existing_id
  FROM public.decision_requests
  WHERE trade_queue_item_id = v_scenario.trade_queue_item_id
    AND portfolio_id = v_scenario.portfolio_id
  ORDER BY created_at DESC
  LIMIT 1;
  IF v_existing_id IS NOT NULL THEN RETURN v_existing_id; END IF;

  SELECT id, sizing_context INTO v_proposal_id, v_proposal_sizing
  FROM public.trade_proposals
  WHERE trade_queue_item_id = v_scenario.trade_queue_item_id
    AND is_active = TRUE
  ORDER BY created_at DESC
  LIMIT 1;

  v_action := COALESCE(v_scenario.tqi_action::TEXT, 'buy');
  v_target_weight := v_scenario.target_weight_pct;
  v_baseline_weight := COALESCE(
    (v_proposal_sizing->>'current_weight_pct')::NUMERIC,
    0
  );

  INSERT INTO public.decision_requests (
    trade_queue_item_id, requested_by, portfolio_id, urgency,
    context_note, status, requested_action, sizing_weight, sizing_mode,
    proposal_id, submission_snapshot
  ) VALUES (
    v_scenario.trade_queue_item_id, v_actor, v_scenario.portfolio_id,
    'medium', COALESCE(v_scenario.why_now, 'Pilot scenario recommendation.'),
    'pending', v_action, v_target_weight, 'weight', v_proposal_id,
    jsonb_build_object(
      'baseline_weight', v_baseline_weight,
      'weight', v_target_weight,
      'sizing_context', v_proposal_sizing,
      'pilot_seed', TRUE
    )
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 5. ensure_default_scenarios
--    Stays SECURITY DEFINER on purpose: see the header. Minimal guard only.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_default_scenarios(p_asset_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  scenario_exists boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  -- The asset must exist. `assets` is global reference data with no
  -- organization_id by design, so there is no tenant term to apply here.
  IF NOT EXISTS (SELECT 1 FROM public.assets WHERE id = p_asset_id) THEN
    RAISE EXCEPTION 'Asset not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.scenarios
    WHERE asset_id = p_asset_id AND is_default = true
  ) INTO scenario_exists;

  IF NOT scenario_exists THEN
    INSERT INTO public.scenarios (asset_id, name, description, color, is_default, created_by)
    VALUES (p_asset_id, 'Bull', 'Optimistic scenario with upside drivers materializing', '#22c55e', true, NULL);

    INSERT INTO public.scenarios (asset_id, name, description, color, is_default, created_by)
    VALUES (p_asset_id, 'Base', 'Most likely scenario given current information', '#3b82f6', true, NULL);

    INSERT INTO public.scenarios (asset_id, name, description, color, is_default, created_by)
    VALUES (p_asset_id, 'Bear', 'Pessimistic scenario with downside risks materializing', '#ef4444', true, NULL);
  END IF;
END;
$function$;

-- ----------------------------------------------------------------------------
-- Privileges. PostgreSQL grants EXECUTE to PUBLIC on every new function, so
-- each REVOKE ALL ... FROM PUBLIC below is load-bearing.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.mark_conversation_read(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_or_create_private_view(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_or_create_private_view(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_or_create_trade_lab(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_or_create_trade_lab(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.ensure_pilot_decision_request_for_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_pilot_decision_request_for_user(uuid) TO authenticated, service_role;

-- anon holds no EXECUTE here today (measured: 42501). The REVOKE is restated
-- so a database rebuilt from migrations cannot inherit one.
REVOKE ALL ON FUNCTION public.ensure_default_scenarios(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_default_scenarios(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.ensure_default_scenarios(uuid) TO authenticated, service_role;
