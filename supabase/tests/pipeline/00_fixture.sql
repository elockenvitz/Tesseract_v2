-- Fixture reproducing the production shape the four-stage migration must
-- survive. Deliberately built from the VERIFIED production catalog, not from
-- the repo's migrations — the repo has no CREATE TABLE for trade_queue_items
-- and no CREATE TYPE for trade_stage. Those objects were applied outside the
-- migration ledger, which is the whole reason this migration needed a
-- production preflight before it could be written.
--
-- Reproduced faithfully:
--   * all ELEVEN trade_stage enum labels, in production declaration order
--   * stage NOT NULL with NO default
--   * idx_trade_queue_items_stage
--   * one row per stage value that production actually holds (8 of the 11)
--   * a seeder function carrying hardcoded stage literals and a ::trade_stage
--     cast, to exercise step 5 of the migration

BEGIN;

CREATE TYPE public.trade_stage AS ENUM (
  'idea', 'discussing', 'simulating', 'deciding', 'working_on', 'modeling',
  'aware', 'investigate', 'deep_research', 'thesis_forming', 'ready_for_decision'
);

CREATE TYPE public.trade_queue_status AS ENUM (
  'idea', 'discussing', 'approved', 'rejected', 'executed', 'cancelled',
  'deleted', 'deciding', 'simulating', 'archived'
);

CREATE TYPE public.trade_outcome AS ENUM ('executed', 'rejected', 'deferred', 'accepted');

CREATE TABLE public.trade_queue_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id    uuid,
  asset_id        uuid NOT NULL,
  status          public.trade_queue_status NOT NULL DEFAULT 'idea',
  rationale       text DEFAULT '',
  thesis_text     text,
  created_by      uuid,
  assigned_to     uuid,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  -- The two details that matter most: NOT NULL, and no default.
  stage           public.trade_stage NOT NULL,
  outcome         public.trade_outcome,
  outcome_at      timestamptz,
  stage_changed_at timestamptz DEFAULT now(),
  organization_id uuid
);

CREATE INDEX idx_trade_queue_items_stage ON public.trade_queue_items (stage);

-- The SECOND column on the `trade_stage` enum, and the one the original
-- single-shot migration never mentioned. Production has 37 rows here, all
-- legacy (idea 21, deciding 8, working_on 6, modeling 2). Retyping only
-- trade_queue_items would have left this behind on the old enum — a split
-- model, and a `trade_stage` that could never be dropped.
CREATE TABLE public.trade_idea_portfolios (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_queue_item_id uuid NOT NULL REFERENCES public.trade_queue_items(id) ON DELETE CASCADE,
  portfolio_id        uuid NOT NULL,
  stage               public.trade_stage NOT NULL,
  decision_outcome    text,
  decided_by          uuid,
  decided_at          timestamptz,
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX idx_tip_stage ON public.trade_idea_portfolios (stage);

CREATE TABLE public.decision_requests (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_queue_item_id  uuid NOT NULL REFERENCES public.trade_queue_items(id) ON DELETE CASCADE,
  requested_by         uuid NOT NULL,
  portfolio_id         uuid NOT NULL,
  status               text NOT NULL DEFAULT 'pending',
  created_at           timestamptz DEFAULT now(),
  CONSTRAINT decision_requests_status_check CHECK (status = ANY (ARRAY[
    'pending', 'under_review', 'needs_discussion', 'accepted',
    'accepted_with_modification', 'rejected', 'deferred', 'withdrawn'
  ]))
);

-- Row counts mirror production proportions closely enough to be recognisable,
-- at 1/10th scale. Only the DISTRIBUTION across stages matters.
INSERT INTO public.trade_queue_items (asset_id, stage, status, rationale, thesis_text, outcome) VALUES
  -- ready_for_decision (56 in prod): gated fields present
  (gen_random_uuid(), 'ready_for_decision', 'executed', 'Why now', 'Thesis', 'executed'),
  (gen_random_uuid(), 'ready_for_decision', 'idea',     'Why now', 'Thesis', NULL),
  (gen_random_uuid(), 'ready_for_decision', 'deciding', 'Why now', 'Thesis', NULL),
  -- idea (42 in prod) — v1 vocabulary, never migrated
  (gen_random_uuid(), 'idea', 'idea',    '', NULL, NULL),
  (gen_random_uuid(), 'idea', 'deleted', '', NULL, NULL),
  -- investigate (28) — the contested mapping
  (gen_random_uuid(), 'investigate', 'idea',       'Screening note', NULL, NULL),
  (gen_random_uuid(), 'investigate', 'discussing', '', NULL, NULL),
  -- aware (27)
  (gen_random_uuid(), 'aware', 'idea', '', NULL, NULL),
  -- deciding (23) — the stage being retired
  (gen_random_uuid(), 'deciding', 'approved',  'Why now', 'Thesis', 'executed'),
  (gen_random_uuid(), 'deciding', 'executed',  'Why now', 'Thesis', 'executed'),
  (gen_random_uuid(), 'deciding', 'deciding',  'Why now', 'Thesis', NULL),
  (gen_random_uuid(), 'deciding', 'rejected',  'Why now', 'Thesis', 'rejected'),
  (gen_random_uuid(), 'deciding', 'cancelled', 'Why now', 'Thesis', NULL),
  -- deep_research (23), thesis_forming (23), simulating (6)
  (gen_random_uuid(), 'deep_research',  'idea',       'Why now', NULL,     NULL),
  (gen_random_uuid(), 'thesis_forming', 'simulating', 'Why now', 'Thesis', NULL),
  (gen_random_uuid(), 'simulating',     'deleted',    '',        NULL,     NULL);

-- Portfolio tracks, mirroring the production distribution: all legacy, and
-- including `deciding`, which is also a trade_queue_status label.
INSERT INTO public.trade_idea_portfolios (trade_queue_item_id, portfolio_id, stage)
SELECT t.id, gen_random_uuid(), v.stage::public.trade_stage
  FROM (VALUES ('idea'), ('deciding'), ('working_on'), ('modeling')) AS v(stage)
  CROSS JOIN LATERAL (
    SELECT id FROM public.trade_queue_items ORDER BY id LIMIT 1
  ) t;

-- Only SOME deciding rows have a decision_requests row — in production 10 of
-- 23. The rest have no recommendation record at all, which is precisely why
-- the migration preserves stage_migrated_from rather than inferring one.
INSERT INTO public.decision_requests (trade_queue_item_id, requested_by, portfolio_id, status)
SELECT t.id, gen_random_uuid(), gen_random_uuid(), 'pending'
  FROM public.trade_queue_items t
 WHERE t.stage = 'deciding' AND t.status IN ('deciding', 'approved');

-- A seeder with hardcoded stage literals AND an explicit cast, standing in for
-- seed_pilot_pipeline_demo_ideas / ensure_pilot_scenario_for_user /
-- stage_pilot_scenario. SECURITY DEFINER with a pinned search_path so the test
-- also proves the rewrite preserves both.
CREATE FUNCTION public.seed_demo_ideas(p_org uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_n integer;
BEGIN
  INSERT INTO public.trade_queue_items (asset_id, stage, status, organization_id)
  VALUES
    (gen_random_uuid(), 'aware'::trade_stage, 'idea', p_org),
    (gen_random_uuid(), 'investigate'::trade_stage, 'idea', p_org),
    (gen_random_uuid(), 'deep_research'::trade_stage, 'simulating', p_org),
    (gen_random_uuid(), 'ready_for_decision', 'deciding', p_org);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;

COMMIT;
