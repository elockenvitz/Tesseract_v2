-- =============================================================================
-- ROLLBACK for 20261115120000_decision_review_typed_subject.sql
--
-- Safe to run at any time. The forward migration is purely additive: it adds
-- columns, constraints, indexes, one helper function and one trigger, and
-- backfills ONLY the columns it added. It changes no existing column, no
-- existing constraint (UNIQUE(decision_id) is untouched), no policy, no grant
-- and no row's pre-existing data.
--
-- So this rollback loses nothing except the derivation itself, which the
-- forward migration can recompute from `decision_id` at any time.
--
-- Order matters: drop the trigger before the function it calls, and the
-- constraints before the columns they reference.
-- =============================================================================

BEGIN;

DROP TRIGGER IF EXISTS decision_reviews_subject ON public.decision_reviews;
DROP FUNCTION IF EXISTS public.decision_reviews_set_subject();

ALTER TABLE public.decision_reviews
  DROP CONSTRAINT IF EXISTS decision_reviews_one_subject;
ALTER TABLE public.decision_reviews
  DROP CONSTRAINT IF EXISTS decision_reviews_subject_type_check;

DROP INDEX IF EXISTS public.idx_decision_reviews_trade_queue_item;
DROP INDEX IF EXISTS public.idx_decision_reviews_decision_request;
DROP INDEX IF EXISTS public.idx_decision_reviews_portfolio_trade_event;

ALTER TABLE public.decision_reviews
  DROP COLUMN IF EXISTS trade_queue_item_id,
  DROP COLUMN IF EXISTS decision_request_id,
  DROP COLUMN IF EXISTS portfolio_trade_event_id,
  DROP COLUMN IF EXISTS subject_type;

-- Dropped last: the backfill and the trigger both call it.
DROP FUNCTION IF EXISTS public.decision_review_subject_type(text);

COMMIT;
