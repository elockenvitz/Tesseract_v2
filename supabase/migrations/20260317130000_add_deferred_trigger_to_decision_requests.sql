-- Event-based deferral triggers for decision requests.
-- Complements deferred_until (time-based) with rule-based resurfacing.
-- Examples:
--   {"type":"price_level","symbol":"AAPL","condition":"above","price":180}
--   {"type":"earnings","symbol":"AAPL"}
--   {"type":"custom","description":"After Fed meeting"}

ALTER TABLE decision_requests
  ADD COLUMN IF NOT EXISTS deferred_trigger JSONB;
