-- =============================================================================
-- C1/02 — tdf_holdings tenant boundary
--
-- Before: all four commands `USING (true)`. 672 rows, 100% visible to a user in
-- no organization. The largest row count in C1 and, at 0 client call sites, the
-- lowest regression risk — a reminder that blast radius and severity are
-- independent.
--
-- Authority: snapshot_id -> tdf_holdings_snapshots.tdf_id ->
--            target_date_funds.organization_id. Measured total on production:
--            0 dangling, 0 parent-without-org, both join columns NOT NULL.
--
-- Runs after 01 because it reads through the snapshot table 01 secures. Note
-- the predicate does NOT rely on 01's policies: the EXISTS subquery runs as the
-- table owner inside the policy, so the two-hop join is evaluated regardless of
-- whether the caller could have selected the snapshot row directly. That is
-- what makes the chain an authority rather than a second permission check.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS "Users can view holdings"   ON public.tdf_holdings;
DROP POLICY IF EXISTS "Users can insert holdings" ON public.tdf_holdings;
DROP POLICY IF EXISTS "Users can update holdings" ON public.tdf_holdings;
DROP POLICY IF EXISTS "Users can delete holdings" ON public.tdf_holdings;

-- Replay-safety: these files must be re-runnable against an already
-- remediated database, so the new policy names are dropped as well as the
-- old ones. Without this a second run fails on "policy already exists".
DROP POLICY IF EXISTS tdf_holdings_select ON public.tdf_holdings;
DROP POLICY IF EXISTS tdf_holdings_insert ON public.tdf_holdings;
DROP POLICY IF EXISTS tdf_holdings_update ON public.tdf_holdings;
DROP POLICY IF EXISTS tdf_holdings_delete ON public.tdf_holdings;
CREATE POLICY tdf_holdings_select ON public.tdf_holdings
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tdf_holdings_snapshots s
                   JOIN public.target_date_funds f ON f.id = s.tdf_id
                  WHERE s.id = tdf_holdings.snapshot_id
                    AND f.organization_id = public.current_org_id()));

CREATE POLICY tdf_holdings_insert ON public.tdf_holdings
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.tdf_holdings_snapshots s
                        JOIN public.target_date_funds f ON f.id = s.tdf_id
                       WHERE s.id = tdf_holdings.snapshot_id
                         AND f.organization_id = public.current_org_id()));

CREATE POLICY tdf_holdings_update ON public.tdf_holdings
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tdf_holdings_snapshots s
                   JOIN public.target_date_funds f ON f.id = s.tdf_id
                  WHERE s.id = tdf_holdings.snapshot_id
                    AND f.organization_id = public.current_org_id()))
  -- The WITH CHECK is the half that matters here: without it a caller could
  -- UPDATE a row they own and move its snapshot_id into another tenant's fund.
  WITH CHECK (EXISTS (SELECT 1 FROM public.tdf_holdings_snapshots s
                        JOIN public.target_date_funds f ON f.id = s.tdf_id
                       WHERE s.id = tdf_holdings.snapshot_id
                         AND f.organization_id = public.current_org_id()));

CREATE POLICY tdf_holdings_delete ON public.tdf_holdings
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tdf_holdings_snapshots s
                   JOIN public.target_date_funds f ON f.id = s.tdf_id
                  WHERE s.id = tdf_holdings.snapshot_id
                    AND f.organization_id = public.current_org_id()));

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename='tdf_holdings'
     AND (qual = 'true' OR with_check = 'true');
  IF n > 0 THEN RAISE EXCEPTION 'C1/02: % unconditional policy/policies remain', n; END IF;
END $$;

COMMIT;
