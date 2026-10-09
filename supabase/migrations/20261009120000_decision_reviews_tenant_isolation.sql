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

--    AMBIGUITY FAILS CLOSED. The first version of this ordered the three
--    candidate tables by preference and took `LIMIT 1`, which is the
--    opposite of fail-closed: a decision_id present in two tables, or
--    matching two rows with different owners, would silently resolve to
--    whichever table was ranked first. `decision_id` is unconstrained TEXT
--    with no FK, so nothing in the schema prevents a collision. Here, two
--    DISTINCT owning portfolios means ownership is unknown, and unknown
--    ownership resolves to NULL — which quarantines rather than guesses.
--
--    `search_path = ''` with fully-qualified names, rather than the
--    `= public` the older functions here use. For SECURITY DEFINER that is
--    the difference between a pinned resolution and one a caller can
--    influence; the cost is verbosity.

CREATE OR REPLACE FUNCTION public.decision_review_portfolio(p_decision_id text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
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
  SELECT CASE WHEN count(*) = 1 THEN min(portfolio_id) END
    FROM candidates;
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
SET search_path = ''
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
SET search_path = ''
AS $$
DECLARE
  v_portfolio uuid;
  v_org uuid;
BEGIN
  /*
   * A review is about one decision, for its whole life.
   *
   * Allowing `decision_id` to change would let a row MIGRATE BETWEEN
   * ORGANIZATIONS: the recompute below would re-stamp it, and an edit would
   * silently become a transfer. Nothing in the product edits this column —
   * the client upserts on it as the conflict key — so forbidding it costs
   * nothing and removes the question.
   */
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
      /*
       * Refused, not quarantined. A quarantined row is a historical artefact
       * being preserved; a NEW one would be invisible to everyone while
       * holding the UNIQUE lock on a decision_id, created by someone who
       * could not demonstrate ownership of it. That is the squat.
       *
       * This also covers AMBIGUITY: the resolver returns NULL when two
       * distinct portfolios claim the id, so a colliding decision_id cannot
       * be reviewed by anyone until the collision is resolved.
       */
      RAISE EXCEPTION
        'decision_reviews: decision_id % resolves to no single owning portfolio; cannot establish ownership',
        NEW.decision_id
        USING ERRCODE = 'check_violation';
    END IF;

    /*
     * On UPDATE, keep whatever ownership the row already had.
     *
     * Raising here instead would brick the only repair path for the six
     * quarantined rows: an operator reassigning one (through service_role,
     * which bypasses RLS but NOT triggers) would be blocked by this very
     * function. Since `decision_id` is now immutable, a row's ownership
     * cannot drift, so preserving it is safe.
     */
    NEW.organization_id := OLD.organization_id;
    RETURN NEW;
  END IF;

  NEW.organization_id := v_org;
  RETURN NEW;
END;
$$;

-- A trigger function is invoked by the trigger, never called directly.
REVOKE ALL ON FUNCTION public.decision_reviews_set_owner() FROM public, anon, authenticated;

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

/*
 * UPDATE, with one deliberate exception for adoption.
 *
 * `decision_id` is globally UNIQUE, so a quarantined row holds the key for
 * its decision. If that decision later becomes resolvable — the parent row
 * is restored, or a collision is cleaned up — the rightful reviewer's upsert
 * resolves to an UPDATE against a row they cannot see. Requiring
 * `organization_id IS NOT NULL` in USING would refuse it, and the symptom
 * would be a unique-violation on an invisible row: the exact class of
 * "legitimate reviewer blocked by a row they cannot do anything about" that
 * this work exists to remove.
 *
 * So an ownerless row may be ADOPTED by someone who can prove ownership of
 * the decision now. The trigger then stamps the correct organization. Both
 * halves of the proof are required — `can_review_decision` is false while
 * the decision is unresolvable, so this cannot be used to reach the six
 * current orphans, and `reviewed_by = auth.uid()` still applies.
 */
CREATE POLICY decision_reviews_update ON public.decision_reviews
  FOR UPDATE TO authenticated
  USING (
    reviewed_by = auth.uid()
    AND public.can_review_decision(decision_id)
    AND (
      organization_id IS NULL
      OR public.is_member_of_org(organization_id)
    )
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
