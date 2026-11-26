-- =============================================================================
-- The pilot seed must never create a decision request with no frozen version
--
-- WHAT THIS PINS
--
--   `ensure_pilot_decision_request_for_user` is the only writer of
--   `decision_requests` that does not go through `submitRecommendation`, and
--   before 20261120010000 it left `proposal_version_id` NULL. An ungraduated
--   pilot cannot act on that row (`isPilotExampleRequest` marks it an example),
--   but graduation removes that guard and turns it into a live decision whose
--   reasoning was never frozen.
--
-- WHY THIS FILE BUILDS ITS OWN TABLES
--
--   `scripts/sql/isolated/00-harness.sql` does not carry the pilot_scenarios /
--   trade_proposals / trade_proposal_versions graph, and its README is explicit
--   that a subset drifts. The five tables this function touches are small
--   enough to declare here, so the test depends on no harness and cannot pass
--   because something was missing. Run it on any throwaway PostgreSQL 17:
--
--     psql "$URL" -v ON_ERROR_STOP=1 -f supabase/tests/pilot-seed-freezes-reasoning.sql
--
--   Expected: 6/6 PASS, then the non-vacuity block reports the OLD function
--   FAILING assertions 1 and 2. A run where the old function passes them means
--   the test has stopped watching the defect.
--
--   This is behaviour, not source text: each assertion calls the function and
--   reads the rows it wrote.
-- =============================================================================

\set ON_ERROR_STOP on
BEGIN;

CREATE SCHEMA IF NOT EXISTS auth;

-- The seed takes identity from auth.uid() and ignores its argument. Here it is
-- a settable stub so a test can act as a specific user -- and so assertion 6
-- can act as somebody else.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('test.actor', TRUE), '')::uuid
$$;

CREATE TABLE portfolios (
  id uuid PRIMARY KEY,
  organization_id uuid
);

CREATE TABLE trade_queue_items (
  id uuid PRIMARY KEY,
  asset_id uuid,
  stage text,
  action text,
  organization_id uuid
);

CREATE TABLE pilot_scenarios (
  id uuid PRIMARY KEY,
  user_id uuid,
  portfolio_id uuid,
  trade_queue_item_id uuid,
  status text,
  is_template boolean DEFAULT FALSE,
  why_now text,
  target_weight_pct numeric,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE trade_proposals (
  id uuid PRIMARY KEY,
  trade_queue_item_id uuid,
  sizing_context jsonb,
  is_active boolean DEFAULT TRUE,
  created_at timestamptz DEFAULT now()
);

-- Column list and nullability copied from production 2026-11-20. proposal_id
-- NOT NULL is the constraint the "no proposal means no request" branch exists
-- for, so it must be reproduced exactly.
CREATE TABLE trade_proposal_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL,
  version_number integer NOT NULL DEFAULT 1,
  weight numeric,
  sizing_mode text,
  sizing_context jsonb DEFAULT '{}'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  portfolio_id uuid,
  organization_id uuid,
  trade_queue_item_id uuid,
  asset_id uuid,
  submitted_at timestamptz,
  action text,
  idea_stage text,
  captured_from jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (proposal_id, version_number)
);

CREATE TABLE decision_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_queue_item_id uuid,
  requested_by uuid,
  portfolio_id uuid,
  urgency text,
  context_note text,
  status text,
  requested_action text,
  sizing_weight numeric,
  sizing_mode text,
  proposal_id uuid,
  proposal_version_id uuid REFERENCES trade_proposal_versions(id),
  submission_snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── fixture ────────────────────────────────────────────────────────────────
\set ORG       '''11111111-1111-1111-1111-111111111111'''
\set PORTFOLIO '''22222222-2222-2222-2222-222222222222'''
\set TQI       '''33333333-3333-3333-3333-333333333333'''
\set ASSET     '''44444444-4444-4444-4444-444444444444'''
\set PROPOSAL  '''55555555-5555-5555-5555-555555555555'''
\set SCENARIO  '''66666666-6666-6666-6666-666666666666'''
\set PILOT     '''77777777-7777-7777-7777-777777777777'''
\set STRANGER  '''88888888-8888-8888-8888-888888888888'''
-- A second scenario with no active proposal, for assertion 5.
\set TQI2      '''99999999-9999-9999-9999-999999999999'''
\set SCENARIO2 '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''

INSERT INTO portfolios VALUES (:PORTFOLIO, :ORG);
INSERT INTO trade_queue_items VALUES (:TQI, :ASSET, 'ready_for_decision', 'buy', :ORG);
INSERT INTO trade_queue_items VALUES (:TQI2, :ASSET, 'thesis_forming', 'buy', :ORG);
INSERT INTO trade_proposals VALUES (
  :PROPOSAL, :TQI, '{"current_weight_pct": 1.5}'::jsonb, TRUE, now()
);
INSERT INTO pilot_scenarios (id, user_id, portfolio_id, trade_queue_item_id,
                             status, is_template, why_now, target_weight_pct)
VALUES (:SCENARIO, :PILOT, :PORTFOLIO, :TQI, 'active', FALSE,
        'Seeded pilot rationale that must survive as evidence.', 3.5);

-- ── the function under test ────────────────────────────────────────────────
\ir ../migrations/20261120010000_pilot_seed_freezes_reasoning.sql

-- ── assertions ─────────────────────────────────────────────────────────────
SET LOCAL test.actor = '77777777-7777-7777-7777-777777777777';

DO $$
DECLARE
  v_request_id uuid;
  v_version_id uuid;
  v_requests int;
  v_versions int;
  v_notes text;
  v_weight numeric;
  v_org uuid;
  v_second uuid;
  v_pass int := 0;
  v_fail int := 0;
BEGIN
  v_request_id := public.ensure_pilot_decision_request_for_user();

  -- 1. The seed links its request to a frozen version. THE DEFECT.
  SELECT proposal_version_id INTO v_version_id
  FROM decision_requests WHERE id = v_request_id;
  IF v_version_id IS NOT NULL THEN
    RAISE NOTICE 'PASS 1  seeded request is linked to a frozen version';
    v_pass := v_pass + 1;
  ELSE
    RAISE WARNING 'FAIL 1  seeded request has proposal_version_id NULL';
    v_fail := v_fail + 1;
  END IF;

  -- 2. That version actually exists and carries the scenario's own reasoning,
  --    not a placeholder. A link to an empty row would satisfy 1 alone.
  SELECT notes, weight, organization_id INTO v_notes, v_weight, v_org
  FROM trade_proposal_versions WHERE id = v_version_id;
  IF v_notes = 'Seeded pilot rationale that must survive as evidence.'
     AND v_weight = 3.5 THEN
    RAISE NOTICE 'PASS 2  the version holds the scenario rationale and weight';
    v_pass := v_pass + 1;
  ELSE
    RAISE WARNING 'FAIL 2  version notes/weight wrong: % / %', v_notes, v_weight;
    v_fail := v_fail + 1;
  END IF;

  -- 3. Ownership is derived from the portfolio, so the version is tenant-scoped.
  IF v_org = '11111111-1111-1111-1111-111111111111'::uuid THEN
    RAISE NOTICE 'PASS 3  version carries the portfolio''s organization_id';
    v_pass := v_pass + 1;
  ELSE
    RAISE WARNING 'FAIL 3  version organization_id is %', v_org;
    v_fail := v_fail + 1;
  END IF;

  -- 4. Idempotent: re-running the seed adds neither a request nor a version.
  v_second := public.ensure_pilot_decision_request_for_user();
  SELECT count(*) INTO v_requests FROM decision_requests;
  SELECT count(*) INTO v_versions FROM trade_proposal_versions;
  IF v_second = v_request_id AND v_requests = 1 AND v_versions = 1 THEN
    RAISE NOTICE 'PASS 4  re-running the seed creates no second request or version';
    v_pass := v_pass + 1;
  ELSE
    RAISE WARNING 'FAIL 4  re-run produced % requests / % versions', v_requests, v_versions;
    v_fail := v_fail + 1;
  END IF;

  -- 5. No proposal to freeze against means NO decision request at all, rather
  --    than an unversioned one. This is the partial-record guard.
  INSERT INTO pilot_scenarios (id, user_id, portfolio_id, trade_queue_item_id,
                               status, is_template, why_now, target_weight_pct,
                               created_at)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
          '77777777-7777-7777-7777-777777777777'::uuid,
          '22222222-2222-2222-2222-222222222222'::uuid,
          '99999999-9999-9999-9999-999999999999'::uuid,
          'active', FALSE, 'No proposal exists for this one.', 2.0,
          now() + interval '1 minute');
  v_second := public.ensure_pilot_decision_request_for_user();
  SELECT count(*) INTO v_requests
  FROM decision_requests
  WHERE trade_queue_item_id = '99999999-9999-9999-9999-999999999999'::uuid;
  IF v_second IS NULL AND v_requests = 0 THEN
    RAISE NOTICE 'PASS 5  no proposal seeds nothing, not an unversioned request';
    v_pass := v_pass + 1;
  ELSE
    RAISE WARNING 'FAIL 5  seeded % request(s) with no proposal to freeze', v_requests;
    v_fail := v_fail + 1;
  END IF;

  -- 6. Identity still comes from auth.uid(), never the argument. Passing the
  --    pilot's id while acting as a stranger must not seed the pilot's row.
  PERFORM set_config('test.actor', '88888888-8888-8888-8888-888888888888', TRUE);
  v_second := public.ensure_pilot_decision_request_for_user(
    '77777777-7777-7777-7777-777777777777'::uuid
  );
  IF v_second IS NULL THEN
    RAISE NOTICE 'PASS 6  the p_user_id argument cannot seed another user''s request';
    v_pass := v_pass + 1;
  ELSE
    RAISE WARNING 'FAIL 6  argument overrode auth.uid(), returned %', v_second;
    v_fail := v_fail + 1;
  END IF;
  PERFORM set_config('test.actor', '77777777-7777-7777-7777-777777777777', TRUE);

  RAISE NOTICE '--- % of 6 passed, % failed ---', v_pass, v_fail;
  IF v_fail > 0 THEN
    RAISE EXCEPTION 'pilot seed regression: % assertion(s) failed', v_fail;
  END IF;
END $$;

-- =============================================================================
-- NON-VACUITY: the OLD function must fail assertions 1 and 2
--
-- A gate that cannot observe its own failure mode is decoration. This restores
-- the pre-migration body and re-runs the two assertions that pin the defect.
-- If this block does NOT report both as failing, the test above has stopped
-- watching anything.
-- =============================================================================
DELETE FROM decision_requests;
DELETE FROM trade_proposal_versions;

CREATE OR REPLACE FUNCTION public.ensure_pilot_decision_request_for_user(
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_scenario RECORD;
  v_new_id UUID;
  v_proposal_id UUID;
  v_proposal_sizing JSONB;
  v_actor UUID;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN RETURN NULL; END IF;
  SELECT ps.*, tqi.action AS tqi_action INTO v_scenario
  FROM public.pilot_scenarios ps
  JOIN public.trade_queue_items tqi ON tqi.id = ps.trade_queue_item_id
  WHERE ps.user_id = v_actor AND ps.status = 'active' AND ps.is_template = FALSE
    AND ps.trade_queue_item_id IS NOT NULL AND ps.portfolio_id IS NOT NULL
  ORDER BY ps.created_at DESC LIMIT 1;
  IF v_scenario.id IS NULL THEN RETURN NULL; END IF;
  SELECT id, sizing_context INTO v_proposal_id, v_proposal_sizing
  FROM public.trade_proposals
  WHERE trade_queue_item_id = v_scenario.trade_queue_item_id AND is_active = TRUE
  ORDER BY created_at DESC LIMIT 1;
  INSERT INTO public.decision_requests (
    trade_queue_item_id, requested_by, portfolio_id, urgency, context_note,
    status, requested_action, sizing_weight, sizing_mode, proposal_id,
    submission_snapshot
  ) VALUES (
    v_scenario.trade_queue_item_id, v_actor, v_scenario.portfolio_id, 'medium',
    COALESCE(v_scenario.why_now, 'Pilot scenario recommendation.'), 'pending',
    COALESCE(v_scenario.tqi_action::TEXT, 'buy'), v_scenario.target_weight_pct,
    'weight', v_proposal_id,
    jsonb_build_object('pilot_seed', TRUE)
  ) RETURNING id INTO v_new_id;
  RETURN v_new_id;
END;
$function$;

DO $$
DECLARE
  v_request_id uuid;
  v_version_id uuid;
  v_versions int;
  v_caught int := 0;
BEGIN
  v_request_id := public.ensure_pilot_decision_request_for_user();

  SELECT proposal_version_id INTO v_version_id
  FROM decision_requests WHERE id = v_request_id;
  IF v_version_id IS NULL THEN
    RAISE NOTICE 'NON-VACUITY 1  old function FAILS: proposal_version_id is NULL';
    v_caught := v_caught + 1;
  END IF;

  SELECT count(*) INTO v_versions FROM trade_proposal_versions;
  IF v_versions = 0 THEN
    RAISE NOTICE 'NON-VACUITY 2  old function FAILS: it froze no reasoning at all';
    v_caught := v_caught + 1;
  END IF;

  IF v_caught = 2 THEN
    RAISE NOTICE '--- non-vacuity proven: the old function fails 2/2 ---';
  ELSE
    RAISE EXCEPTION
      'NON-VACUITY BROKEN: the pre-migration function passed these assertions (caught %/2). The test is no longer watching the defect.',
      v_caught;
  END IF;
END $$;

ROLLBACK;
