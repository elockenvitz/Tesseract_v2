-- =============================================================================
-- C1/08b — asset_workflow_progress + asset_workflow_priorities tenant boundary
--
-- RUN ORDER: after 08, BEFORE 09. 09 migrates 490 production rows of workflow
-- state out of the global `assets` row and into these two tables. Doing that
-- while their policies are still per-user would move the data under a boundary
-- that is not a tenant boundary — the same mistake as securing a history table
-- while its source stays open.
--
-- These were surfaced by the product smoke suite, not by the policy audit: the
-- repointed universe `priority` rule returned nothing for a legitimate caller,
-- because the live policy is
--
--     asset_id IN (SELECT id FROM assets WHERE created_by = auth.uid())
--
-- "assets I personally created" — on a table of global assets shared by every
-- tenant. It is not an organization boundary in either direction: it hides a
-- colleague's work in the same org, and `asset_workflow_progress` additionally
-- carries
--
--     OR workflow_id IN (SELECT id FROM workflows WHERE is_public = true OR ...)
--
-- which makes progress on any of the 23 `is_public` workflows readable across
-- organizations.
--
-- Authority: workflow_id -> workflows.organization_id. Measured total on
-- production: 396 progress rows and 6 priority rows, 0 dangling, 0
-- parent-without-org, workflow_id NOT NULL, workflows.organization_id NOT NULL.
-- EXISTS, no new column, no backfill.
--
-- SCOPE. Tenant boundary only. This is not a redesign of workflow permissions:
-- the question of who *within* an organization may edit another member's
-- progress is untouched and left as the org-wide access it already was.
--
-- One deliberate behaviour change: progress on a public workflow is no longer
-- visible to other organizations. A workflow TEMPLATE may reasonably be shared;
-- one firm's progress through it is not a template.
-- =============================================================================

BEGIN;

-- ── asset_workflow_progress ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can read workflow progress with access"        ON public.asset_workflow_progress;
DROP POLICY IF EXISTS "Users can start workflows with access"              ON public.asset_workflow_progress;
DROP POLICY IF EXISTS "Users can update workflow progress with access"     ON public.asset_workflow_progress;
DROP POLICY IF EXISTS "Users can delete workflow progress with admin access" ON public.asset_workflow_progress;

-- Replay-safety: these files must be re-runnable against an already
-- remediated database, so the new policy names are dropped as well as the
-- old ones. Without this a second run fails on "policy already exists".
DROP POLICY IF EXISTS asset_workflow_progress_select ON public.asset_workflow_progress;
DROP POLICY IF EXISTS asset_workflow_progress_insert ON public.asset_workflow_progress;
DROP POLICY IF EXISTS asset_workflow_progress_update ON public.asset_workflow_progress;
DROP POLICY IF EXISTS asset_workflow_progress_delete ON public.asset_workflow_progress;
DROP POLICY IF EXISTS asset_workflow_priorities_select ON public.asset_workflow_priorities;
DROP POLICY IF EXISTS asset_workflow_priorities_insert ON public.asset_workflow_priorities;
DROP POLICY IF EXISTS asset_workflow_priorities_update ON public.asset_workflow_priorities;
DROP POLICY IF EXISTS asset_workflow_priorities_delete ON public.asset_workflow_priorities;
CREATE POLICY asset_workflow_progress_select ON public.asset_workflow_progress
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workflows w
                  WHERE w.id = asset_workflow_progress.workflow_id
                    AND w.organization_id = public.current_org_id()));

CREATE POLICY asset_workflow_progress_insert ON public.asset_workflow_progress
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.workflows w
                       WHERE w.id = asset_workflow_progress.workflow_id
                         AND w.organization_id = public.current_org_id()));

CREATE POLICY asset_workflow_progress_update ON public.asset_workflow_progress
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workflows w
                  WHERE w.id = asset_workflow_progress.workflow_id
                    AND w.organization_id = public.current_org_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.workflows w
                       WHERE w.id = asset_workflow_progress.workflow_id
                         AND w.organization_id = public.current_org_id()));

CREATE POLICY asset_workflow_progress_delete ON public.asset_workflow_progress
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workflows w
                  WHERE w.id = asset_workflow_progress.workflow_id
                    AND w.organization_id = public.current_org_id()));

-- ── asset_workflow_priorities ───────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can manage asset workflow priorities for their assets"
  ON public.asset_workflow_priorities;

CREATE POLICY asset_workflow_priorities_select ON public.asset_workflow_priorities
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workflows w
                  WHERE w.id = asset_workflow_priorities.workflow_id
                    AND w.organization_id = public.current_org_id()));

CREATE POLICY asset_workflow_priorities_insert ON public.asset_workflow_priorities
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.workflows w
                       WHERE w.id = asset_workflow_priorities.workflow_id
                         AND w.organization_id = public.current_org_id()));

CREATE POLICY asset_workflow_priorities_update ON public.asset_workflow_priorities
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workflows w
                  WHERE w.id = asset_workflow_priorities.workflow_id
                    AND w.organization_id = public.current_org_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.workflows w
                       WHERE w.id = asset_workflow_priorities.workflow_id
                         AND w.organization_id = public.current_org_id()));

CREATE POLICY asset_workflow_priorities_delete ON public.asset_workflow_priorities
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workflows w
                  WHERE w.id = asset_workflow_priorities.workflow_id
                    AND w.organization_id = public.current_org_id()));

-- Both EXISTS predicates filter on workflow_id, which is the leading column of
-- neither table's existing unique index (asset_id, workflow_id).
CREATE INDEX IF NOT EXISTS idx_asset_workflow_progress_workflow
  ON public.asset_workflow_progress (workflow_id);
CREATE INDEX IF NOT EXISTS idx_asset_workflow_priorities_workflow
  ON public.asset_workflow_priorities (workflow_id);

DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad FROM pg_policies
   WHERE schemaname='public'
     AND tablename IN ('asset_workflow_progress','asset_workflow_priorities')
     AND (qual='true' OR with_check='true')
     AND roles::text NOT LIKE '%postgres%';   -- the service-role policy is intentional
  IF bad > 0 THEN RAISE EXCEPTION 'C1/08b: % unconditional policy/policies remain', bad; END IF;

  SELECT count(*) INTO bad FROM pg_policies
   WHERE schemaname='public'
     AND tablename IN ('asset_workflow_progress','asset_workflow_priorities')
     AND coalesce(qual,'') LIKE '%is_public%';
  IF bad > 0 THEN RAISE EXCEPTION 'C1/08b: a cross-org is_public branch remains'; END IF;

  RAISE NOTICE 'C1/08b: workflow state bounded by workflows.organization_id';
END $$;

COMMIT;
