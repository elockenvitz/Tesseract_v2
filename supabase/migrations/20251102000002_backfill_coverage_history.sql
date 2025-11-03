/*
  # Backfill Coverage History

  Populates the coverage_history table with initial 'created' entries
  for all existing active coverage records. This ensures that historical
  data is available for the coverage timeline and history views.
*/

-- Insert 'created' entries for all existing active coverage records
INSERT INTO coverage_history (
  coverage_id,
  asset_id,
  change_type,
  new_user_id,
  new_analyst_name,
  new_start_date,
  new_end_date,
  new_is_active,
  changed_by,
  changed_at
)
SELECT
  c.id as coverage_id,
  c.asset_id,
  'created' as change_type,
  c.user_id as new_user_id,
  c.analyst_name as new_analyst_name,
  c.start_date as new_start_date,
  c.end_date as new_end_date,
  c.is_active as new_is_active,
  c.changed_by,
  COALESCE(c.created_at, c.updated_at) as changed_at
FROM coverage c
WHERE NOT EXISTS (
  -- Only insert if no history entry exists for this coverage_id yet
  SELECT 1 FROM coverage_history ch
  WHERE ch.coverage_id = c.id
)
ORDER BY c.created_at;
