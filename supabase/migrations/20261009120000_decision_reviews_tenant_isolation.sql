-- decision_reviews — close the unconditional cross-tenant read.
--
-- ============================================================================
-- WHAT WAS WRONG
-- ============================================================================
--
-- Confirmed against live production (project wfcebeagznzgeuyysbnt), not
-- inferred from migrations:
--
--   decision_reviews_select_authenticated  SELECT  authenticated  qual="true"
--
-- That was the only SELECT policy on the table. Permissive policies OR
-- together, so one predicate of `true` was the entire read boundary: every
-- authenticated user in every one of the 28 production organizations could
-- read every row. `anon` holds the table grant but no policy names it, so
-- anonymous reads return empty — the exposure is tenant-to-tenant.
--
-- The creating migration (20260424130000) said "everyone in the org can read"
-- and "the page already filters by portfolio so a portfolio-level RLS check
-- would be redundant". Neither was true. The policy said everyone, not
-- everyone in the org, and a client-side filter is not a boundary.
--
-- A second, quieter defect on the same table:
--
--   decision_reviews_insert_self  INSERT  WITH CHECK (reviewed_by = auth.uid())
--
-- `decision_id` is unconstrained TEXT with a UNIQUE index, so a user in org A
-- could insert a row claiming any org B decision. Because UPDATE required
-- `reviewed_by = auth.uid()`, the legitimate reviewer in org B was then
-- PERMANENTLY unable to save their own review — the client upserts on
-- `decision_id` (useDecisionReview.ts:120), so the conflict resolves to an
-- UPDATE that RLS refuses. Cross-tenant denial of service, plus a false
-- verdict injected into another firm's Outcomes surface.
--
-- ============================================================================
-- WHY THE OBVIOUS FIX IS NOT ENOUGH
-- ============================================================================
--
-- Adding `organization_id` and checking `is_member_of_org(organization_id)`
-- scopes the read, but leaves the write hole open: the column would be
-- supplied by the client, so a squatter stamps their own org onto a row
-- keyed by a foreign `decision_id` and the UNIQUE index still locks the
-- rightful reviewer out.
--
-- So ownership is DERIVED SERVER-SIDE from the decision the review is about,
-- by a trigger, and whatever the client sends in `organization_id` is
-- discarded. The column then means something a policy can trust, and
-- authorization is validated against the underlying decision rather than
-- against a value the caller chose.
--
-- ============================================================================
-- WHY SOME ROWS END UP WITH NO OWNER
-- ============================================================================
--
-- `decision_id` is polymorphic: a trade_queue_items id, a decision_requests
-- id, or a portfolio_trade_events id (see the creating migration, and
-- `subjectType` in useDecisionReview.ts:102-104). Of the 7 rows in
-- production, ONE resolves to any parent at all. The other six are dangling
-- strings — corroborated independently at docs/decision-flow-audit.md:445.
--
-- Those six are PRESERVED and QUARANTINED: `organization_id` stays NULL, and
-- every policy below requires it to be non-null. A NULL-owner row is
-- therefore invisible to every tenant-facing query while remaining fully
-- intact for `service_role` and for a later, evidence-based reassignment.
-- Nothing is deleted and no owner is guessed.
--
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Ownership column. Nullable on purpose — NULL is the quarantine state.
-- ---------------------------------------------------------------------------

ALTER TABLE public.decision_reviews
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);

COMMENT ON COLUMN public.decision_reviews.organization_id IS
  'Owning organization, DERIVED from the reviewed decision by '
  'decision_reviews_set_owner(). Never accepted from the client. NULL means '
  'the decision_id resolves to no known parent: the row is quarantined and '
  'invisible to tenant-facing queries until ownership is established.';

CREATE INDEX IF NOT EXISTS idx_decision_reviews_organization_id
  ON public.decision_reviews(organization_id);

-- ---------------------------------------------------------------------------
-- 2. Resolve a polymorphic decision_id to the portfolio that owns it.
--
--    Returns NULL when the id matches no parent, or when the parent carries
--    no portfolio — `trade_queue_items.portfolio_id` is nullable by design
--    (20260529140000), so a portfolio-less idea genuinely has no owner and
--    must not be given one.
--
--    SECURITY DEFINER because it is called from policies and must see the
--    parent rows regardless of the caller's own RLS. It returns only a
--    portfolio id, never row contents.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.decision_review_portfolio(p_decision_id text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT portfolio_id FROM (
    SELECT t.portfolio_id, 1 AS rank
      FROM trade_queue_items t
     WHERE t.id::text = p_decision_id
       AND t.portfolio_id IS NOT NULL
    UNION ALL
    SELECT d.portfolio_id, 2
      FROM decision_requests d
     WHERE d.id::text = p_decision_id
       AND d.portfolio_id IS NOT NULL
    UNION ALL
    SELECT e.portfolio_id, 3
      FROM portfolio_trade_events e
     WHERE e.id::text = p_decision_id
       AND e.portfolio_id IS NOT NULL
  ) candidates
   ORDER BY rank
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.decision_review_portfolio(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.decision_review_portfolio(text)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. May the caller review this decision?
--
--    Membership of the ORGANIZATION that owns the decision's portfolio — the
--    same boundary the SELECT policy uses.
--
--    Deliberately NOT `user_is_portfolio_member`, which is the tighter and
--    more obvious choice. That helper reads `portfolio_members`
--    (20260201200000:523), a THIRD membership table alongside
--    `portfolio_team` and `portfolio_memberships`, and this product already
--    has a documented defect where a collaborator present in one is absent
--    from another. Scoping writes on the sparsest of the three risks locking
--    legitimate reviewers out of their own reviews, which is the failure this
--    remediation is explicitly required to avoid. Org membership is populated
--    and is sufficient to close the attack: the squat required writing across
--    an organization boundary.
--
--    Tightening to portfolio level is a one-line change here once
--    `portfolio_members` coverage has been measured. Noted in the rollout
--    plan rather than assumed.
--
--    An unresolvable decision is reviewable by nobody — that is what stops a
--    row being created for an id whose ownership cannot be demonstrated.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_review_decision(p_decision_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.portfolios p
     WHERE p.id = public.decision_review_portfolio(p_decision_id)
       AND p.organization_id IS NOT NULL
       AND public.is_member_of_org(p.organization_id)
  );
$$;

REVOKE ALL ON FUNCTION public.can_review_decision(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.can_review_decision(text)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Stamp ownership server-side. The client's organization_id is discarded.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.decision_reviews_set_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_portfolio uuid;
  v_org uuid;
BEGIN
  v_portfolio := public.decision_review_portfolio(NEW.decision_id);

  IF v_portfolio IS NULL THEN
    -- Refused rather than quarantined. A quarantined row is a historical
    -- artefact we are preserving; a NEW one would be a row nobody can see,
    -- holding a UNIQUE lock on a decision_id, created by someone who could
    -- not demonstrate ownership of it. That is the squat.
    RAISE EXCEPTION
      'decision_reviews: decision_id % resolves to no portfolio; cannot establish ownership',
      NEW.decision_id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT p.organization_id INTO v_org
    FROM portfolios p WHERE p.id = v_portfolio;

  IF v_org IS NULL THEN
    RAISE EXCEPTION
      'decision_reviews: portfolio % has no organization', v_portfolio
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.organization_id := v_org;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS decision_reviews_owner ON public.decision_reviews;
CREATE TRIGGER decision_reviews_owner
  BEFORE INSERT OR UPDATE ON public.decision_reviews
  FOR EACH ROW EXECUTE FUNCTION public.decision_reviews_set_owner();

-- ---------------------------------------------------------------------------
-- 5. Backfill, only where provenance is trustworthy.
--
--    Deliberately NOT routed through the trigger: this must touch only rows
--    whose decision_id resolves, and must leave the rest alone. Rows that
--    resolve to a portfolio with no organization are also left NULL.
-- ---------------------------------------------------------------------------

UPDATE public.decision_reviews r
   SET organization_id = p.organization_id
  FROM public.portfolios p
 WHERE p.id = public.decision_review_portfolio(r.decision_id)
   AND p.organization_id IS NOT NULL
   AND r.organization_id IS DISTINCT FROM p.organization_id;

-- No NOT NULL constraint. NULL is the quarantine state and must remain
-- representable for the historical rows.

-- ---------------------------------------------------------------------------
-- 6. Policies.
--
--    SELECT reads the derived column, which is fast and indexable, and is
--    trustworthy precisely because only the trigger writes it.
--    INSERT/UPDATE additionally validate against the decision itself.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "decision_reviews_select_authenticated" ON public.decision_reviews;
DROP POLICY IF EXISTS "decision_reviews_insert_self"          ON public.decision_reviews;
DROP POLICY IF EXISTS "decision_reviews_update_self"          ON public.decision_reviews;

CREATE POLICY decision_reviews_select ON public.decision_reviews
  FOR SELECT TO authenticated
  USING (
    organization_id IS NOT NULL
    AND public.is_member_of_org(organization_id)
  );

CREATE POLICY decision_reviews_insert ON public.decision_reviews
  FOR INSERT TO authenticated
  WITH CHECK (
    reviewed_by = auth.uid()
    AND public.can_review_decision(decision_id)
  );

CREATE POLICY decision_reviews_update ON public.decision_reviews
  FOR UPDATE TO authenticated
  USING (
    reviewed_by = auth.uid()
    AND organization_id IS NOT NULL
    AND public.is_member_of_org(organization_id)
    AND public.can_review_decision(decision_id)
  )
  WITH CHECK (
    reviewed_by = auth.uid()
    AND public.can_review_decision(decision_id)
  );

-- No DELETE policy, matching the previous state: deletes were already denied
-- despite the grant. Stated rather than left to inference.

-- ---------------------------------------------------------------------------
-- 7. Defence in depth. `anon` was denied only by the absence of a policy;
--    withdraw the grant so it is denied by two independent mechanisms.
-- ---------------------------------------------------------------------------

REVOKE ALL ON TABLE public.decision_reviews FROM anon;
REVOKE ALL ON TABLE public.decision_reviews FROM public;

COMMIT;
