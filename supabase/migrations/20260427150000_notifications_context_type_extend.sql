-- ============================================================================
-- Expand notifications.context_type check constraint.
--
-- The new notification triggers (trade flow, coverage handoff, org admin
-- actions, AI failures, simulation shares) reference context_type values
-- the original constraint didn't permit, so the inserts blew up with
-- `notifications_context_type_check`. This adds every value our triggers
-- and client-side inserts now use.
--
-- Long-term cleanup: replace this check with an enum or move to a
-- "allowed" lookup table. For now extend in place to unblock the flows.
-- ============================================================================

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_context_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_context_type_check
  CHECK (context_type = ANY (ARRAY[
    -- Original values
    'asset', 'note', 'portfolio', 'theme', 'list', 'workflow', 'project',
    'price_target', 'decision_request',
    -- Added by trade-flow + comments + batches
    'accepted_trade', 'trade_batch', 'trade_idea',
    -- Added by coverage handoff (single-asset uses 'asset'; bulk uses this)
    'coverage_bulk',
    -- Added by org admin action notifications
    'organization', 'user',
    -- Added by AI rate-limit / provider-error notifications (server-side)
    'ai_usage', 'ai_config',
    -- Added by simulation share notifications
    'simulation_share',
    -- Used by mention notifications from DM / messaging components
    'conversation'
  ]::text[]));
