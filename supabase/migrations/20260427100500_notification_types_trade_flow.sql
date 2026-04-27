-- Add notification types used by the trade-flow + coverage triggers below.
-- Done as its own migration so the type values are committed before any
-- trigger references them (Postgres doesn't allow ALTER TYPE in a tx that
-- also uses the new value).
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'accepted_trade_committed';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'accepted_trade_status';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'accepted_trade_comment';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'trade_batch_status';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'decision_request_resolved';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'coverage_request_resolved';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'coverage_added';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'coverage_removed';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'ai_rate_limit_hit';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'ai_provider_error';
