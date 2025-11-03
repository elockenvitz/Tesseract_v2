/*
  # Fix Backfilled History Records

  Updates backfilled coverage_history records that have NULL changed_by
  to use the user_id of the coverage record owner instead.
*/

-- Update backfilled records with NULL changed_by to use the coverage owner
UPDATE coverage_history ch
SET changed_by = ch.new_user_id
WHERE ch.changed_by IS NULL
  AND ch.change_type = 'created'
  AND ch.new_user_id IS NOT NULL;
