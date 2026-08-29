-- =============================================================================
-- C1/01 — tdf_holdings_snapshots tenant boundary
--
-- Before: SELECT/INSERT/UPDATE/DELETE all `USING (true)`. A forged session for
-- a user in NO organization saw 48 of 48 rows on production, and could have
-- written to any of them.
--
-- Authority: tdf_id -> target_date_funds.organization_id.
--
-- EXISTS rather than a denormalised organization_id column, because the chain
-- was MEASURED total on production: 0 dangling parents, 0 parents without an
-- org, `tdf_id` NOT NULL and `target_date_funds.organization_id` NOT NULL.
-- Those are exactly the conditions that were absent for `portfolios.team_id`,
-- whose merely-usually-populated FK quarantined 13 messages in Release B. A
-- copied column would need a backfill, a trigger and a reconciliation story;
-- a total chain needs none of them.
--
-- Every UPDATE gets a matching WITH CHECK, so a row cannot be rewritten out of
-- its tenant by moving its tdf_id — the old policies had no WITH CHECK at all.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS "Users can view snapshots"   ON public.tdf_holdings_snapshots;
DROP POLICY IF EXISTS "Users can insert snapshots" ON public.tdf_holdings_snapshots;
DROP POLICY IF EXISTS "Users can update snapshots" ON public.tdf_holdings_snapshots;
DROP POLICY IF EXISTS "Users can delete snapshots" ON public.tdf_holdings_snapshots;

CREATE POLICY tdf_holdings_snapshots_select ON public.tdf_holdings_snapshots
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.target_date_funds f
                  WHERE f.id = tdf_holdings_snapshots.tdf_id
                    AND f.organization_id = public.current_org_id()));

CREATE POLICY tdf_holdings_snapshots_insert ON public.tdf_holdings_snapshots
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.target_date_funds f
                       WHERE f.id = tdf_holdings_snapshots.tdf_id
                         AND f.organization_id = public.current_org_id()));

CREATE POLICY tdf_holdings_snapshots_update ON public.tdf_holdings_snapshots
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.target_date_funds f
                  WHERE f.id = tdf_holdings_snapshots.tdf_id
                    AND f.organization_id = public.current_org_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.target_date_funds f
                       WHERE f.id = tdf_holdings_snapshots.tdf_id
                         AND f.organization_id = public.current_org_id()));

CREATE POLICY tdf_holdings_snapshots_delete ON public.tdf_holdings_snapshots
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.target_date_funds f
                  WHERE f.id = tdf_holdings_snapshots.tdf_id
                    AND f.organization_id = public.current_org_id()));

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename='tdf_holdings_snapshots'
     AND (qual = 'true' OR with_check = 'true');
  IF n > 0 THEN RAISE EXCEPTION 'C1/01: % unconditional policy/policies remain', n; END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename='tdf_holdings_snapshots';
  IF n <> 4 THEN RAISE EXCEPTION 'C1/01: expected 4 policies, found %', n; END IF;
END $$;

COMMIT;
