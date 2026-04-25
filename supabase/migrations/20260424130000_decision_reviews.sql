-- decision_reviews — structured PM evaluation of an executed decision.
--
-- This table powers the new "Decision Quality" section in Outcomes:
-- the PM's structured assessment of whether the decision was good,
-- whether the thesis played out, whether sizing was appropriate, and
-- a free-text process note.
--
-- decision_id is polymorphic (it matches AccountabilityRow.decision_id
-- which can be a trade_queue_item id, decision_request id, or trade
-- event id). We keep it as a plain text column with a UNIQUE constraint
-- rather than a hard FK — the view layer is the source of identity.
--
-- One row per decision. PMs can update their own; everyone in the org
-- can read. The page already filters by portfolio so a portfolio-level
-- RLS check would be redundant.

CREATE TABLE IF NOT EXISTS decision_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id text NOT NULL UNIQUE,
  decision_quality text CHECK (decision_quality IN ('good', 'mixed', 'bad', 'unrated')),
  thesis_played_out text CHECK (thesis_played_out IN ('yes', 'partial', 'no', 'unknown')),
  sizing_quality text CHECK (sizing_quality IN ('too_small', 'appropriate', 'too_large', 'unknown')),
  process_note text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_decision_reviews_decision_id ON decision_reviews(decision_id);
CREATE INDEX IF NOT EXISTS idx_decision_reviews_reviewed_by ON decision_reviews(reviewed_by);

ALTER TABLE decision_reviews ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read; the page already scopes by portfolio.
DROP POLICY IF EXISTS "decision_reviews_select_authenticated" ON decision_reviews;
CREATE POLICY "decision_reviews_select_authenticated" ON decision_reviews
  FOR SELECT TO authenticated USING (true);

-- Authenticated users can create reviews they own.
DROP POLICY IF EXISTS "decision_reviews_insert_self" ON decision_reviews;
CREATE POLICY "decision_reviews_insert_self" ON decision_reviews
  FOR INSERT TO authenticated
  WITH CHECK (reviewed_by = auth.uid());

-- Authenticated users can update reviews they own.
DROP POLICY IF EXISTS "decision_reviews_update_self" ON decision_reviews;
CREATE POLICY "decision_reviews_update_self" ON decision_reviews
  FOR UPDATE TO authenticated
  USING (reviewed_by = auth.uid())
  WITH CHECK (reviewed_by = auth.uid());

-- updated_at trigger so callers don't have to think about it.
CREATE OR REPLACE FUNCTION decision_reviews_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS decision_reviews_updated_at ON decision_reviews;
CREATE TRIGGER decision_reviews_updated_at
BEFORE UPDATE ON decision_reviews
FOR EACH ROW EXECUTE FUNCTION decision_reviews_set_updated_at();
