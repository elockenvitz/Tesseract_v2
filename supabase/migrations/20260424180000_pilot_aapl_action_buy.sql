-- Pilot AAPL recommendation should surface as a BUY in the pilot
-- workspace, not an ADD. Even though the scenario is adding to an
-- existing 7.2% position, "BUY" reads as the more canonical pilot
-- action and matches how the dashboard copy describes the move.

UPDATE trade_queue_items
SET action = 'buy'
WHERE origin_metadata->>'role' = 'recommendation'
  AND origin_metadata ? 'pilot_scenario_id'
  AND action = 'add';

UPDATE pilot_scenarios
SET proposed_action = 'buy'
WHERE status = 'active'
  AND is_template = FALSE
  AND proposed_action ILIKE 'add%';
