-- ============================================================================
-- Migration: cascade_end_runs_on_process_archive
--
-- When a parent Process (parent_workflow_id IS NULL) is archived, automatically
-- end all its active child Runs (parent_workflow_id = process.id) by setting
-- status = 'inactive'. This prevents "orphan active runs" — runs that appear
-- active but belong to an archived process.
--
-- IMPORTANT: The DB CHECK constraint on workflows.status allows only
-- 'active' | 'inactive'. "Ended" is represented as status='inactive'.
--
-- The trigger:
--   - Fires AFTER UPDATE on workflows
--   - Only acts when archived transitions from false → true
--   - Only acts on parent processes (parent_workflow_id IS NULL)
--   - Sets status='inactive' on all active, non-deleted child runs
--   - Is idempotent: re-archiving an already-archived process is a no-op
--     because the condition OLD.archived = false will not match
--
-- Does NOT:
--   - Archive the child runs (only ends them; archival is a separate action)
--   - Touch template versions, stages, checklists, or any other related data
--   - Delete anything
--
-- Logging:
--   TODO: workflow_rule_executions requires a non-null rule_id FK, so we
--   cannot log from this trigger without either (a) creating a sentinel
--   automation rule, or (b) adding a separate audit table. Skipped for now.
--   The frontend "Data issue" banner will catch any legacy orphans.
-- ============================================================================

-- 1. Create or replace the trigger function
CREATE OR REPLACE FUNCTION cascade_end_runs_on_process_archive()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ended_count INT;
BEGIN
  -- Guard: only fire when archived transitions false → true
  IF NEW.archived IS NOT TRUE OR OLD.archived IS NOT FALSE THEN
    RETURN NEW;
  END IF;

  -- Guard: only fire for parent processes (not runs/branches)
  IF NEW.parent_workflow_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- End all active, non-deleted child runs for this process.
  -- DB CHECK constraint: status IN ('active', 'inactive').
  -- 'inactive' = ended/stopped.
  UPDATE workflows
  SET status = 'inactive'
  WHERE parent_workflow_id = NEW.id
    AND status = 'active'
    AND (deleted = false OR deleted IS NULL);

  GET DIAGNOSTICS v_ended_count = ROW_COUNT;

  -- Log to server log for observability (no table insert due to rule_id FK)
  IF v_ended_count > 0 THEN
    RAISE LOG 'cascade_end_runs_on_process_archive: ended % active run(s) for process % (%)',
      v_ended_count, NEW.id, NEW.name;
  END IF;

  RETURN NEW;
END;
$$;

-- 2. Create the trigger (drop first for idempotency)
DROP TRIGGER IF EXISTS trg_cascade_end_runs_on_process_archive ON workflows;

CREATE TRIGGER trg_cascade_end_runs_on_process_archive
  AFTER UPDATE OF archived ON workflows
  FOR EACH ROW
  WHEN (NEW.archived = true AND OLD.archived = false)
  EXECUTE FUNCTION cascade_end_runs_on_process_archive();

-- 3. Fix existing orphan data: end active runs whose parent is already archived.
-- This is a one-time data repair for runs that predate the trigger.
UPDATE workflows r
SET status = 'inactive'
FROM workflows p
WHERE r.parent_workflow_id = p.id
  AND r.parent_workflow_id IS NOT NULL
  AND r.status = 'active'
  AND (r.deleted = false OR r.deleted IS NULL)
  AND (r.archived = false OR r.archived IS NULL)
  AND p.archived = true;

-- ============================================================================
-- Smoke Test (run manually, not part of migration execution)
-- ============================================================================
--
-- -- Setup: create a parent process
-- INSERT INTO workflows (id, name, status, archived, deleted, parent_workflow_id, created_by)
-- VALUES
--   ('aaaaaaaa-0000-0000-0000-000000000001', 'Test Process', 'active', false, false, NULL,
--    (SELECT id FROM auth.users LIMIT 1));
--
-- -- Setup: create two active child runs
-- INSERT INTO workflows (id, name, status, archived, deleted, parent_workflow_id, created_by)
-- VALUES
--   ('aaaaaaaa-0000-0000-0000-000000000002', 'Run 1', 'active', false, false,
--    'aaaaaaaa-0000-0000-0000-000000000001', (SELECT id FROM auth.users LIMIT 1)),
--   ('aaaaaaaa-0000-0000-0000-000000000003', 'Run 2', 'active', false, false,
--    'aaaaaaaa-0000-0000-0000-000000000001', (SELECT id FROM auth.users LIMIT 1));
--
-- -- Verify both runs are active
-- SELECT id, name, status, archived FROM workflows
-- WHERE parent_workflow_id = 'aaaaaaaa-0000-0000-0000-000000000001';
-- -- Expected: Run 1 active, Run 2 active
--
-- -- Action: archive the parent process
-- UPDATE workflows SET archived = true, archived_at = now()
-- WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
--
-- -- Verify both runs are now inactive (ended)
-- SELECT id, name, status, archived FROM workflows
-- WHERE parent_workflow_id = 'aaaaaaaa-0000-0000-0000-000000000001';
-- -- Expected: Run 1 inactive, Run 2 inactive
--
-- -- Cleanup
-- DELETE FROM workflows WHERE id IN (
--   'aaaaaaaa-0000-0000-0000-000000000001',
--   'aaaaaaaa-0000-0000-0000-000000000002',
--   'aaaaaaaa-0000-0000-0000-000000000003'
-- );
