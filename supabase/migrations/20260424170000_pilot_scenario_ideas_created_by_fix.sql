-- Pilot-seeded AAPL + MSFT trade_queue_items were originally
-- written with the template author's user_id as created_by, which
-- makes the pilot's own Idea Pipeline show them as "created by
-- Money Moves / Dan L" instead of the pilot themselves. Backfill
-- to use the pilot user's id (pulled from the linked
-- pilot_scenarios row).

UPDATE trade_queue_items tqi
SET created_by = ps.user_id
FROM pilot_scenarios ps
WHERE (tqi.origin_metadata->>'pilot_scenario_id')::UUID = ps.id
  AND ps.user_id IS NOT NULL
  AND tqi.created_by IS DISTINCT FROM ps.user_id;
