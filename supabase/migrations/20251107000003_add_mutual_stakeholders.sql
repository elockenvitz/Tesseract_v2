/*
  # Add Mutual Stakeholders for Eric and John

  Add Eric Lockenvitz as a stakeholder on all of John Homler's workflows
  and vice versa, so both users can see all currently created workflows.
*/

-- Add John Homler as stakeholder on all Eric Lockenvitz's workflows
INSERT INTO workflow_stakeholders (workflow_id, user_id, created_by)
SELECT
  w.id as workflow_id,
  'a593dc84-4818-4ba6-917e-5c151fb58539' as user_id, -- John Homler
  w.created_by
FROM workflows w
WHERE w.created_by = 'fa46cffc-dafb-4071-a3ea-5536240d462e' -- Eric Lockenvitz
ON CONFLICT (workflow_id, user_id) DO NOTHING;

-- Add Eric Lockenvitz as stakeholder on all John Homler's workflows
INSERT INTO workflow_stakeholders (workflow_id, user_id, created_by)
SELECT
  w.id as workflow_id,
  'fa46cffc-dafb-4071-a3ea-5536240d462e' as user_id, -- Eric Lockenvitz
  w.created_by
FROM workflows w
WHERE w.created_by = 'a593dc84-4818-4ba6-917e-5c151fb58539' -- John Homler
ON CONFLICT (workflow_id, user_id) DO NOTHING;
