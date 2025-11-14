/*
  # Create Initial Versions for Existing Workflows

  Creates Version 1 for all existing workflows that don't have any template versions yet.
  This ensures every workflow has at least one version snapshot.
*/

-- Create initial versions for all workflows that don't have any versions
DO $$
DECLARE
  workflow_record RECORD;
  version_count INTEGER;
BEGIN
  -- Loop through all workflows
  FOR workflow_record IN
    SELECT id FROM workflows
  LOOP
    -- Check if this workflow has any versions
    SELECT COUNT(*) INTO version_count
    FROM workflow_template_versions
    WHERE workflow_id = workflow_record.id;

    -- If no versions exist, create initial version
    IF version_count = 0 THEN
      BEGIN
        PERFORM create_initial_template_version(workflow_record.id);
        RAISE NOTICE 'Created initial version for workflow: %', workflow_record.id;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE WARNING 'Failed to create initial version for workflow %: %', workflow_record.id, SQLERRM;
      END;
    END IF;
  END LOOP;
END $$;
