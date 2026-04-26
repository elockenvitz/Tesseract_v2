-- Allow 'reflection' as a comment_type on accepted_trade_comments.
-- Reflections are post-mortem notes added on a decision after the
-- trade has settled; they're a distinct category from sizing /
-- execution / system notes, but they live in the same comment
-- table. The original CHECK constraint pre-dated the reflection
-- feature, so the Outcomes "Post note" UI was always 23514'ing
-- against `accepted_trade_comments_comment_type_check` for any
-- decision linked to an accepted_trade.

ALTER TABLE public.accepted_trade_comments
  DROP CONSTRAINT IF EXISTS accepted_trade_comments_comment_type_check;

ALTER TABLE public.accepted_trade_comments
  ADD CONSTRAINT accepted_trade_comments_comment_type_check
  CHECK (comment_type = ANY (ARRAY[
    'note'::text,
    'sizing_change'::text,
    'execution_update'::text,
    'system'::text,
    'reflection'::text
  ]));
