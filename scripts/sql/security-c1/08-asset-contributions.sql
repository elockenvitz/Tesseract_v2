-- =============================================================================
-- C1/08 — asset_contributions: close the organization_id IS NULL escape hatch
--
-- asset_contributions is already the org-scoped proprietary research model, and
-- its policies are genuinely scoped. But every one of them carries
--
--     (organization_id = current_org_id() OR organization_id IS NULL)
--
-- so a row with no organization is visible and writable in EVERY tenant. It is
-- a tolerance for legacy rows that reads as a policy. Production has exactly one
-- such row (an NKE `thesis` contribution), and its author belongs to exactly ONE
-- organization — so unlike the ambiguous cases elsewhere in C1, this one IS
-- deterministically recoverable and is backfilled rather than quarantined.
--
-- The backfill is written to be self-limiting: it only resolves an author with
-- exactly one active membership. An author in two organizations leaves the row
-- NULL, and the verification block below reports it rather than the migration
-- inventing an answer. On production that branch is not expected to fire; it
-- exists so the same file is safe if the data moves before it runs.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Backfill: single-membership authors only.
-- -----------------------------------------------------------------------------
UPDATE public.asset_contributions c
   SET organization_id = m.organization_id
  -- (array_agg)[1] rather than min(): there is no min(uuid), and with the
  -- HAVING clause below there is exactly one distinct value to pick anyway.
  FROM (SELECT om.user_id, (array_agg(DISTINCT om.organization_id))[1] AS organization_id
          FROM public.organization_memberships om
         WHERE om.status = 'active'
           AND (om.expires_at IS NULL OR om.expires_at > now())
         GROUP BY om.user_id
        HAVING count(DISTINCT om.organization_id) = 1) m
 WHERE c.organization_id IS NULL
   AND c.created_by = m.user_id;

-- Same treatment for the child table that mirrors the same escape hatch.
UPDATE public.contribution_visibility_targets t
   SET organization_id = c.organization_id
  FROM public.asset_contributions c
 WHERE t.contribution_id = c.id
   AND t.organization_id IS NULL
   AND c.organization_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Policies without the NULL branch.
--
-- A row that could not be resolved above is now invisible to everyone rather
-- than visible to everyone. That is the correct failure direction for
-- proprietary research: quarantine denies, it does not share.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS org_members_can_view_contributions   ON public.asset_contributions;
DROP POLICY IF EXISTS users_can_create_contributions       ON public.asset_contributions;
DROP POLICY IF EXISTS users_can_update_own_contributions   ON public.asset_contributions;
DROP POLICY IF EXISTS users_can_delete_own_contributions   ON public.asset_contributions;

CREATE POLICY asset_contributions_select ON public.asset_contributions
  FOR SELECT TO authenticated
  USING (public.is_active_member_of_current_org()
         AND organization_id = public.current_org_id()
         AND (created_by = auth.uid()
              OR visibility = 'firm'
              OR team_id IS NULL
              OR EXISTS (SELECT 1
                           FROM public.contribution_visibility_targets cvt
                           JOIN public.org_chart_node_members ocnm
                             ON ocnm.node_id = cvt.node_id AND ocnm.user_id = auth.uid()
                          WHERE cvt.contribution_id = asset_contributions.id)));

CREATE POLICY asset_contributions_insert ON public.asset_contributions
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND organization_id = public.current_org_id());

CREATE POLICY asset_contributions_update ON public.asset_contributions
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid() AND organization_id = public.current_org_id())
  WITH CHECK (created_by = auth.uid() AND organization_id = public.current_org_id());

CREATE POLICY asset_contributions_delete ON public.asset_contributions
  FOR DELETE TO authenticated
  USING (created_by = auth.uid() AND organization_id = public.current_org_id());

DROP POLICY IF EXISTS org_members_can_view_contribution_targets  ON public.contribution_visibility_targets;
DROP POLICY IF EXISTS users_can_insert_own_contribution_targets  ON public.contribution_visibility_targets;
DROP POLICY IF EXISTS users_can_delete_own_contribution_targets  ON public.contribution_visibility_targets;

CREATE POLICY contribution_visibility_targets_select ON public.contribution_visibility_targets
  FOR SELECT TO authenticated
  USING (public.is_active_member_of_current_org()
         AND organization_id = public.current_org_id());

CREATE POLICY contribution_visibility_targets_insert ON public.contribution_visibility_targets
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.current_org_id()
              AND EXISTS (SELECT 1 FROM public.asset_contributions c
                           WHERE c.id = contribution_visibility_targets.contribution_id
                             AND c.created_by = auth.uid()));

CREATE POLICY contribution_visibility_targets_delete ON public.contribution_visibility_targets
  FOR DELETE TO authenticated
  USING (organization_id = public.current_org_id()
         AND EXISTS (SELECT 1 FROM public.asset_contributions c
                      WHERE c.id = contribution_visibility_targets.contribution_id
                        AND c.created_by = auth.uid()));

-- -----------------------------------------------------------------------------
-- Assign the tenant on write, so a client cannot choose it and cannot omit it.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.asset_contributions_set_organization_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.organization_id IS NULL THEN
    NEW.organization_id := NULL;   -- an unresolved legacy row stays unresolved
    RETURN NEW;
  END IF;

  NEW.organization_id := public.current_org_id();
  IF NEW.organization_id IS NULL THEN
    RAISE EXCEPTION 'asset_contributions: caller has no active organization';
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS asset_contributions_set_organization_id ON public.asset_contributions;
CREATE TRIGGER asset_contributions_set_organization_id
  BEFORE INSERT OR UPDATE ON public.asset_contributions
  FOR EACH ROW EXECUTE FUNCTION public.asset_contributions_set_organization_id();

DO $$
DECLARE still_null int;
BEGIN
  SELECT count(*) INTO still_null FROM public.asset_contributions WHERE organization_id IS NULL;
  IF still_null > 0 THEN
    RAISE NOTICE 'C1/08: % contribution(s) remain unattributed and are now invisible to all tenants (multi-org author)', still_null;
  ELSE
    RAISE NOTICE 'C1/08: every contribution carries an organization';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
              AND tablename IN ('asset_contributions','contribution_visibility_targets')
              AND coalesce(qual,'') || coalesce(with_check,'') LIKE '%organization_id IS NULL%') THEN
    RAISE EXCEPTION 'C1/08: a NULL-organization escape branch remains';
  END IF;
END $$;

COMMIT;
