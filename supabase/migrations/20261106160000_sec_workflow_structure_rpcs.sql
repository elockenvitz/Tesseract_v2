-- =============================================================================
-- SECURITY: workflow-structure RPCs must check the caller, not their arguments
--
-- Group A of the cross-tenant RPC remediation. Authored 2026-11-06.
-- APPLIED to production (wfcebeagznzgeuyysbnt) on 2026-11-06, ledger version
-- 20261106160000. Its helper grants were insufficient as written; see the
-- forward correction in 20261106160010_sec_workflow_guard_helper_grants.sql.
-- This file is left exactly as it ran.
--
-- Closes two confirmed cross-tenant paths, demonstrated by running them as an
-- ordinary `authenticated` user in org B with no membership or relationship in
-- org A (a direct SELECT of the victim workflow returned 0 rows, so RLS itself
-- was working; these functions go around it):
--
--   copy_workflow_with_unique_name(wf_a, 'stolen', attacker, false)
--     -> copied org A's private workflow, both confidential stage labels and
--        their descriptions, and its automation rule, into the ATTACKER's
--        organization, fully readable. `stamp_organization_id` stamps
--        current_org_id() on the insert, so the copy lands in the caller's org.
--
--   activate_template_version(ver_a)
--     -> DELETEd both of org A's workflow_stages rows. Destruction, from a
--        version uuid alone.
--
-- and two unauthorized writes of the same class:
--
--   create_initial_template_version / create_new_template_version
--     -> snapshot any workflow's stages, checklists, automation rules and
--        universe rules into that workflow's version history. This is the setup
--        move for activate_template_version: write a version, then activate it.
--
-- All four were SECURITY DEFINER, owned by postgres, EXECUTE granted to
-- `authenticated`, with NO reference to auth.uid() anywhere in their bodies.
-- PUBLIC had already been revoked on all four, and none of them is overloaded,
-- so `authenticated` was the whole exposure.
--
-- THE SHAPE OF THE FIX
--
-- Two guard helpers, so the rule is written once and the four call sites each
-- gain one line. Each raises rather than returning false, so a missing check
-- cannot be mistaken for a passing one, and each returns auth.uid() so the
-- caller's identity comes from the session and never from an argument.
--
--   assert_workflow_readable(id) -> org match + user_has_workflow_access
--   assert_workflow_admin(id)    -> org match + user_has_workflow_edit_access
--
-- `user_has_workflow_edit_access` admits permission IN ('write','admin'). The
-- check constraint on workflow_collaborations admits only ('admin','read'), so
-- 'write' is unreachable and the helper is equivalent to "creator or admin
-- collaborator" in practice. That mismatch is recorded as its own finding and
-- is deliberately NOT fixed here.
--
-- WHY NOT SECURITY INVOKER
--
-- It would mostly work: workflow_stages' policies carry
-- `organization_id = current_org_id()` and `user_has_workflow_edit_access`, and
-- workflow_template_versions' INSERT/UPDATE checks require creator-or-admin.
-- It was rejected for two reasons. First, an attacker's DELETE would then
-- silently affect 0 rows and the function would report success, where an
-- explicit RAISE says no. Second, these functions would start depending on
-- four tables' policies all being correct forever, instead of stating the rule
-- themselves. The explicit guard is what the adversarial test removes.
--
-- search_path is pinned on all four (it was unset) and every object reference
-- is schema-qualified.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────── guard helpers

CREATE OR REPLACE FUNCTION public.assert_workflow_readable(p_workflow_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_org   uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT w.organization_id INTO v_org
  FROM public.workflows w
  WHERE w.id = p_workflow_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Workflow not found' USING ERRCODE = 'P0002';
  END IF;

  /* The organization term is a SEPARATE conjunct, deliberately. Workflow
     access alone is not tenancy: a collaboration or stakeholder row carries no
     organization of its own, so a cross-org row would otherwise grant. */
  IF v_org IS DISTINCT FROM public.current_org_id() THEN
    RAISE EXCEPTION 'Workflow is not in the current organization'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.user_has_workflow_access(p_workflow_id, v_actor) THEN
    RAISE EXCEPTION 'No access to this workflow' USING ERRCODE = '42501';
  END IF;

  RETURN v_actor;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assert_workflow_admin(p_workflow_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_org   uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT w.organization_id INTO v_org
  FROM public.workflows w
  WHERE w.id = p_workflow_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Workflow not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_org IS DISTINCT FROM public.current_org_id() THEN
    RAISE EXCEPTION 'Workflow is not in the current organization'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.user_has_workflow_edit_access(p_workflow_id, v_actor) THEN
    RAISE EXCEPTION 'Workflow admin permission required' USING ERRCODE = '42501';
  END IF;

  RETURN v_actor;
END;
$function$;

-- Default PUBLIC EXECUTE is revoked explicitly. Neither helper needs to be
-- callable from the API: the four functions below are SECURITY DEFINER owned by
-- postgres, so they reach the helpers as postgres regardless of these grants.
REVOKE ALL ON FUNCTION public.assert_workflow_readable(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_workflow_admin(uuid)    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_workflow_readable(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.assert_workflow_admin(uuid)    TO service_role;

-- ─────────────────────────────────────────── copy_workflow_with_unique_name

CREATE OR REPLACE FUNCTION public.copy_workflow_with_unique_name(
  source_workflow_id uuid,
  suffix text,
  target_user_id uuid,
  copy_progress boolean DEFAULT true   -- default preserved verbatim; dropping it
)                                      -- fails with 42P13 on CREATE OR REPLACE
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_source_workflow public.workflows%ROWTYPE;
  v_new_workflow_id uuid;
  v_new_workflow_name text;
  v_stage record;
  v_rule record;
  v_actor uuid;
BEGIN
  /* ── SECURITY GUARD ───────────────────────────────────────────────────────
     The caller may only copy a workflow they can actually read, in their own
     organization, and the copy is always theirs. `target_user_id` used to be
     taken at face value, which let any authenticated user copy any workflow in
     any organization to themselves.

     Both live callers pass their own id already
     (useWorkflowMutations.ts:91, WorkflowsPage.tsx:2349), so rejecting a
     mismatch changes nothing for them. The parameter is kept so the signature
     and the PostgREST contract are unchanged. */
  v_actor := public.assert_workflow_readable(source_workflow_id);

  IF target_user_id IS NOT NULL AND target_user_id <> v_actor THEN
    RAISE EXCEPTION 'Cannot create a workflow on behalf of another user'
      USING ERRCODE = '42501';
  END IF;
  target_user_id := v_actor;
  -- ── end guard ───────────────────────────────────────────────────────────

  SELECT * INTO v_source_workflow
  FROM public.workflows
  WHERE id = source_workflow_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source workflow not found: %', source_workflow_id;
  END IF;

  v_new_workflow_name := public.generate_unique_workflow_name(
    v_source_workflow.name,
    suffix,
    target_user_id
  );

  v_new_workflow_id := gen_random_uuid();

  /* organization_id is now set EXPLICITLY rather than left to the
     stamp_organization_id trigger. The guard has already established that the
     source is in the caller's current organization, so this is the same value
     the trigger would have produced; stating it means a future change to the
     trigger cannot quietly move the copy. */
  INSERT INTO public.workflows (
    id, name, description, color, organization_id,
    is_default, is_public, created_by,
    cadence_days, cadence_timeframe, kickoff_cadence, kickoff_custom_date,
    created_at, updated_at
  ) VALUES (
    v_new_workflow_id,
    v_new_workflow_name,
    v_source_workflow.description,
    v_source_workflow.color,
    v_source_workflow.organization_id,
    false,
    false,
    target_user_id,
    v_source_workflow.cadence_days,
    v_source_workflow.cadence_timeframe,
    v_source_workflow.kickoff_cadence,
    v_source_workflow.kickoff_custom_date,
    NOW(),
    NOW()
  );

  FOR v_stage IN
    SELECT * FROM public.workflow_stages
    WHERE workflow_id = source_workflow_id
    ORDER BY sort_order
  LOOP
    INSERT INTO public.workflow_stages (
      id, workflow_id, stage_key, stage_label, stage_description,
      stage_color, stage_icon, sort_order, standard_deadline_days,
      suggested_priorities, created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      v_new_workflow_id,
      v_stage.stage_key,
      v_stage.stage_label,
      v_stage.stage_description,
      v_stage.stage_color,
      v_stage.stage_icon,
      v_stage.sort_order,
      v_stage.standard_deadline_days,
      v_stage.suggested_priorities,
      NOW(),
      NOW()
    );
  END LOOP;

  FOR v_rule IN
    SELECT * FROM public.workflow_automation_rules
    WHERE workflow_id = source_workflow_id
  LOOP
    INSERT INTO public.workflow_automation_rules (
      id, workflow_id, rule_name, rule_type, condition_type, condition_value,
      action_type, action_value, is_active, created_by, created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      v_new_workflow_id,
      v_rule.rule_name,
      v_rule.rule_type,
      v_rule.condition_type,
      v_rule.condition_value,
      v_rule.action_type,
      v_rule.action_value,
      v_rule.is_active,
      target_user_id,
      NOW(),
      NOW()
    );
  END LOOP;

  RETURN v_new_workflow_id;
END;
$function$;

-- ───────────────────────────────────────────────── activate_template_version

CREATE OR REPLACE FUNCTION public.activate_template_version(p_version_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_workflow_id UUID;
  v_version_data RECORD;
  v_stage JSONB;
  v_checklist JSONB;
  v_stage_id UUID;
BEGIN
  SELECT workflow_id, stages, checklist_templates
  INTO v_version_data
  FROM public.workflow_template_versions
  WHERE id = p_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Version not found';
  END IF;

  v_workflow_id := v_version_data.workflow_id;

  /* ── SECURITY GUARD ───────────────────────────────────────────────────────
     This function DELETEs the workflow's stages and checklist templates and
     rebuilds them from a snapshot. Before this guard, a version uuid was the
     only thing standing between any authenticated user and the destruction of
     another organization's workflow structure. Placed after the lookup so the
     error distinguishes "no such version" from "not yours". */
  PERFORM public.assert_workflow_admin(v_workflow_id);
  -- ── end guard ───────────────────────────────────────────────────────────

  UPDATE public.workflow_template_versions
  SET is_active = false
  WHERE workflow_id = v_workflow_id;

  UPDATE public.workflow_template_versions
  SET is_active = true
  WHERE id = p_version_id;

  DELETE FROM public.workflow_stages
  WHERE workflow_id = v_workflow_id;

  FOR v_stage IN SELECT * FROM jsonb_array_elements(v_version_data.stages)
  LOOP
    INSERT INTO public.workflow_stages (
      workflow_id, stage_key, stage_label, stage_description,
      stage_color, sort_order, stage_icon
    )
    VALUES (
      v_workflow_id,
      (v_stage->>'key')::TEXT,
      (v_stage->>'name')::TEXT,
      (v_stage->>'description')::TEXT,
      (v_stage->>'color')::TEXT,
      (v_stage->>'order_index')::INTEGER,
      (v_stage->>'icon')::TEXT
    )
    RETURNING id INTO v_stage_id;
  END LOOP;

  DELETE FROM public.workflow_checklist_templates
  WHERE workflow_id = v_workflow_id;

  IF v_version_data.checklist_templates IS NOT NULL THEN
    FOR v_checklist IN SELECT * FROM jsonb_array_elements(v_version_data.checklist_templates)
    LOOP
      INSERT INTO public.workflow_checklist_templates (
        workflow_id, stage_id, item_id, item_text, sort_order, is_required
      )
      VALUES (
        v_workflow_id,
        (v_checklist->>'stage_id')::UUID,
        (v_checklist->>'item_id')::TEXT,
        (v_checklist->>'item_text')::TEXT,
        (v_checklist->>'sort_order')::INTEGER,
        COALESCE((v_checklist->>'is_required')::BOOLEAN, false)
      );
    END LOOP;
  END IF;

  -- NOTE: Automation rules and universe rules are NOT restored.
  -- They are operational/scoping settings, not structural.

  RETURN TRUE;
END;
$function$;

-- ─────────────────────────────────────────── create_initial_template_version

CREATE OR REPLACE FUNCTION public.create_initial_template_version(p_workflow_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_version_id UUID;
  v_stages JSONB;
  v_checklists JSONB;
  v_rules JSONB;
  v_universe_rules JSONB;
  v_workflow_creator UUID;
BEGIN
  /* ── SECURITY GUARD ─────────────────────────────────────────────────────── */
  PERFORM public.assert_workflow_admin(p_workflow_id);
  -- ── end guard ───────────────────────────────────────────────────────────

  SELECT created_by INTO v_workflow_creator
  FROM public.workflows WHERE id = p_workflow_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'stage_key', stage_key,
      'stage_label', stage_label,
      'stage_description', stage_description,
      'stage_color', stage_color,
      'stage_icon', stage_icon,
      'sort_order', sort_order,
      'standard_deadline_days', standard_deadline_days,
      'checklist_items', COALESCE(checklist_items, '[]'::jsonb)
    ) ORDER BY sort_order
  ), '[]'::jsonb)
  INTO v_stages
  FROM public.workflow_stages WHERE workflow_id = p_workflow_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id, 'workflow_id', workflow_id, 'stage_id', stage_id,
      'item_text', item_text, 'sort_order', sort_order, 'is_required', is_required
    ) ORDER BY sort_order
  ), '[]'::jsonb)
  INTO v_checklists
  FROM public.workflow_checklist_templates WHERE workflow_id = p_workflow_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id, 'workflow_id', workflow_id, 'rule_name', rule_name,
      'condition_type', condition_type, 'condition_value', condition_value,
      'action_type', action_type, 'action_value', action_value, 'is_active', is_active
    ) ORDER BY created_at
  ), '[]'::jsonb)
  INTO v_rules
  FROM public.workflow_automation_rules WHERE workflow_id = p_workflow_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id, 'workflow_id', workflow_id, 'rule_type', rule_type,
      'rule_config', rule_config, 'combination_operator', combination_operator,
      'sort_order', sort_order, 'is_active', is_active, 'description', description
    ) ORDER BY sort_order
  ), '[]'::jsonb)
  INTO v_universe_rules
  FROM public.workflow_universe_rules WHERE workflow_id = p_workflow_id;

  INSERT INTO public.workflow_template_versions (
    workflow_id, version_number, major_version, minor_version, version_name, description,
    stages, checklist_templates, automation_rules, universe_rules, is_active, created_by
  ) VALUES (
    p_workflow_id, 100, 1, 0, 'Initial Version', 'Initial template version created automatically',
    v_stages, v_checklists, v_rules, v_universe_rules, true, v_workflow_creator
  ) RETURNING id INTO v_version_id;

  RETURN v_version_id;
END;
$function$;

-- ─────────────────────────────────────────────── create_new_template_version

CREATE OR REPLACE FUNCTION public.create_new_template_version(
  p_workflow_id uuid,
  p_version_name text DEFAULT NULL::text,     -- defaults preserved verbatim
  p_description text DEFAULT NULL::text,
  p_version_type text DEFAULT 'minor'::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_version_id UUID;
  v_next_version INTEGER;
  v_last_major INTEGER;
  v_major_version INTEGER;
  v_minor_version INTEGER;
  v_stages JSONB;
  v_checklists JSONB;
BEGIN
  /* ── SECURITY GUARD ─────────────────────────────────────────────────────── */
  PERFORM public.assert_workflow_admin(p_workflow_id);
  -- ── end guard ───────────────────────────────────────────────────────────

  SELECT COALESCE(MAX(
    CASE
      WHEN version_number < 100 THEN version_number * 100
      ELSE (version_number / 100) * 100
    END
  ), 0)
  INTO v_last_major
  FROM public.workflow_template_versions
  WHERE workflow_id = p_workflow_id;

  IF p_version_type = 'major' THEN
    v_next_version := v_last_major + 100;
    v_major_version := v_next_version / 100;
    v_minor_version := 0;
  ELSE
    SELECT COALESCE(MAX(version_number), 0) + 1
    INTO v_next_version
    FROM public.workflow_template_versions
    WHERE workflow_id = p_workflow_id;

    IF v_next_version < 100 THEN
      v_major_version := v_next_version;
      v_minor_version := 0;
    ELSE
      v_major_version := v_next_version / 100;
      v_minor_version := v_next_version % 100;
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'key', stage_key,
      'stage_key', stage_key,
      'name', stage_label,
      'stage_label', stage_label,
      'description', stage_description,
      'stage_description', stage_description,
      'color', stage_color,
      'stage_color', stage_color,
      'order_index', sort_order,
      'sort_order', sort_order,
      'icon', stage_icon,
      'stage_icon', stage_icon,
      'checklist_items', COALESCE(checklist_items, '[]'::jsonb)
    ) ORDER BY sort_order
  ), '[]'::jsonb)
  INTO v_stages
  FROM public.workflow_stages
  WHERE workflow_id = p_workflow_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'workflow_id', workflow_id,
      'stage_id', stage_id,
      'item_id', item_id,
      'item_text', item_text,
      'item_type', COALESCE(item_type, 'operational'),
      'sort_order', sort_order,
      'is_required', is_required
    ) ORDER BY sort_order
  ), '[]'::jsonb)
  INTO v_checklists
  FROM public.workflow_checklist_templates
  WHERE workflow_id = p_workflow_id;

  UPDATE public.workflow_template_versions
  SET is_active = false
  WHERE workflow_id = p_workflow_id AND is_active = true;

  INSERT INTO public.workflow_template_versions (
    workflow_id, version_number, major_version, minor_version,
    version_name, description, version_type,
    stages, checklist_templates, automation_rules, is_active, created_by
  )
  VALUES (
    p_workflow_id,
    v_next_version,
    v_major_version,
    v_minor_version,
    p_version_name,
    p_description,
    p_version_type,
    v_stages,
    v_checklists,
    NULL,
    true,
    auth.uid()
  )
  RETURNING id INTO v_version_id;

  RETURN v_version_id;
END;
$function$;

-- Grants are unchanged from what production already had on these four:
-- PUBLIC revoked, authenticated + service_role EXECUTE. Restated so a
-- CREATE OR REPLACE on a fresh database cannot silently widen them.
REVOKE ALL ON FUNCTION public.copy_workflow_with_unique_name(uuid,text,uuid,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.activate_template_version(uuid)                        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_initial_template_version(uuid)                  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_new_template_version(uuid,text,text,text)       FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.copy_workflow_with_unique_name(uuid,text,uuid,boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.activate_template_version(uuid)                        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_initial_template_version(uuid)                  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_new_template_version(uuid,text,text,text)       TO authenticated, service_role;
