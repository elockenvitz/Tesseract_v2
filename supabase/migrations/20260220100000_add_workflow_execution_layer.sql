-- ============================================================================
-- Workflow Execution Layer v1
-- Adds: execution log table, scheduling columns, compute/execute/evaluate functions
-- ============================================================================

-- 1. Add scheduling & status columns to workflow_automation_rules
ALTER TABLE workflow_automation_rules
  ADD COLUMN IF NOT EXISTS last_run_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_run_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS run_count      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_status    TEXT,
  ADD COLUMN IF NOT EXISTS last_error     TEXT;

-- 2. Create workflow_rule_executions log table
CREATE TABLE IF NOT EXISTS workflow_rule_executions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id     UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  rule_id         UUID NOT NULL REFERENCES workflow_automation_rules(id) ON DELETE CASCADE,
  executed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  trigger_source  TEXT NOT NULL,  -- 'manual', 'scheduler', 'db_trigger', 'client_session'
  status          TEXT NOT NULL,  -- 'success', 'error', 'skipped'
  result_summary  JSONB,
  error_message   TEXT,
  executed_by     UUID REFERENCES auth.users(id),
  idempotency_key TEXT,

  CONSTRAINT valid_status CHECK (status IN ('success', 'error', 'skipped')),
  CONSTRAINT valid_trigger_source CHECK (trigger_source IN ('manual', 'scheduler', 'db_trigger', 'client_session'))
);

CREATE INDEX IF NOT EXISTS idx_wre_workflow_executed
  ON workflow_rule_executions (workflow_id, executed_at DESC);

CREATE INDEX IF NOT EXISTS idx_wre_rule_executed
  ON workflow_rule_executions (rule_id, executed_at DESC);

CREATE INDEX IF NOT EXISTS idx_wre_idempotency
  ON workflow_rule_executions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Index for scheduler: find rules ready to run
CREATE INDEX IF NOT EXISTS idx_war_next_run
  ON workflow_automation_rules (next_run_at)
  WHERE is_active = true AND next_run_at IS NOT NULL;

-- 3. RLS for workflow_rule_executions
ALTER TABLE workflow_rule_executions ENABLE ROW LEVEL SECURITY;

-- SELECT: anyone with workflow access
CREATE POLICY "Users can view executions for accessible workflows"
  ON workflow_rule_executions FOR SELECT
  USING (
    user_has_workflow_access(workflow_id, auth.uid())
  );

-- INSERT: only SECURITY DEFINER functions (no direct insert by users)
-- We rely on the functions being SECURITY DEFINER to bypass RLS for inserts.
-- No INSERT policy = blocked for regular users.

-- DELETE: workflow owner/admin only (for cleanup)
CREATE POLICY "Admins can delete execution logs"
  ON workflow_rule_executions FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM workflows w
      WHERE w.id = workflow_rule_executions.workflow_id
        AND w.created_by = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM workflow_collaborations wc
      WHERE wc.workflow_id = workflow_rule_executions.workflow_id
        AND wc.user_id = auth.uid()
        AND wc.permission = 'admin'
    )
  );

-- ============================================================================
-- 4. compute_next_run_at: given a rule's condition_value, compute next fire time
-- ============================================================================
CREATE OR REPLACE FUNCTION compute_next_run_at(
  p_condition_type TEXT,
  p_condition_value JSONB,
  p_from_time TIMESTAMPTZ DEFAULT now()
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_pattern TEXT;
  v_interval_val INT;
  v_trigger_time TIME;
  v_next TIMESTAMPTZ;
  v_base_date DATE;
  v_day_num INT;
  v_month_name TEXT;
  v_month_num INT;
  v_end_type TEXT;
  v_end_date DATE;
  v_occurrences INT;
  v_dow TEXT[];
  v_dow_nums INT[];
  v_i INT;
  v_candidate DATE;
  v_found BOOLEAN;
BEGIN
  -- Only handle time_interval conditions
  IF p_condition_type != 'time_interval' THEN
    -- For branch_ending rules with time_after_creation, we don't compute next_run_at
    -- Those are evaluated per-branch, not on a global schedule
    RETURN NULL;
  END IF;

  v_pattern := p_condition_value->>'pattern_type';
  v_interval_val := COALESCE((p_condition_value->>'interval')::INT, 1);

  -- Parse trigger time (default 09:00 UTC)
  BEGIN
    v_trigger_time := COALESCE(p_condition_value->>'trigger_time', '09:00')::TIME;
  EXCEPTION WHEN OTHERS THEN
    v_trigger_time := '09:00'::TIME;
  END;

  -- Check end conditions
  v_end_type := COALESCE(p_condition_value->>'end_type', 'no_end');
  IF v_end_type = 'end_by_date' THEN
    BEGIN
      v_end_date := (p_condition_value->>'end_date')::DATE;
      IF v_end_date < p_from_time::DATE THEN
        RETURN NULL;  -- Past end date
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;  -- Ignore bad date
    END;
  END IF;

  v_base_date := p_from_time::DATE;

  CASE v_pattern
    -- ===== DAILY =====
    WHEN 'daily' THEN
      IF COALESCE(p_condition_value->>'daily_type', 'every_x_days') = 'every_weekday' THEN
        -- Next weekday
        v_candidate := v_base_date;
        IF (p_from_time::TIME >= v_trigger_time) THEN
          v_candidate := v_candidate + 1;
        END IF;
        -- Skip weekends
        WHILE EXTRACT(ISODOW FROM v_candidate) > 5 LOOP
          v_candidate := v_candidate + 1;
        END LOOP;
        v_next := v_candidate + v_trigger_time;
      ELSE
        -- Every N days
        v_next := v_base_date + (v_interval_val || ' days')::INTERVAL + v_trigger_time;
        -- If computed time is before now, advance
        IF v_next <= p_from_time THEN
          v_next := v_next + (v_interval_val || ' days')::INTERVAL;
        END IF;
      END IF;

    -- ===== WEEKLY =====
    WHEN 'weekly' THEN
      -- Get target days of week
      v_dow_nums := ARRAY[]::INT[];
      IF p_condition_value ? 'days_of_week' THEN
        FOR v_i IN 0..6 LOOP
          DECLARE
            v_day_name TEXT;
          BEGIN
            v_day_name := p_condition_value->'days_of_week'->>v_i;
            EXIT WHEN v_day_name IS NULL;
            CASE v_day_name
              WHEN 'monday' THEN v_dow_nums := array_append(v_dow_nums, 1);
              WHEN 'tuesday' THEN v_dow_nums := array_append(v_dow_nums, 2);
              WHEN 'wednesday' THEN v_dow_nums := array_append(v_dow_nums, 3);
              WHEN 'thursday' THEN v_dow_nums := array_append(v_dow_nums, 4);
              WHEN 'friday' THEN v_dow_nums := array_append(v_dow_nums, 5);
              WHEN 'saturday' THEN v_dow_nums := array_append(v_dow_nums, 6);
              WHEN 'sunday' THEN v_dow_nums := array_append(v_dow_nums, 7);
              ELSE NULL;
            END CASE;
          END;
        END LOOP;
      END IF;

      IF array_length(v_dow_nums, 1) IS NULL OR array_length(v_dow_nums, 1) = 0 THEN
        v_dow_nums := ARRAY[1]; -- Default to Monday
      END IF;

      -- Find next matching day
      v_candidate := v_base_date;
      IF p_from_time::TIME >= v_trigger_time THEN
        v_candidate := v_candidate + 1;
      END IF;

      v_found := false;
      FOR v_i IN 0..((v_interval_val * 7) + 7) LOOP  -- Search up to interval+1 weeks
        IF EXTRACT(ISODOW FROM v_candidate + v_i)::INT = ANY(v_dow_nums) THEN
          v_next := (v_candidate + v_i) + v_trigger_time;
          IF v_next > p_from_time THEN
            v_found := true;
            EXIT;
          END IF;
        END IF;
      END LOOP;

      IF NOT v_found THEN
        -- Fallback: next week Monday
        v_next := v_base_date + ((7 * v_interval_val) || ' days')::INTERVAL + v_trigger_time;
      END IF;

    -- ===== MONTHLY =====
    WHEN 'monthly' THEN
      v_day_num := COALESCE((p_condition_value->>'day_number')::INT, 1);
      IF COALESCE(p_condition_value->>'monthly_type', 'day_of_month') = 'day_of_month' THEN
        -- Day N of month
        v_candidate := make_date(
          EXTRACT(YEAR FROM p_from_time)::INT,
          EXTRACT(MONTH FROM p_from_time)::INT,
          LEAST(v_day_num, 28)  -- Clamp to 28 to avoid month overflow
        );
        v_next := v_candidate + v_trigger_time;
        IF v_next <= p_from_time THEN
          -- Next month
          v_candidate := v_candidate + (v_interval_val || ' months')::INTERVAL;
          v_next := v_candidate + v_trigger_time;
        END IF;
      ELSE
        -- position_of_month: "first Monday", etc. — complex, return approximate
        v_next := (date_trunc('month', p_from_time) + (v_interval_val || ' months')::INTERVAL)::DATE + v_trigger_time;
      END IF;

    -- ===== QUARTERLY =====
    WHEN 'quarterly' THEN
      v_day_num := COALESCE((p_condition_value->>'day_number')::INT, 1);
      -- Find current quarter start
      DECLARE
        v_qstart DATE;
        v_qmonth INT;
      BEGIN
        v_qmonth := ((EXTRACT(QUARTER FROM p_from_time)::INT - 1) * 3) + 1;
        v_qstart := make_date(EXTRACT(YEAR FROM p_from_time)::INT, v_qmonth, 1);
        v_candidate := v_qstart + (LEAST(v_day_num, 28) - 1);
        v_next := v_candidate + v_trigger_time;
        IF v_next <= p_from_time THEN
          -- Next quarter
          v_candidate := (v_qstart + (3 * v_interval_val || ' months')::INTERVAL)::DATE + (LEAST(v_day_num, 28) - 1);
          v_next := v_candidate + v_trigger_time;
        END IF;
      END;

    -- ===== YEARLY =====
    WHEN 'yearly' THEN
      v_month_name := COALESCE(p_condition_value->>'month', 'january');
      v_day_num := COALESCE((p_condition_value->>'day_number')::INT, 1);
      CASE v_month_name
        WHEN 'january' THEN v_month_num := 1;
        WHEN 'february' THEN v_month_num := 2;
        WHEN 'march' THEN v_month_num := 3;
        WHEN 'april' THEN v_month_num := 4;
        WHEN 'may' THEN v_month_num := 5;
        WHEN 'june' THEN v_month_num := 6;
        WHEN 'july' THEN v_month_num := 7;
        WHEN 'august' THEN v_month_num := 8;
        WHEN 'september' THEN v_month_num := 9;
        WHEN 'october' THEN v_month_num := 10;
        WHEN 'november' THEN v_month_num := 11;
        WHEN 'december' THEN v_month_num := 12;
        ELSE v_month_num := 1;
      END CASE;
      BEGIN
        v_candidate := make_date(EXTRACT(YEAR FROM p_from_time)::INT, v_month_num, LEAST(v_day_num, 28));
      EXCEPTION WHEN OTHERS THEN
        v_candidate := make_date(EXTRACT(YEAR FROM p_from_time)::INT, v_month_num, 28);
      END;
      v_next := v_candidate + v_trigger_time;
      IF v_next <= p_from_time THEN
        BEGIN
          v_candidate := make_date(EXTRACT(YEAR FROM p_from_time)::INT + v_interval_val, v_month_num, LEAST(v_day_num, 28));
        EXCEPTION WHEN OTHERS THEN
          v_candidate := make_date(EXTRACT(YEAR FROM p_from_time)::INT + v_interval_val, v_month_num, 28);
        END;
        v_next := v_candidate + v_trigger_time;
      END IF;

    ELSE
      -- Unsupported pattern
      RETURN NULL;
  END CASE;

  -- Check end date constraint
  IF v_end_date IS NOT NULL AND v_next::DATE > v_end_date THEN
    RETURN NULL;
  END IF;

  RETURN v_next;
END;
$$;

COMMENT ON FUNCTION compute_next_run_at IS
  'Computes the next scheduled run time for a time_interval automation rule based on its condition_value recurrence pattern.';

-- ============================================================================
-- 5. execute_single_automation_rule: run one rule, log result
-- ============================================================================
CREATE OR REPLACE FUNCTION execute_single_automation_rule(
  p_rule_id UUID,
  p_user_id UUID DEFAULT NULL,
  p_trigger_source TEXT DEFAULT 'manual'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rule RECORD;
  v_workflow RECORD;
  v_result JSONB;
  v_status TEXT;
  v_error TEXT;
  v_idem_key TEXT;
  v_suffix TEXT;
  v_processed_suffix TEXT;
  v_new_branch_id UUID;
  v_branch_count INT;
  v_active_version RECORD;
  v_lock_key BIGINT;
  v_lock_acquired BOOLEAN;
  v_branches_ended INT := 0;
BEGIN
  -- Load rule
  SELECT * INTO v_rule
  FROM workflow_automation_rules
  WHERE id = p_rule_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'error', 'error', 'Rule not found');
  END IF;

  IF NOT v_rule.is_active THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'Rule is inactive');
  END IF;

  -- Load parent workflow (rules are on templates, not branches)
  SELECT * INTO v_workflow
  FROM workflows
  WHERE id = v_rule.workflow_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'error', 'error', 'Workflow not found');
  END IF;

  -- Permission check for manual triggers
  IF p_user_id IS NOT NULL AND p_trigger_source = 'manual' THEN
    IF NOT user_has_workflow_access(v_rule.workflow_id, p_user_id) THEN
      RETURN jsonb_build_object('status', 'error', 'error', 'Access denied');
    END IF;
    -- Check admin permission
    IF v_workflow.created_by != p_user_id
       AND NOT EXISTS (
         SELECT 1 FROM workflow_collaborations
         WHERE workflow_id = v_rule.workflow_id
           AND user_id = p_user_id
           AND permission = 'admin'
       )
    THEN
      RETURN jsonb_build_object('status', 'error', 'error', 'Admin permission required');
    END IF;
  END IF;

  -- Execute based on rule category + action type
  BEGIN
    -- ===== BRANCH CREATION RULES =====
    IF v_rule.rule_category IS NULL OR v_rule.rule_category = 'branch_creation' THEN
      IF v_rule.action_type IN ('branch_copy', 'branch_nocopy') THEN
        v_suffix := COALESCE(v_rule.action_value->>'branch_suffix', '{MONTH} {YEAR}');
        v_processed_suffix := process_dynamic_suffix(v_suffix);

        -- Get active template version
        SELECT * INTO v_active_version
        FROM workflow_template_versions
        WHERE workflow_id = v_rule.workflow_id
          AND is_active = true
        LIMIT 1;

        -- Idempotency: build a key from workflow + version + processed suffix
        v_idem_key := v_rule.workflow_id::TEXT || ':' ||
                      COALESCE(v_active_version.id::TEXT, 'no-version') || ':' ||
                      v_processed_suffix;

        -- Check if already executed with this key
        IF EXISTS (
          SELECT 1 FROM workflow_rule_executions
          WHERE idempotency_key = v_idem_key
            AND status = 'success'
        ) THEN
          v_status := 'skipped';
          v_result := jsonb_build_object('reason', 'branch_exists', 'suffix', v_processed_suffix);

          INSERT INTO workflow_rule_executions
            (workflow_id, rule_id, trigger_source, status, result_summary, executed_by, idempotency_key)
          VALUES
            (v_rule.workflow_id, p_rule_id, p_trigger_source, v_status, v_result, p_user_id, v_idem_key);

          -- Update rule metadata
          UPDATE workflow_automation_rules
          SET last_run_at = now(),
              run_count = run_count + 1,
              last_status = v_status,
              last_error = NULL,
              next_run_at = compute_next_run_at(v_rule.condition_type, v_rule.condition_value, now())
          WHERE id = p_rule_id;

          RETURN jsonb_build_object('status', v_status, 'result', v_result);
        END IF;

        -- Advisory lock to prevent concurrent branch creation
        v_lock_key := hashtext(v_idem_key);
        v_lock_acquired := pg_try_advisory_xact_lock(v_lock_key);

        IF NOT v_lock_acquired THEN
          v_status := 'skipped';
          v_result := jsonb_build_object('reason', 'concurrent_execution');

          INSERT INTO workflow_rule_executions
            (workflow_id, rule_id, trigger_source, status, result_summary, executed_by, idempotency_key)
          VALUES
            (v_rule.workflow_id, p_rule_id, p_trigger_source, v_status, v_result, p_user_id, v_idem_key);

          RETURN jsonb_build_object('status', v_status, 'result', v_result);
        END IF;

        -- Check if branch already exists for this version + suffix
        IF v_active_version.id IS NOT NULL THEN
          SELECT COUNT(*) INTO v_branch_count
          FROM workflows
          WHERE parent_workflow_id = v_rule.workflow_id
            AND template_version_id = v_active_version.id
            AND branch_suffix = v_processed_suffix
            AND deleted IS NOT TRUE;
        ELSE
          SELECT COUNT(*) INTO v_branch_count
          FROM workflows
          WHERE parent_workflow_id = v_rule.workflow_id
            AND branch_suffix = v_processed_suffix
            AND deleted IS NOT TRUE;
        END IF;

        IF v_branch_count > 0 THEN
          v_status := 'skipped';
          v_result := jsonb_build_object('reason', 'branch_exists', 'suffix', v_processed_suffix);
        ELSE
          -- Create the branch using existing copy function
          v_new_branch_id := copy_workflow_with_unique_name(
            v_rule.workflow_id,
            v_suffix,           -- pass raw suffix; function processes it
            COALESCE(p_user_id, v_workflow.created_by),
            v_rule.action_type = 'branch_copy'  -- copy progress only for branch_copy
          );

          -- Link branch to template version and parent
          UPDATE workflows
          SET parent_workflow_id = v_rule.workflow_id,
              branch_suffix = v_processed_suffix,
              branched_at = now(),
              template_version_id = v_active_version.id,
              template_version_number = v_active_version.version_number,
              status = 'active'
          WHERE id = v_new_branch_id;

          v_status := 'success';
          v_result := jsonb_build_object(
            'action', v_rule.action_type,
            'branch_id', v_new_branch_id,
            'branch_suffix', v_processed_suffix,
            'template_version', v_active_version.version_number
          );
        END IF;

      ELSE
        v_status := 'skipped';
        v_result := jsonb_build_object('reason', 'unsupported_action', 'action_type', v_rule.action_type);
      END IF;

    -- ===== BRANCH ENDING RULES =====
    ELSIF v_rule.rule_category = 'branch_ending' THEN
      -- Evaluate branch ending conditions
      IF v_rule.condition_type = 'time_after_creation' THEN
        DECLARE
          v_amount INT;
          v_unit TEXT;
          v_interval_expr INTERVAL;
          v_branch RECORD;
        BEGIN
          v_amount := COALESCE((v_rule.condition_value->>'amount')::INT, 30);
          v_unit := COALESCE(v_rule.condition_value->>'unit', 'days');

          -- Build interval
          v_interval_expr := (v_amount || ' ' || v_unit)::INTERVAL;

          -- Add secondary duration if present
          IF v_rule.condition_value->>'secondaryAmount' IS NOT NULL THEN
            v_interval_expr := v_interval_expr +
              ((v_rule.condition_value->>'secondaryAmount')::INT || ' ' ||
               COALESCE(v_rule.condition_value->>'secondaryUnit', 'days'))::INTERVAL;
          END IF;

          -- Find and end eligible branches
          FOR v_branch IN
            SELECT id, name, branched_at
            FROM workflows
            WHERE parent_workflow_id = v_rule.workflow_id
              AND status = 'active'
              AND archived IS NOT TRUE
              AND deleted IS NOT TRUE
              AND branched_at IS NOT NULL
              AND branched_at + v_interval_expr <= now()
          LOOP
            UPDATE workflows
            SET status = 'ended',
                archived = true,
                archived_at = now()
            WHERE id = v_branch.id;

            v_branches_ended := v_branches_ended + 1;
          END LOOP;

          v_status := 'success';
          v_result := jsonb_build_object(
            'action', 'branch_ending',
            'branches_ended', v_branches_ended,
            'condition', v_amount || ' ' || v_unit
          );
        END;

      ELSIF v_rule.condition_type = 'specific_date' THEN
        DECLARE
          v_target_date DATE;
          v_branch RECORD;
        BEGIN
          v_target_date := (v_rule.condition_value->>'date')::DATE;

          IF v_target_date IS NOT NULL AND v_target_date <= now()::DATE THEN
            FOR v_branch IN
              SELECT id, name
              FROM workflows
              WHERE parent_workflow_id = v_rule.workflow_id
                AND status = 'active'
                AND archived IS NOT TRUE
                AND deleted IS NOT TRUE
            LOOP
              UPDATE workflows
              SET status = 'ended',
                  archived = true,
                  archived_at = now()
              WHERE id = v_branch.id;

              v_branches_ended := v_branches_ended + 1;
            END LOOP;
          END IF;

          v_status := 'success';
          v_result := jsonb_build_object(
            'action', 'branch_ending',
            'branches_ended', v_branches_ended,
            'target_date', v_target_date
          );
        END;

      ELSE
        v_status := 'skipped';
        v_result := jsonb_build_object('reason', 'unsupported_condition', 'condition_type', v_rule.condition_type);
      END IF;

    -- ===== UNSUPPORTED CATEGORY =====
    ELSE
      v_status := 'skipped';
      v_result := jsonb_build_object('reason', 'unsupported_category', 'category', v_rule.rule_category);
    END IF;

  EXCEPTION WHEN OTHERS THEN
    v_status := 'error';
    v_error := SQLERRM;
    v_result := jsonb_build_object('error', SQLERRM);
  END;

  -- Log execution
  INSERT INTO workflow_rule_executions
    (workflow_id, rule_id, trigger_source, status, result_summary, error_message, executed_by, idempotency_key)
  VALUES
    (v_rule.workflow_id, p_rule_id, p_trigger_source, v_status, v_result, v_error, p_user_id, v_idem_key);

  -- Update rule metadata
  UPDATE workflow_automation_rules
  SET last_run_at = now(),
      run_count = run_count + 1,
      last_status = v_status,
      last_error = v_error,
      next_run_at = CASE
        WHEN v_rule.condition_type = 'time_interval'
        THEN compute_next_run_at(v_rule.condition_type, v_rule.condition_value, now())
        ELSE next_run_at
      END
  WHERE id = p_rule_id;

  RETURN jsonb_build_object('status', v_status, 'result', v_result, 'error', v_error);
END;
$$;

COMMENT ON FUNCTION execute_single_automation_rule IS
  'Executes a single automation rule with permission checks, idempotency, and logging. Supports branch_creation and branch_ending rules.';

GRANT EXECUTE ON FUNCTION execute_single_automation_rule(UUID, UUID, TEXT) TO authenticated;

-- ============================================================================
-- 6. evaluate_pending_rules: scheduler tick function
-- ============================================================================
CREATE OR REPLACE FUNCTION evaluate_pending_rules()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_lock_key BIGINT := hashtext('workflow_rule_scheduler');
  v_rule RECORD;
  v_count INT := 0;
  v_results JSONB := '[]'::JSONB;
  v_exec_result JSONB;
BEGIN
  -- Acquire global advisory lock (non-blocking)
  IF NOT pg_try_advisory_lock(v_lock_key) THEN
    RETURN jsonb_build_object(
      'status', 'skipped',
      'reason', 'Another scheduler instance is running',
      'processed', 0
    );
  END IF;

  BEGIN
    -- Find all rules due to fire
    FOR v_rule IN
      SELECT id, workflow_id, rule_name
      FROM workflow_automation_rules
      WHERE is_active = true
        AND next_run_at IS NOT NULL
        AND next_run_at <= now()
      ORDER BY next_run_at ASC
      LIMIT 50  -- Process max 50 per tick to avoid long locks
    LOOP
      v_exec_result := execute_single_automation_rule(v_rule.id, NULL, 'scheduler');
      v_results := v_results || jsonb_build_object(
        'rule_id', v_rule.id,
        'rule_name', v_rule.rule_name,
        'result', v_exec_result
      );
      v_count := v_count + 1;
    END LOOP;

    -- Release advisory lock
    PERFORM pg_advisory_unlock(v_lock_key);

    RETURN jsonb_build_object(
      'status', 'success',
      'processed', v_count,
      'results', v_results
    );
  EXCEPTION WHEN OTHERS THEN
    -- Release lock on error
    PERFORM pg_advisory_unlock(v_lock_key);
    RAISE;
  END;
END;
$$;

COMMENT ON FUNCTION evaluate_pending_rules IS
  'Scheduler tick function: finds rules with next_run_at <= now() and executes them. Uses advisory lock to prevent concurrent runs.';

GRANT EXECUTE ON FUNCTION evaluate_pending_rules() TO authenticated;

-- ============================================================================
-- 7. Backfill: compute next_run_at for existing time_interval rules
-- ============================================================================
UPDATE workflow_automation_rules
SET next_run_at = compute_next_run_at(condition_type, condition_value, now())
WHERE condition_type = 'time_interval'
  AND is_active = true
  AND next_run_at IS NULL;
