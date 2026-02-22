-- ============================================================================
-- Workflow Execution Layer v1.1 - Recompute Schedules RPC + schedule_error
-- ============================================================================

-- 1. Add schedule_error column for persistent scheduling failures
ALTER TABLE workflow_automation_rules
  ADD COLUMN IF NOT EXISTS schedule_error TEXT;

-- 2. recompute_workflow_rule_schedules: admin-only bulk recompute
CREATE OR REPLACE FUNCTION recompute_workflow_rule_schedules(
  p_workflow_id UUID,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_workflow RECORD;
  v_rule RECORD;
  v_next TIMESTAMPTZ;
  v_updated INT := 0;
  v_unsupported INT := 0;
  v_errors INT := 0;
BEGIN
  -- Load workflow
  SELECT * INTO v_workflow
  FROM workflows
  WHERE id = p_workflow_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'error', 'error', 'Workflow not found');
  END IF;

  -- Permission: creator or admin collaborator
  IF v_workflow.created_by != p_user_id
     AND NOT EXISTS (
       SELECT 1 FROM workflow_collaborations
       WHERE workflow_id = p_workflow_id
         AND user_id = p_user_id
         AND permission = 'admin'
     )
  THEN
    RETURN jsonb_build_object('status', 'error', 'error', 'Admin permission required');
  END IF;

  -- Iterate active time_interval rules for this workflow
  FOR v_rule IN
    SELECT id, condition_type, condition_value
    FROM workflow_automation_rules
    WHERE workflow_id = p_workflow_id
      AND condition_type = 'time_interval'
      AND is_active = true
  LOOP
    BEGIN
      v_next := compute_next_run_at(v_rule.condition_type, v_rule.condition_value, now());

      IF v_next IS NOT NULL THEN
        UPDATE workflow_automation_rules
        SET next_run_at = v_next,
            schedule_error = NULL
        WHERE id = v_rule.id;
        v_updated := v_updated + 1;
      ELSE
        UPDATE workflow_automation_rules
        SET next_run_at = NULL,
            schedule_error = 'Unsupported recurrence pattern'
        WHERE id = v_rule.id;
        v_unsupported := v_unsupported + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      UPDATE workflow_automation_rules
      SET schedule_error = SQLERRM
      WHERE id = v_rule.id;
      v_errors := v_errors + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'success',
    'updated', v_updated,
    'unsupported', v_unsupported,
    'errors', v_errors,
    'total', v_updated + v_unsupported + v_errors
  );
END;
$$;

COMMENT ON FUNCTION recompute_workflow_rule_schedules IS
  'Admin-only: recomputes next_run_at for all active time_interval rules in a workflow. Sets schedule_error when compute fails.';

GRANT EXECUTE ON FUNCTION recompute_workflow_rule_schedules(UUID, UUID) TO authenticated;
