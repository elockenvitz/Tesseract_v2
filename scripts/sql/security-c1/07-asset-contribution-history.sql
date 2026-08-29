-- =============================================================================
-- C1/07 — asset_contribution_history tenant boundary
--
-- `SELECT USING (true) TO public` over 22 rows, every one carrying
-- `new_content` prose, across 3 assets in 1 organization.
--
-- This is the edit history of `asset_contributions` — the table the product
-- uses to keep research org-scoped. So the correctly-scoped model leaks its own
-- full revision history to every authenticated user, and any research migrated
-- OUT of `assets` into contributions starts accumulating history here. That is
-- why this runs BEFORE the assets migration: closing it afterwards would mean
-- moving prose into a table whose history is still world-readable, which
-- relocates the leak rather than closing it.
--
-- Authority: contribution_id -> asset_contributions.organization_id. Measured
-- total on production: 0 dangling, 0 parent-without-org. EXISTS, no backfill,
-- no new column.
--
-- Note the role: the existing policy is `TO public`, not `TO authenticated`, so
-- it is also the anon path. The replacement is `TO authenticated`, which closes
-- that on its own; 11 revokes the inert grant behind it.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS "Users can view history" ON public.asset_contribution_history;

-- Replay-safety: these files must be re-runnable against an already
-- remediated database, so the new policy names are dropped as well as the
-- old ones. Without this a second run fails on "policy already exists".
DROP POLICY IF EXISTS asset_contribution_history_select ON public.asset_contribution_history;
CREATE POLICY asset_contribution_history_select ON public.asset_contribution_history
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.asset_contributions c
                  WHERE c.id = asset_contribution_history.contribution_id
                    AND c.organization_id = public.current_org_id()));

-- The trigger that writes this table is SECURITY DEFINER and runs as the table
-- owner, so no INSERT policy is required for it to work. There is deliberately
-- none: a client has no reason to write history directly, and the absence of a
-- policy is a stronger statement than a restrictive one.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename='asset_contribution_history';
  IF n <> 1 THEN RAISE EXCEPTION 'C1/07: expected exactly 1 policy, found %', n; END IF;

  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
              AND tablename='asset_contribution_history' AND qual='true') THEN
    RAISE EXCEPTION 'C1/07: unconditional SELECT remains';
  END IF;
END $$;

COMMIT;
