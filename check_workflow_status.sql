-- Check AAPL workflow status
SELECT 
  a.symbol,
  w.name as workflow_name,
  awp.is_started,
  awp.is_completed,
  awp.current_stage_key,
  awp.started_at,
  awp.updated_at
FROM asset_workflow_progress awp
JOIN assets a ON a.id = awp.asset_id
JOIN workflows w ON w.id = awp.workflow_id
WHERE a.symbol = 'AAPL'
  AND w.name LIKE '%earnings%'
ORDER BY awp.updated_at DESC;
