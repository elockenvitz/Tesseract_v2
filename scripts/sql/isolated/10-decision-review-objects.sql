-- =============================================================================
-- Isolated harness, part 2: the objects `decision_reviews` needs.
--
-- Loaded by `00-harness.sql` (its last line is `\ir 10-decision-review-objects.sql`),
-- so the harness is still one file to run. Split out because the existing
-- harness serves the contribution/audience suites and this block serves
-- `supabase/tests/decision-review-typed-subject.sql`; keeping them apart keeps
-- each reviewable.
--
-- ── Provenance ─────────────────────────────────────────────────────────────
--
-- Every column, type, constraint, default, trigger, policy and grant below was
-- read out of production (`wfcebeagznzgeuyysbnt`, PostgreSQL 17.4) through a
-- READ-ONLY connection on 2026-11-16, using format_type / pg_get_expr /
-- pg_get_constraintdef / pg_get_functiondef / pg_get_triggerdef / pg_policy /
-- has_table_privilege. Nothing here was invented, and nothing was written to
-- production to obtain it. The local cluster is PostgreSQL 17.11 — same major
-- version, so catalog semantics and operator resolution match.
--
-- ── Where this is deliberately a subset, and why none of it can fake a pass ──
--
-- The README's warning governs: a failing assertion here is always worth
-- believing; a passing one is only as good as the harness's fidelity on the
-- objects that assertion touches. So the gaps are listed, not buried:
--
--  1. FOREIGN KEYS TO TABLES OUTSIDE THE HARNESS ARE OMITTED:
--     decision_requests.accepted_trade_id -> accepted_trades
--     decision_requests.proposal_id -> trade_proposals
--     decision_requests.proposal_version_id -> trade_proposal_versions
--     portfolio_trade_events.linked_trade_sheet_id -> trade_sheets
--     portfolios.team_id -> teams
--     trade_queue_items.pair_trade_id -> pair_trades
--     All six columns are nullable and the suite never sets any of them, so
--     the constraints could not fire. The COLUMNS are kept so the row shape
--     still matches production.
--
--  2. `notify_decision_request_resolved` and its AFTER UPDATE trigger on
--     decision_requests are omitted: the function writes to `notifications`,
--     which is not in the harness, and the suite never UPDATEs
--     decision_requests, so the trigger cannot fire. Named here so a future
--     suite that does update that table knows to add it.
--
--  3. RLS is ENABLED on all six tables, matching production, but only
--     `decision_reviews` carries its policies. The other five are therefore
--     RLS-enabled-with-no-policy, which is STRICTER than production (deny-all
--     for any non-owner), never looser. This cannot make an assertion pass
--     artificially: the suite seeds those five as the table owner, which
--     bypasses RLS, and the only role-switched reads and writes in the whole
--     suite are against `decision_reviews`. The resolver functions that DO
--     read them (`decision_review_portfolio`, `can_review_decision`) are
--     SECURITY DEFINER and so run as the owner in production too.
--
--  4. `public.assets` is inherited from 00-harness.sql, where `symbol` and
--     `company_name` are nullable; production has both NOT NULL. Left alone
--     rather than tightened, because the sibling contribution suites also
--     insert into that table. The decision-review suite supplies both columns,
--     so the difference is unreachable from it.
--
-- Read-only against production. Safe to run repeatedly.
-- =============================================================================

\set ON_ERROR_STOP on

-- ── Preconditions ──────────────────────────────────────────────────────────
-- House style: fail loudly and immediately if 00-harness.sql has not run, so
-- a missing dependency is never mistaken for a test result.
DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(x, ', ') INTO missing FROM (
    SELECT 'public.' || t AS x FROM unnest(ARRAY['organizations','users','organization_memberships','assets']) t
     WHERE to_regclass('public.' || t) IS NULL
    UNION ALL
    SELECT 'auth.users' WHERE to_regclass('auth.users') IS NULL
    UNION ALL
    SELECT 'auth.uid()' WHERE NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'auth' AND p.proname = 'uid')
  ) q;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '10-decision-review-objects.sql: 00-harness.sql has not run; missing %', missing;
  END IF;
END $$;

-- ── Columns 00-harness.sql does not carry but the suite writes ─────────────
--
-- auth.users: 00-harness.sql creates it with `id` alone, because the
-- contribution suites only ever needed a row to point a foreign key at. This
-- suite inserts six columns. Shapes and nullability read from production's
-- auth.users; `is_sso_user` and `is_anonymous` are NOT NULL there with
-- defaults, so they are added too rather than being an inserted-row surprise
-- the harness cannot reproduce.
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS instance_id uuid;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS aud character varying(255);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS role character varying(255);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email character varying(255);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_user_meta_data jsonb;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS is_sso_user boolean NOT NULL DEFAULT false;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS is_anonymous boolean NOT NULL DEFAULT false;

-- Production organization_memberships has both. `role` is NOT NULL with a
-- DEFAULT, which is why the suite's INSERT (which omits it) succeeds there;
-- without the default here the suite would fail for a reason production does
-- not have.
ALTER TABLE public.organization_memberships
  ADD COLUMN IF NOT EXISTS is_org_admin boolean DEFAULT false;
ALTER TABLE public.organization_memberships
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'member'::text;

-- ── Enum types ─────────────────────────────────────────────────────────────
-- CREATE TYPE has no IF NOT EXISTS, hence the guard.
DO $$
BEGIN
  IF to_regtype('public.holdings_source_type') IS NULL THEN
    CREATE TYPE public.holdings_source_type AS ENUM ('live_feed', 'manual_eod', 'paper'); END IF;
  IF to_regtype('public.origin_entity_type') IS NULL THEN
    CREATE TYPE public.origin_entity_type AS ENUM ('asset', 'portfolio', 'trade_lab', 'view', 'trade_idea'); END IF;
  IF to_regtype('public.origin_type') IS NULL THEN
    CREATE TYPE public.origin_type AS ENUM ('asset_page', 'portfolio_page', 'trade_lab', 'search', 'dashboard', 'manual', 'counter_view'); END IF;
  IF to_regtype('public.trade_action') IS NULL THEN
    CREATE TYPE public.trade_action AS ENUM ('buy', 'sell', 'trim', 'add'); END IF;
  IF to_regtype('public.trade_event_action') IS NULL THEN
    CREATE TYPE public.trade_event_action AS ENUM ('initiate', 'add', 'trim', 'exit', 'reduce', 'cover', 'short_initiate', 'rebalance', 'hedge', 'other'); END IF;
  IF to_regtype('public.trade_event_source') IS NULL THEN
    CREATE TYPE public.trade_event_source AS ENUM ('holdings_diff', 'execution_import', 'manual', 'reconciliation'); END IF;
  IF to_regtype('public.trade_event_status') IS NULL THEN
    CREATE TYPE public.trade_event_status AS ENUM ('pending_rationale', 'draft_rationale', 'complete', 'reviewed', 'ignored'); END IF;
  IF to_regtype('public.trade_outcome') IS NULL THEN
    CREATE TYPE public.trade_outcome AS ENUM ('executed', 'rejected', 'deferred'); END IF;
  IF to_regtype('public.trade_queue_status') IS NULL THEN
    CREATE TYPE public.trade_queue_status AS ENUM ('idea', 'discussing', 'approved', 'rejected', 'executed', 'cancelled', 'deleted', 'deciding', 'simulating', 'archived'); END IF;
  IF to_regtype('public.trade_stage') IS NULL THEN
    CREATE TYPE public.trade_stage AS ENUM ('idea', 'discussing', 'simulating', 'deciding', 'working_on', 'modeling', 'aware', 'investigate', 'deep_research', 'thesis_forming', 'ready_for_decision', 'exploring', 'researching', 'developing', 'ready_to_recommend'); END IF;
  IF to_regtype('public.visibility_tier') IS NULL THEN
    CREATE TYPE public.visibility_tier AS ENUM ('active', 'trash', 'archive'); END IF;
END $$;

-- ── public.portfolios ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.portfolios (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  benchmark text DEFAULT ''::text,
  description text DEFAULT ''::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  portfolio_id character varying(10),
  team_id uuid,
  slug text,
  portfolio_type text DEFAULT 'long_short'::text,
  inception_date date,
  is_active boolean DEFAULT true,
  settings jsonb DEFAULT '{}'::jsonb,
  rounding_config jsonb NOT NULL DEFAULT '{"lot_size": 1, "round_direction": "nearest", "min_lot_behavior": "round"}'::jsonb,
  organization_id uuid,
  archived_at timestamp with time zone,
  archived_by uuid,
  status text NOT NULL DEFAULT 'active'::text,
  discarded_at timestamp with time zone,
  discarded_by uuid,
  lifecycle_reason text,
  holdings_source public.holdings_source_type NOT NULL DEFAULT 'manual_eod'::public.holdings_source_type,
  reconciliation_inactivity_days integer NOT NULL DEFAULT 5,
  CONSTRAINT portfolios_pkey PRIMARY KEY (id),
  CONSTRAINT portfolios_portfolio_id_key UNIQUE (portfolio_id),
  CONSTRAINT chk_portfolio_status CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text, 'discarded'::text]))),
  CONSTRAINT portfolios_reconciliation_inactivity_days_check CHECK ((reconciliation_inactivity_days > 0)),
  CONSTRAINT portfolios_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
  CONSTRAINT portfolios_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES public.users(id),
  CONSTRAINT portfolios_discarded_by_fkey FOREIGN KEY (discarded_by) REFERENCES public.users(id)
);

-- ── public.trade_queue_items ───────────────────────────────────────────────
-- `stage` is NOT NULL with NO default in production; the suite supplies it.
CREATE TABLE IF NOT EXISTS public.trade_queue_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  portfolio_id uuid,
  asset_id uuid NOT NULL,
  action public.trade_action NOT NULL DEFAULT 'buy'::public.trade_action,
  proposed_shares numeric,
  proposed_weight numeric,
  target_price numeric,
  urgency text DEFAULT 'medium'::text,
  status public.trade_queue_status NOT NULL DEFAULT 'idea'::public.trade_queue_status,
  priority integer DEFAULT 0,
  rationale text DEFAULT ''::text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  approved_by uuid,
  approved_at timestamp with time zone,
  executed_at timestamp with time zone,
  pair_trade_id uuid,
  pair_leg_type text,
  pair_id uuid,
  sharing_visibility text DEFAULT 'private'::text,
  expires_at timestamp with time zone,
  revisit_at timestamp with time zone,
  alert_at timestamp with time zone,
  deleted_at timestamp with time zone,
  deleted_by uuid,
  previous_state jsonb,
  stage public.trade_stage NOT NULL,
  outcome public.trade_outcome,
  outcome_at timestamp with time zone,
  outcome_by uuid,
  outcome_note text,
  visibility_tier public.visibility_tier NOT NULL DEFAULT 'active'::public.visibility_tier,
  archived_at timestamp with time zone,
  origin_type public.origin_type NOT NULL DEFAULT 'manual'::public.origin_type,
  origin_entity_type public.origin_entity_type,
  origin_entity_id uuid,
  origin_route text,
  origin_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  context_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  stop_loss numeric,
  take_profit numeric,
  conviction text,
  time_horizon text,
  assigned_to uuid,
  decision_outcome text,
  decision_reason text,
  decided_by uuid,
  decided_at timestamp with time zone,
  deferred_until timestamp with time zone,
  collaborators jsonb DEFAULT '[]'::jsonb,
  research_depth smallint,
  catalyst_clarity smallint,
  stage_changed_at timestamp with time zone DEFAULT now(),
  thesis_text text,
  organization_id uuid,
  stage_migrated_from text,
  CONSTRAINT trade_queue_items_pkey PRIMARY KEY (id),
  CONSTRAINT trade_queue_items_catalyst_clarity_check CHECK (((catalyst_clarity >= 1) AND (catalyst_clarity <= 5))),
  CONSTRAINT trade_queue_items_conviction_check CHECK ((conviction = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]))),
  CONSTRAINT trade_queue_items_decision_outcome_check CHECK ((decision_outcome = ANY (ARRAY['accepted'::text, 'deferred'::text, 'rejected'::text]))),
  CONSTRAINT trade_queue_items_pair_leg_type_check CHECK ((pair_leg_type = ANY (ARRAY['long'::text, 'short'::text, NULL::text]))),
  CONSTRAINT trade_queue_items_research_depth_check CHECK (((research_depth >= 1) AND (research_depth <= 5))),
  CONSTRAINT trade_queue_items_time_horizon_check CHECK ((time_horizon = ANY (ARRAY['short'::text, 'medium'::text, 'long'::text]))),
  CONSTRAINT trade_queue_items_urgency_check CHECK ((urgency = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'urgent'::text]))),
  CONSTRAINT trade_queue_items_visibility_check CHECK ((sharing_visibility = ANY (ARRAY['private'::text, 'team'::text, 'public'::text]))),
  CONSTRAINT valid_outcome_at_final_stage CHECK (((outcome IS NULL) OR (stage = 'ready_to_recommend'::public.trade_stage) OR (stage = 'deciding'::public.trade_stage))),
  CONSTRAINT valid_visibility_tier CHECK ((((visibility_tier = 'active'::public.visibility_tier) AND (deleted_at IS NULL) AND (archived_at IS NULL)) OR ((visibility_tier = 'trash'::public.visibility_tier) AND (deleted_at IS NOT NULL) AND (archived_at IS NULL)) OR ((visibility_tier = 'archive'::public.visibility_tier) AND (archived_at IS NOT NULL)))),
  CONSTRAINT trade_queue_items_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE CASCADE,
  CONSTRAINT trade_queue_items_portfolio_id_fkey FOREIGN KEY (portfolio_id) REFERENCES public.portfolios(id) ON DELETE CASCADE,
  CONSTRAINT trade_queue_items_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL,
  CONSTRAINT trade_queue_items_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id),
  CONSTRAINT trade_queue_items_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id),
  CONSTRAINT trade_queue_items_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT trade_queue_items_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.users(id),
  CONSTRAINT trade_queue_items_outcome_by_fkey FOREIGN KEY (outcome_by) REFERENCES public.users(id),
  CONSTRAINT trade_queue_items_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES auth.users(id)
);

-- ── public.decision_requests ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.decision_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  trade_queue_item_id uuid NOT NULL,
  requested_by uuid NOT NULL,
  portfolio_id uuid NOT NULL,
  urgency text NOT NULL DEFAULT 'medium'::text,
  context_note text,
  status text NOT NULL DEFAULT 'pending'::text,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  decision_note text,
  deferred_until timestamp with time zone,
  sizing_weight numeric,
  sizing_shares numeric,
  sizing_mode text,
  proposal_id uuid,
  submission_snapshot jsonb,
  requested_action text,
  deferred_trigger jsonb,
  accepted_trade_id uuid,
  proposal_version_id uuid,
  CONSTRAINT decision_requests_pkey PRIMARY KEY (id),
  CONSTRAINT decision_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'under_review'::text, 'needs_discussion'::text, 'accepted'::text, 'accepted_with_modification'::text, 'rejected'::text, 'deferred'::text, 'withdrawn'::text]))),
  CONSTRAINT decision_requests_urgency_check CHECK ((urgency = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]))),
  CONSTRAINT decision_requests_trade_queue_item_id_fkey FOREIGN KEY (trade_queue_item_id) REFERENCES public.trade_queue_items(id) ON DELETE CASCADE,
  CONSTRAINT decision_requests_portfolio_id_fkey FOREIGN KEY (portfolio_id) REFERENCES public.portfolios(id) ON DELETE CASCADE,
  CONSTRAINT decision_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id),
  CONSTRAINT decision_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id)
);

-- ── public.portfolio_trade_events ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.portfolio_trade_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  portfolio_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  source_type public.trade_event_source NOT NULL DEFAULT 'manual'::public.trade_event_source,
  action_type public.trade_event_action NOT NULL DEFAULT 'other'::public.trade_event_action,
  detected_by_system boolean NOT NULL DEFAULT false,
  event_date date NOT NULL DEFAULT CURRENT_DATE,
  detected_at timestamp with time zone NOT NULL DEFAULT now(),
  quantity_before numeric,
  quantity_after numeric,
  quantity_delta numeric,
  weight_before numeric,
  weight_after numeric,
  weight_delta numeric,
  market_value_before numeric,
  market_value_after numeric,
  status public.trade_event_status NOT NULL DEFAULT 'pending_rationale'::public.trade_event_status,
  linked_trade_idea_id uuid,
  linked_proposal_id uuid,
  linked_decision_id uuid,
  linked_trade_sheet_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT portfolio_trade_events_pkey PRIMARY KEY (id),
  CONSTRAINT portfolio_trade_events_portfolio_id_fkey FOREIGN KEY (portfolio_id) REFERENCES public.portfolios(id) ON DELETE CASCADE,
  CONSTRAINT portfolio_trade_events_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE CASCADE,
  CONSTRAINT portfolio_trade_events_linked_trade_idea_id_fkey FOREIGN KEY (linked_trade_idea_id) REFERENCES public.trade_queue_items(id) ON DELETE SET NULL,
  CONSTRAINT portfolio_trade_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT portfolio_trade_events_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

-- ── public.decision_reviews ────────────────────────────────────────────────
-- The table under test. Pre-migration shape: 11 columns, no subject_type and
-- no typed foreign keys. UNIQUE (decision_id) is assertion 12's subject and
-- the client's upsert conflict key.
CREATE TABLE IF NOT EXISTS public.decision_reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  decision_id text NOT NULL,
  decision_quality text,
  thesis_played_out text,
  sizing_quality text,
  process_note text,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  organization_id uuid,
  CONSTRAINT decision_reviews_pkey PRIMARY KEY (id),
  CONSTRAINT decision_reviews_decision_id_key UNIQUE (decision_id),
  CONSTRAINT decision_reviews_decision_quality_check CHECK ((decision_quality = ANY (ARRAY['good'::text, 'mixed'::text, 'bad'::text, 'unrated'::text]))),
  CONSTRAINT decision_reviews_sizing_quality_check CHECK ((sizing_quality = ANY (ARRAY['too_small'::text, 'appropriate'::text, 'too_large'::text, 'unknown'::text]))),
  CONSTRAINT decision_reviews_thesis_played_out_check CHECK ((thesis_played_out = ANY (ARRAY['yes'::text, 'partial'::text, 'no'::text, 'unknown'::text]))),
  CONSTRAINT decision_reviews_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id),
  CONSTRAINT decision_reviews_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

-- ── public.organization_audit_log ──────────────────────────────────────────
-- The suite only DELETEs from it during cleanup, but it must exist for that.
CREATE TABLE IF NOT EXISTS public.organization_audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  actor_id uuid,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  entity_type text,
  action_type text,
  target_user_id uuid,
  source_type text NOT NULL DEFAULT 'direct'::text,
  source_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  initiator_user_id uuid,
  CONSTRAINT organization_audit_log_pkey PRIMARY KEY (id),
  CONSTRAINT chk_audit_source_type CHECK ((source_type = ANY (ARRAY['direct'::text, 'via_team'::text, 'system'::text]))),
  CONSTRAINT organization_audit_log_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
  CONSTRAINT organization_audit_log_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES auth.users(id)
);

-- ── public.memory_events ───────────────────────────────────────────────────
-- Not needed by the decision-review suite. Present because
-- `20261116020000_memory_events_recommendation_withdrawn.sql` (M3) replaces
-- `memory_events_type_ck` on this table, and M3 cannot be rehearsed without
-- it. The CHECK below is the NINE-value enumeration as production holds it
-- today, i.e. the pre-M3 state: `recommendation.withdrawn` is deliberately
-- absent, so M3 has something real to change and a pre-state to fail from.
CREATE TABLE IF NOT EXISTS public.memory_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  actor_id uuid,
  event_type text NOT NULL,
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  related jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_type text,
  source_id uuid,
  source_field text,
  provenance text NOT NULL,
  occurred_at timestamp with time zone NOT NULL DEFAULT now(),
  recorded_at timestamp with time zone NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text,
  CONSTRAINT memory_events_pkey PRIMARY KEY (id),
  CONSTRAINT memory_events_source_ck CHECK ((((source_type IS NULL) AND (source_id IS NULL)) OR ((source_type IS NOT NULL) AND (source_id IS NOT NULL)))),
  CONSTRAINT memory_events_subject_ck CHECK ((subject_type = ANY (ARRAY['asset'::text, 'idea'::text, 'decision'::text, 'trade'::text, 'batch'::text, 'portfolio'::text, 'obligation'::text]))),
  CONSTRAINT memory_events_type_ck CHECK ((event_type = ANY (ARRAY['thesis.reviewed'::text, 'decision.reviewed'::text, 'obligation.raised'::text, 'obligation.cleared'::text, 'rationale.captured'::text, 'recommendation.submitted'::text, 'decision.recorded'::text, 'decision.reverted'::text, 'execution.recorded'::text]))),
  CONSTRAINT memory_events_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
  CONSTRAINT memory_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS memory_events_dedupe_uk
  ON public.memory_events USING btree (organization_id, dedupe_key) WHERE (dedupe_key IS NOT NULL);
CREATE INDEX IF NOT EXISTS memory_events_org_time_ix
  ON public.memory_events USING btree (organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS memory_events_source_ix
  ON public.memory_events USING btree (source_type, source_id) WHERE (source_type IS NOT NULL);
CREATE INDEX IF NOT EXISTS memory_events_subject_ix
  ON public.memory_events USING btree (organization_id, subject_type, subject_id, occurred_at DESC);

-- ── Functions, verbatim from production pg_get_functiondef() ───────────────
-- The committed migrations carry these same bodies
-- (20260916180000_memory_spine_foundation.sql for is_member_of_org,
-- 20261009120000_decision_reviews_tenant_isolation.sql for the other three);
-- production was used as the authority so the harness cannot be fresher or
-- staler than the database the migration will actually meet.

CREATE OR REPLACE FUNCTION public.is_member_of_org(p_org_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from organization_memberships m
     where m.organization_id = p_org_id
       and m.user_id = auth.uid()
       and coalesce(m.status, 'active') = 'active'
  );
$function$;

CREATE OR REPLACE FUNCTION public.decision_review_portfolio(p_decision_id text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH candidates AS (
    SELECT t.portfolio_id
      FROM public.trade_queue_items t
     WHERE t.id::text = p_decision_id
       AND t.portfolio_id IS NOT NULL
    UNION
    SELECT d.portfolio_id
      FROM public.decision_requests d
     WHERE d.id::text = p_decision_id
       AND d.portfolio_id IS NOT NULL
    UNION
    SELECT e.portfolio_id
      FROM public.portfolio_trade_events e
     WHERE e.id::text = p_decision_id
       AND e.portfolio_id IS NOT NULL
  )
  -- UNION (not UNION ALL) already collapses the same owner seen twice, so
  -- this returns a portfolio only when exactly one distinct owner exists.
  SELECT CASE WHEN count(*) = 1 THEN (array_agg(portfolio_id))[1] END
    FROM candidates;
$function$;

CREATE OR REPLACE FUNCTION public.can_review_decision(p_decision_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.portfolios p
     WHERE p.id = public.decision_review_portfolio(p_decision_id)
       AND p.organization_id IS NOT NULL
       AND public.is_member_of_org(p.organization_id)
  );
$function$;

CREATE OR REPLACE FUNCTION public.decision_reviews_set_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_portfolio uuid;
  v_org uuid;
BEGIN
  -- decision_id is immutable: allowing it to change would let a row migrate
  -- between organizations, because the recompute below would re-stamp it.
  IF TG_OP = 'UPDATE' AND NEW.decision_id IS DISTINCT FROM OLD.decision_id THEN
    RAISE EXCEPTION
      'decision_reviews: decision_id is immutable (% -> %)', OLD.decision_id, NEW.decision_id
      USING ERRCODE = 'check_violation';
  END IF;

  v_portfolio := public.decision_review_portfolio(NEW.decision_id);

  IF v_portfolio IS NOT NULL THEN
    SELECT p.organization_id INTO v_org
      FROM public.portfolios p WHERE p.id = v_portfolio;
  END IF;

  IF v_org IS NULL THEN
    IF TG_OP = 'INSERT' THEN
      -- Refused, not quarantined. Also covers AMBIGUITY: the resolver returns
      -- NULL when two distinct portfolios claim the id, so a colliding
      -- decision_id cannot be reviewed by anyone until it is resolved.
      RAISE EXCEPTION
        'decision_reviews: decision_id % resolves to no single owning portfolio; cannot establish ownership',
        NEW.decision_id
        USING ERRCODE = 'check_violation';
    END IF;
    -- On UPDATE, keep whatever ownership the row already had, so the repair
    -- path for quarantined rows is not bricked by this function.
    NEW.organization_id := OLD.organization_id;
    RETURN NEW;
  END IF;

  NEW.organization_id := v_org;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.decision_reviews_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_trade_queue_items_org_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller UUID := auth.uid();
BEGIN
  IF NEW.organization_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.portfolio_id IS NOT NULL THEN
    SELECT organization_id INTO NEW.organization_id
    FROM public.portfolios
    WHERE id = NEW.portfolio_id;
  END IF;

  IF NEW.organization_id IS NULL AND v_caller IS NOT NULL THEN
    SELECT current_organization_id INTO NEW.organization_id
    FROM public.users
    WHERE id = v_caller;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_trade_queue_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_stage_changed_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.stage IS DISTINCT FROM NEW.stage THEN
    NEW.stage_changed_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

-- ── Triggers, verbatim from production pg_get_triggerdef() ─────────────────
-- Of these, the two that actually fire during the suite are
-- `decision_reviews_owner` (BEFORE INSERT, the ownership trigger under test)
-- and `set_trade_queue_items_org_id_trigger` (BEFORE INSERT on the fixtures).
DROP TRIGGER IF EXISTS decision_reviews_owner ON public.decision_reviews;
CREATE TRIGGER decision_reviews_owner BEFORE INSERT OR UPDATE ON public.decision_reviews
  FOR EACH ROW EXECUTE FUNCTION public.decision_reviews_set_owner();

DROP TRIGGER IF EXISTS decision_reviews_updated_at ON public.decision_reviews;
CREATE TRIGGER decision_reviews_updated_at BEFORE UPDATE ON public.decision_reviews
  FOR EACH ROW EXECUTE FUNCTION public.decision_reviews_set_updated_at();

DROP TRIGGER IF EXISTS set_trade_queue_items_org_id_trigger ON public.trade_queue_items;
CREATE TRIGGER set_trade_queue_items_org_id_trigger BEFORE INSERT ON public.trade_queue_items
  FOR EACH ROW EXECUTE FUNCTION public.set_trade_queue_items_org_id();

DROP TRIGGER IF EXISTS trade_queue_items_updated_at ON public.trade_queue_items;
CREATE TRIGGER trade_queue_items_updated_at BEFORE UPDATE ON public.trade_queue_items
  FOR EACH ROW EXECUTE FUNCTION public.update_trade_queue_updated_at();

DROP TRIGGER IF EXISTS trg_stage_changed_at ON public.trade_queue_items;
CREATE TRIGGER trg_stage_changed_at BEFORE UPDATE ON public.trade_queue_items
  FOR EACH ROW EXECUTE FUNCTION public.update_stage_changed_at();

DROP TRIGGER IF EXISTS update_portfolios_updated_at ON public.portfolios;
CREATE TRIGGER update_portfolios_updated_at BEFORE UPDATE ON public.portfolios
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.portfolios             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_queue_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decision_requests      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio_trade_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decision_reviews       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_events          ENABLE ROW LEVEL SECURITY;

-- memory_events policies, verbatim. `anon` holds no grant on this table and
-- gets no policy -- the posture M2 is trying to restore on the trade-event
-- rationale tables.
DROP POLICY IF EXISTS memory_events_select ON public.memory_events;
CREATE POLICY memory_events_select ON public.memory_events
  FOR SELECT TO authenticated
  USING (is_member_of_org(organization_id));

DROP POLICY IF EXISTS memory_events_insert ON public.memory_events;
CREATE POLICY memory_events_insert ON public.memory_events
  FOR INSERT TO authenticated
  WITH CHECK ((is_member_of_org(organization_id) AND (actor_id = auth.uid())));

-- decision_reviews policies, verbatim from pg_policy / pg_get_expr.
-- Three policies, all TO authenticated, and NO DELETE policy -- which is why
-- a signed-in user cannot delete a review at all.
DROP POLICY IF EXISTS decision_reviews_select ON public.decision_reviews;
CREATE POLICY decision_reviews_select ON public.decision_reviews
  FOR SELECT TO authenticated
  USING (((organization_id IS NOT NULL) AND is_member_of_org(organization_id)));

DROP POLICY IF EXISTS decision_reviews_insert ON public.decision_reviews;
CREATE POLICY decision_reviews_insert ON public.decision_reviews
  FOR INSERT TO authenticated
  WITH CHECK (((reviewed_by = auth.uid()) AND can_review_decision(decision_id)));

DROP POLICY IF EXISTS decision_reviews_update ON public.decision_reviews;
CREATE POLICY decision_reviews_update ON public.decision_reviews
  FOR UPDATE TO authenticated
  USING (((reviewed_by = auth.uid()) AND can_review_decision(decision_id) AND ((organization_id IS NULL) OR is_member_of_org(organization_id))))
  WITH CHECK (((reviewed_by = auth.uid()) AND can_review_decision(decision_id)));

-- ── Grants, exactly as production holds them ───────────────────────────────
-- decision_reviews grants `anon` NOTHING. That is load-bearing: assertion 1
-- is satisfied in production by a privilege denial (42501), not by a policy
-- predicate, and a harness that granted anon SELECT would let that assertion
-- pass for the wrong reason.
GRANT SELECT, INSERT, UPDATE ON public.decision_reviews TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.decision_reviews TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.portfolios, public.trade_queue_items, public.decision_requests,
  public.portfolio_trade_events, public.organization_audit_log
  TO anon, authenticated, service_role;

-- memory_events: `anon` gets nothing, `authenticated` gets SELECT + INSERT
-- only (no UPDATE, no DELETE -- an event is a record, not a draft).
GRANT SELECT, INSERT ON public.memory_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.memory_events TO service_role;

GRANT EXECUTE ON FUNCTION public.is_member_of_org(uuid),
  public.can_review_decision(text), public.decision_review_portfolio(text)
  TO authenticated;
