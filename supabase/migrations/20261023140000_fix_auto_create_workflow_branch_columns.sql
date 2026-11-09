-- =============================================================================
-- Migration C — Repair the dead column names in auto_create_workflow_branch()
--
-- WHAT IS BROKEN
--
-- `auto_create_workflow_branch()` is a BEFORE INSERT ROW trigger on
-- `asset_workflow_progress`: it fires every time a Process run is created for
-- an asset, which is what the Asset Page does when a user starts a Process.
-- When its guard passes (the root workflow has an active `branch_copy` /
-- `branch_nocopy` automation rule AND zero live branches of the active
-- template version) it tries to materialise a new branch — and every write it
-- performs names columns that no longer exist anywhere in the schema:
--
--   stage_order         -> renamed to  workflow_stages.sort_order
--   checklist_template  -> replaced by workflow_stages.checklist_items (jsonb)
--   permission_level    -> renamed to  workflow_collaborations.permission
--   current_stage       -> renamed to  asset_workflow_progress.current_stage_key
--   checklist_progress  -> DROPPED, no counterpart
--   assigned_at         -> DROPPED, no counterpart
--
-- 15 dead references across 5 statements. Because this is a BEFORE trigger the
-- whole INSERT rolls back, so no partial run is left behind — but the user's
-- Process never starts.
--
-- AND THERE IS A SECOND, INDEPENDENT DEFECT THAT FIRES EARLIER
--
-- `v_copy_from_branch` is a RECORD that is only ever assigned inside
-- `IF v_auto_create_rule.action_type = 'branch_copy'`. The very next statement
-- then reads `v_copy_from_branch.id` unconditionally:
--
--   CASE WHEN v_should_copy_progress THEN v_copy_from_branch.id ELSE NULL END
--
-- PL/pgSQL raises on the field access itself, not on the branch taken, so for
-- a `branch_nocopy` rule the trigger dies at `INSERT INTO workflows` with
-- `55000 record "v_copy_from_branch" is not assigned yet` and never reaches
-- the column problem at all. So the two rule types fail differently:
--
--   branch_nocopy                      -> 55000 at INSERT INTO workflows
--   branch_copy, with a prior branch    -> 42703 at INSERT INTO workflow_stages
--   branch_copy, with no prior branch   -> 42703 (SELECT INTO found no row, so
--                                         the record is assigned all-NULL)
--
-- Three of the five live branch rules are `branch_nocopy`, so 55000 is the
-- more commonly reachable failure. Both are fixed here. A column-only fix
-- would have left the trigger broken for the majority of configured rules
-- while appearing to be a fix — which is why this migration is slightly larger
-- than "rename one column", and why that is called out here rather than
-- buried. It is still one function, and no behaviour changes except that the
-- statements can now execute.
--
-- The 55000 fix is three lines: a dedicated `v_source_branch_id UUID` (NULL
-- unless a copy source was found) replaces the record field access. It is
-- exactly equivalent to the CASE expression's intent.
--
-- WHERE THE CORRECT COLUMN NAMES COME FROM
--
-- Not from judgement. `execute_scheduled_branch_creation_rules()` performs the
-- identical branch materialisation for the cron path, was already migrated to
-- the current schema, and carries the comment "use correct column names" on
-- the very statement that is broken here. This migration aligns the trigger
-- with that already-in-production sibling, statement for statement.
--
-- THREE PLACES WHERE A MECHANICAL RENAME WOULD BE WRONG
--
--  1. `workflow_stages.checklist_items` is NOT NULL DEFAULT '[]'. The broken
--     version-path INSERT supplied a literal NULL for `checklist_template`, so
--     renaming the column would turn 42703 into `23502 null value in column
--     "checklist_items"`. The column is therefore OMITTED and left to its
--     default, exactly as the sibling does.
--  2. `checklist_progress` and `assigned_at` have no replacement column on
--     `asset_workflow_progress`. They are dropped from the copy, and the
--     sibling's `is_started` / `is_completed` pair is adopted in their place.
--  3. The `AND asset_id != NEW.asset_id` predicate on that copy is PRESERVED.
--     The sibling has no equivalent because it is not a trigger; here it is
--     load-bearing — without it the copy inserts the same (asset_id,
--     workflow_id) pair that the firing INSERT is about to insert and violates
--     `asset_workflow_progress_asset_id_workflow_id_key`.
--
-- WHAT IS DELIBERATELY NOT CHANGED
--
--   * The guard, the branch-count logic, the naming/suffix helpers, the scope
--     dispatch, the portfolio and general paths' own statements, the RAISE
--     NOTICE, and `NEW.workflow_id := v_new_branch_id`.
--   * SECURITY DEFINER is preserved, and the function still has NO
--     `SET search_path`. That is a real weakness, it predates this change, and
--     it is reported as an adjacent finding rather than bundled in here.
--   * No RLS policy, grant, table or column is touched. No data is written.
--
-- RLS POSTURE: unchanged. This migration replaces one function body. It adds
-- no table, view, RPC or storage path, and alters no policy or grant. The
-- function was SECURITY DEFINER before and remains so, with the same owner
-- (postgres) and the same (absent) search_path, so its effective privileges
-- are identical to what is deployed today.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.auto_create_workflow_branch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_workflow_id UUID;
  v_auto_create_rule RECORD;
  v_branch_suffix TEXT;
  v_processed_suffix TEXT;
  v_branch_count INTEGER;
  v_new_branch_id UUID;
  v_generated_name TEXT;
  v_parent_workflow RECORD;
  v_active_version RECORD;
  v_copy_from_branch RECORD;
  v_should_copy_progress BOOLEAN;
  -- Holds the copy source's id without touching an unassigned RECORD field.
  v_source_branch_id UUID;
  v_scope_type TEXT;
  v_first_stage_key TEXT;
  v_populated INTEGER;
BEGIN
  SELECT COALESCE(parent_workflow_id, id) INTO v_workflow_id
  FROM workflows WHERE id = NEW.workflow_id;

  SELECT * INTO v_auto_create_rule
  FROM workflow_automation_rules
  WHERE workflow_id = v_workflow_id
    AND action_type IN ('branch_copy', 'branch_nocopy')
    AND is_active = true
  LIMIT 1;

  IF v_auto_create_rule.id IS NOT NULL THEN
    v_branch_suffix := v_auto_create_rule.action_value->>'branch_suffix';
    IF v_branch_suffix IS NULL OR v_branch_suffix = '' THEN
      v_branch_suffix := '{MONTH} {YEAR}';
    END IF;

    SELECT * INTO v_active_version
    FROM workflow_template_versions
    WHERE workflow_id = v_workflow_id AND is_active = true
    LIMIT 1;

    IF v_active_version.id IS NOT NULL THEN
      SELECT COUNT(*) INTO v_branch_count FROM workflows
      WHERE parent_workflow_id = v_workflow_id
        AND template_version_id = v_active_version.id
        AND deleted IS NOT TRUE AND archived IS NOT TRUE;
    ELSE
      SELECT COUNT(*) INTO v_branch_count FROM workflows
      WHERE parent_workflow_id = v_workflow_id
        AND deleted IS NOT TRUE AND archived IS NOT TRUE;
    END IF;

    IF v_branch_count = 0 THEN
      SELECT * INTO v_parent_workflow FROM workflows WHERE id = v_workflow_id;
      v_scope_type := COALESCE(v_parent_workflow.scope_type, 'asset');
      v_processed_suffix := process_dynamic_suffix(v_branch_suffix);
      v_generated_name := generate_unique_workflow_name(v_parent_workflow.name, v_branch_suffix);

      v_should_copy_progress := false;
      v_source_branch_id := NULL;
      IF v_auto_create_rule.action_type = 'branch_copy' THEN
        SELECT * INTO v_copy_from_branch FROM workflows
        WHERE parent_workflow_id = v_workflow_id
          AND deleted IS NOT TRUE AND archived IS NOT TRUE AND id != v_workflow_id
        ORDER BY COALESCE(template_version_number, 0) DESC, branched_at DESC NULLS LAST, created_at DESC
        LIMIT 1;
        IF v_copy_from_branch.id IS NOT NULL THEN
          v_should_copy_progress := true;
          v_source_branch_id := v_copy_from_branch.id;
        END IF;
      END IF;

      INSERT INTO workflows (
        name, description, color, is_public, created_by,
        cadence_days, cadence_timeframe, kickoff_cadence, kickoff_custom_date,
        parent_workflow_id, branch_suffix, branched_at,
        template_version_id, template_version_number, source_branch_id, scope_type
      ) VALUES (
        v_generated_name, v_parent_workflow.description, v_parent_workflow.color,
        false, v_parent_workflow.created_by,
        v_parent_workflow.cadence_days, v_parent_workflow.cadence_timeframe,
        v_parent_workflow.kickoff_cadence, v_parent_workflow.kickoff_custom_date,
        v_workflow_id, v_processed_suffix, NOW(),
        v_active_version.id, v_active_version.version_number,
        v_source_branch_id,
        v_scope_type
      ) RETURNING id INTO v_new_branch_id;

      -- Copy stages
      -- checklist_items is NOT NULL DEFAULT '[]'; the version snapshot carries
      -- no per-stage checklist, so the column is omitted and defaulted.
      IF v_active_version.id IS NOT NULL AND v_active_version.stages IS NOT NULL THEN
        INSERT INTO workflow_stages (workflow_id, stage_key, stage_label, stage_description, stage_color, sort_order)
        SELECT v_new_branch_id, stage->>'key', stage->>'name', stage->>'description',
               stage->>'color', (stage->>'order_index')::INTEGER
        FROM jsonb_array_elements(v_active_version.stages) AS stage
        ORDER BY (stage->>'order_index')::INTEGER;
      ELSE
        INSERT INTO workflow_stages (workflow_id, stage_key, stage_label, stage_description, stage_color, sort_order, checklist_items)
        SELECT v_new_branch_id, stage_key, stage_label, stage_description, stage_color, sort_order,
               COALESCE(checklist_items, '[]'::jsonb)
        FROM workflow_stages WHERE workflow_id = v_workflow_id ORDER BY sort_order;
      END IF;

      -- Copy collaborations
      -- invited_by must be carried, and defaulted when absent: the AFTER
      -- trigger notify_workflow_sharing() builds its notification message by
      -- concatenating the inviter's name, so a NULL invited_by makes the whole
      -- message NULL and the insert dies with 23502 on notifications.message.
      -- COALESCE onto the parent's creator matches
      -- execute_scheduled_branch_creation_rules(), which carries the column
      -- for this same reason.
      INSERT INTO workflow_collaborations (workflow_id, user_id, permission, invited_by)
      SELECT v_new_branch_id, user_id, permission,
             COALESCE(invited_by, v_parent_workflow.created_by)
      FROM workflow_collaborations WHERE workflow_id = v_workflow_id;

      -- Copy stakeholders
      INSERT INTO workflow_stakeholders (workflow_id, user_id)
      SELECT v_new_branch_id, user_id
      FROM workflow_stakeholders WHERE workflow_id = v_workflow_id;

      -- === SCOPE-SPECIFIC POPULATION ===
      IF v_scope_type = 'asset' THEN
        INSERT INTO workflow_universe_rules (workflow_id, rule_type, rule_config, combination_operator, sort_order)
        SELECT v_new_branch_id, rule_type, rule_config, combination_operator, sort_order
        FROM workflow_universe_rules WHERE workflow_id = v_workflow_id AND is_active = true;

        -- v_source_branch_id, not v_copy_from_branch.id: PL/pgSQL evaluates the
        -- whole condition as one SQL expression and does not short-circuit the
        -- AND, so a RECORD field reference here raises 55000 for branch_nocopy
        -- even though the branch would not be taken.
        IF v_should_copy_progress AND v_source_branch_id IS NOT NULL THEN
          -- current_stage/checklist_progress/assigned_at no longer exist.
          -- Mirrors execute_scheduled_branch_creation_rules(); the
          -- asset_id != NEW.asset_id predicate is retained because the firing
          -- INSERT is about to supply that pair itself.
          INSERT INTO asset_workflow_progress (
            asset_id, workflow_id, current_stage_key, is_started, is_completed, started_at, started_by
          )
          SELECT asset_id, v_new_branch_id, current_stage_key, is_started, false, started_at, started_by
          FROM asset_workflow_progress
          WHERE workflow_id = v_source_branch_id AND asset_id != NEW.asset_id;
        ELSE
          PERFORM populate_asset_run_from_universe(v_new_branch_id, v_workflow_id);
        END IF;

      ELSIF v_scope_type = 'portfolio' THEN
        INSERT INTO workflow_portfolio_selections (workflow_id, portfolio_id)
        SELECT v_new_branch_id, portfolio_id
        FROM workflow_portfolio_selections WHERE workflow_id = v_workflow_id;

        INSERT INTO portfolio_workflow_progress (portfolio_id, workflow_id, is_started, started_at, is_completed, created_at, updated_at)
        SELECT portfolio_id, v_new_branch_id, true, NOW(), false, NOW(), NOW()
        FROM workflow_portfolio_selections WHERE workflow_id = v_workflow_id;

      ELSIF v_scope_type = 'general' THEN
        SELECT stage_key INTO v_first_stage_key
        FROM workflow_stages WHERE workflow_id = v_new_branch_id ORDER BY sort_order ASC LIMIT 1;

        INSERT INTO general_workflow_progress (workflow_id, current_stage_key, is_started, started_at, is_completed, created_at, updated_at)
        VALUES (v_new_branch_id, v_first_stage_key, true, NOW(), false, NOW(), NOW());

        INSERT INTO general_checklist_items (workflow_id, stage_id, item_id, item_text, sort_order, completed, status)
        SELECT v_new_branch_id, ws.stage_key,
          'item_' || (row_number() OVER (PARTITION BY ws.stage_key ORDER BY idx) - 1),
          item_elem->>'text',
          (row_number() OVER (PARTITION BY ws.stage_key ORDER BY idx) - 1)::INTEGER,
          false, 'unchecked'
        FROM workflow_stages ws,
          LATERAL jsonb_array_elements(COALESCE(ws.checklist_items, '[]'::jsonb)) WITH ORDINALITY AS t(item_elem, idx)
        WHERE ws.workflow_id = v_workflow_id
          AND jsonb_typeof(ws.checklist_items) = 'array'
          AND jsonb_array_length(ws.checklist_items) > 0
          AND item_elem->>'text' IS NOT NULL AND item_elem->>'text' != '';
      END IF;

      NEW.workflow_id := v_new_branch_id;
      RAISE NOTICE 'Auto-created workflow branch: % (ID: %) scope: % with suffix: %',
        v_generated_name, v_new_branch_id, v_scope_type, v_processed_suffix;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

COMMIT;

-- --- Verification (run after applying) ---------------------------------------
--   SELECT count(*) AS dead_refs FROM pg_proc
--    WHERE proname = 'auto_create_workflow_branch'
--      AND (prosrc LIKE '%stage_order%' OR prosrc LIKE '%checklist_template%'
--        OR prosrc LIKE '%permission_level%' OR prosrc LIKE '%checklist_progress%'
--        OR prosrc LIKE '%current_stage,%' OR prosrc LIKE '%assigned_at%');
--   -- expect 0
--
--   SELECT prosecdef FROM pg_proc WHERE proname = 'auto_create_workflow_branch';
--   -- expect true (SECURITY DEFINER preserved)
--
--   Then run supabase/tests/auto-create-workflow-branch-columns.sql
