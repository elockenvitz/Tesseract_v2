-- ============================================================================
-- Migration: deactivate_rules_on_process_archive
--
-- When a parent Process is archived, deactivate all its automation rules
-- (set is_active = false, clear next_run_at) so no new runs auto-start.
-- When unarchived, reactivate them.
--
-- This extends the existing cascade_end_runs_on_process_archive trigger
-- to also handle automation rules, keeping everything in one trigger.
-- ============================================================================

-- 1. Replace the trigger function to also handle automation rules
CREATE OR REPLACE FUNCTION cascade_end_runs_on_process_archive()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ended_count INT;
  v_rules_count INT;
BEGIN
  -- Guard: only fire for parent processes (not runs/branches)
  IF NEW.parent_workflow_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- === ARCHIVE: archived transitions false → true ===
  IF NEW.archived IS TRUE AND OLD.archived IS NOT TRUE THEN
    -- End all active, non-deleted child runs
    UPDATE workflows
    SET status = 'inactive'
    WHERE parent_workflow_id = NEW.id
      AND status = 'active'
      AND (deleted = false OR deleted IS NULL);

    GET DIAGNOSTICS v_ended_count = ROW_COUNT;

    -- Deactivate all automation rules for this process
    UPDATE workflow_automation_rules
    SET is_active = false,
        next_run_at = NULL
    WHERE workflow_id = NEW.id
      AND is_active = true;

    GET DIAGNOSTICS v_rules_count = ROW_COUNT;

    IF v_ended_count > 0 OR v_rules_count > 0 THEN
      RAISE LOG 'cascade_end_runs_on_process_archive: ended % run(s), deactivated % rule(s) for process % (%)',
        v_ended_count, v_rules_count, NEW.id, NEW.name;
    END IF;
  END IF;

  -- === UNARCHIVE: archived transitions true → false ===
  IF NEW.archived IS NOT TRUE AND OLD.archived IS TRUE THEN
    -- Reactivate automation rules for this process
    UPDATE workflow_automation_rules
    SET is_active = true
    WHERE workflow_id = NEW.id
      AND is_active = false;

    GET DIAGNOSTICS v_rules_count = ROW_COUNT;

    IF v_rules_count > 0 THEN
      RAISE LOG 'cascade_end_runs_on_process_archive: reactivated % rule(s) for unarchived process % (%)',
        v_rules_count, NEW.id, NEW.name;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 2. Recreate the trigger to fire on both archive and unarchive
DROP TRIGGER IF EXISTS trg_cascade_end_runs_on_process_archive ON workflows;

CREATE TRIGGER trg_cascade_end_runs_on_process_archive
  AFTER UPDATE OF archived ON workflows
  FOR EACH ROW
  WHEN (NEW.archived IS DISTINCT FROM OLD.archived)
  EXECUTE FUNCTION cascade_end_runs_on_process_archive();

-- 3. Fix existing data: deactivate rules for already-archived processes
UPDATE workflow_automation_rules r
SET is_active = false,
    next_run_at = NULL
FROM workflows w
WHERE r.workflow_id = w.id
  AND w.archived = true
  AND r.is_active = true;

-- 4. Fix existing orphan runs: end active runs whose parent is archived or deleted
UPDATE workflows r
SET status = 'inactive'
FROM workflows p
WHERE r.parent_workflow_id = p.id
  AND r.parent_workflow_id IS NOT NULL
  AND r.status = 'active'
  AND (r.deleted = false OR r.deleted IS NULL)
  AND (r.archived = false OR r.archived IS NULL)
  AND (p.archived = true OR p.deleted = true);
