-- ═══════════════════════════════════════════════════════════════════════════
--  Stage deadlines — tenant boundary, and the superseded unique constraints
--
--  NOT APPLIED. Prepared for review; run as `postgres`, in one transaction.
--  Rollback: 90-rollback.sql. Tests: supabase/tests/stage-deadline-tenant-isolation.sql
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── What is wrong ────────────────────────────────────────────────────────────
--
-- `asset_stage_deadlines` has two policies and they are the two weakest shapes
-- in the codebase:
--
--     "Users can view asset stage deadlines"    SELECT USING (true)
--     "Users can insert asset stage deadlines"  INSERT WITH CHECK (auth.uid() IS NOT NULL)
--
-- So every authenticated user reads every organization's deadlines, and can
-- write a deadline against any organization's workflow. There is no UPDATE and
-- no DELETE policy at all, which is a different failure: a deadline can be set
-- once and then neither edited nor removed — the upsert's `DO UPDATE` path is
-- refused, and the delete silently removes nothing.
--
-- The client half of this is already fixed (commit 3a8c7c17): reads embed
-- `workflows!inner(organization_id)` and filter on it. That is correctness in
-- the application, not a boundary. This is the boundary.
--
-- ── The predicate, and why it is not a new column ────────────────────────────
--
-- The table has no `organization_id` and does not need one. Its tenant is
-- already derivable:
--
--     asset_stage_deadlines.workflow_id → workflows.id → workflows.organization_id
--
-- `workflows` is org-owned; `assets` is global reference data with no org
-- column, so the asset side establishes nothing. Every policy below is the
-- same EXISTS over the owning workflow.
--
-- ── A consequence to accept deliberately ─────────────────────────────────────
--
-- A policy's subquery is itself subject to the referenced table's RLS. So
-- `EXISTS (SELECT 1 FROM workflows …)` inherits the workflows SELECT policy,
-- which is org scope AND access:
--
--     organization_id = current_org_id()
--     AND (is_public OR created_by = auth.uid() OR user_has_workflow_access(…))
--
-- The boundary is therefore slightly TIGHTER than "same organization": a
-- deadline on a same-org workflow the reader cannot access is also invisible.
-- That is deliberate. A deadline is a property of a workflow stage, so it
-- should not outlive the reader's access to the workflow — and the UI's own
-- query goes through the same policy via `workflows!inner`, so the policy and
-- the application agree exactly rather than disagreeing silently.
--
-- The alternative — a SECURITY DEFINER helper returning a workflow's org id —
-- would give org scope alone, but it adds a function, a grant, and an oracle
-- that maps any workflow uuid to its organization. Not worth it for a
-- difference nobody can observe through the application.

BEGIN;

-- ── Preconditions ───────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.asset_stage_deadlines') IS NULL THEN
    RAISE EXCEPTION 'asset_stage_deadlines does not exist';
  END IF;

  -- The predicate calls this; without it every policy below denies everything.
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='current_org_id'
                   AND pronamespace='public'::regnamespace) THEN
    RAISE EXCEPTION 'public.current_org_id() is missing';
  END IF;

  -- Dropping these is step 3 and must not be a surprise: the org-composite
  -- replacements have to be in place first, or the drop removes the only
  -- uniqueness guarantee rather than the redundant one.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid='public.user_asset_priorities'::regclass
                    AND conname='user_asset_priorities_org_asset_user_key') THEN
    RAISE EXCEPTION 'the org-composite key on user_asset_priorities is missing — do not drop the narrow one';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid='public.user_asset_widgets'::regclass
                    AND conname='user_asset_widgets_org_user_asset_title_key') THEN
    RAISE EXCEPTION 'the org-composite key on user_asset_widgets is missing — do not drop the narrow one';
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
--  1 · 2 — the four commands, one boundary
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Users can view asset stage deadlines"   ON public.asset_stage_deadlines;
DROP POLICY IF EXISTS "Users can insert asset stage deadlines" ON public.asset_stage_deadlines;

DROP POLICY IF EXISTS asset_stage_deadlines_select ON public.asset_stage_deadlines;
CREATE POLICY asset_stage_deadlines_select ON public.asset_stage_deadlines
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.workflows w
     WHERE w.id = asset_stage_deadlines.workflow_id
       AND w.organization_id = public.current_org_id()));

/*
 * INSERT — the answer to "does it also need workflow-derived validation": yes.
 *
 * `auth.uid() IS NOT NULL` is not a tenant check, it is a login check. Left
 * alone it would be the one command still open after this migration, and the
 * cheapest way in: write a deadline onto another organization's workflow and,
 * before this change, every member of that organization would have read it.
 *
 * `set_by` is pinned to the caller in the same predicate. The column is the
 * row's only attribution, and a writer who may insert should not be able to
 * sign the row with somebody else's name. NULL stays allowed — the column is
 * nullable and some rows legitimately have no setter.
 */
DROP POLICY IF EXISTS asset_stage_deadlines_insert ON public.asset_stage_deadlines;
CREATE POLICY asset_stage_deadlines_insert ON public.asset_stage_deadlines
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workflows w
       WHERE w.id = asset_stage_deadlines.workflow_id
         AND w.organization_id = public.current_org_id())
    AND (set_by IS NULL OR set_by = auth.uid()));

/*
 * UPDATE — USING and WITH CHECK both.
 *
 * USING alone would let a row be moved: read your own org's deadline, rewrite
 * its workflow_id to another organization's workflow, and the post-image is
 * never examined. The two halves are the same predicate so a row can neither
 * be reached from outside nor pushed outside.
 */
DROP POLICY IF EXISTS asset_stage_deadlines_update ON public.asset_stage_deadlines;
CREATE POLICY asset_stage_deadlines_update ON public.asset_stage_deadlines
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.workflows w
     WHERE w.id = asset_stage_deadlines.workflow_id
       AND w.organization_id = public.current_org_id()))
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workflows w
       WHERE w.id = asset_stage_deadlines.workflow_id
         AND w.organization_id = public.current_org_id())
    AND (set_by IS NULL OR set_by = auth.uid()));

DROP POLICY IF EXISTS asset_stage_deadlines_delete ON public.asset_stage_deadlines;
CREATE POLICY asset_stage_deadlines_delete ON public.asset_stage_deadlines
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.workflows w
     WHERE w.id = asset_stage_deadlines.workflow_id
       AND w.organization_id = public.current_org_id()));

/*
 * Grants that no policy can restrain.
 *
 * `authenticated` holds TRUNCATE on this table. TRUNCATE is NOT filtered by
 * row-level security — a policy cannot stop it, because it removes the rows
 * without ever reading them. PostgREST does not issue TRUNCATE, so this is not
 * reachable through the application today, and it is still a privilege that
 * should never have been granted to the role every signed-in user assumes.
 *
 * REFERENCES and TRIGGER go with it: both let a caller attach structure to a
 * table it does not own, and neither is used.
 */
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.asset_stage_deadlines FROM authenticated;

-- ════════════════════════════════════════════════════════════════════════════
--  3 — drop the superseded narrow unique constraints
-- ════════════════════════════════════════════════════════════════════════════
--
-- `UNIQUE (asset_id, user_id)` predates organizations. While it stands, one
-- user cannot hold a priority on the same asset in two organizations, which
-- makes the org-composite key it was supposed to be replaced by unreachable:
-- the upsert targets (organization_id, asset_id, user_id), finds no row for
-- the second org, inserts, and the old constraint raises 23505. Eight users
-- are in more than one organization today.
--
-- Dependencies checked before writing this:
--   · the only FK into either table is user_asset_widget_values.widget_id,
--     which references user_asset_widgets(id) — the PRIMARY KEY, untouched.
--   · no view or materialized view reads either constraint.
--   · the lookup paths keep their own non-unique indexes:
--     idx_user_asset_priorities_asset_id, idx_user_asset_priorities_user_id,
--     and idx_user_asset_widgets_lookup (user_id, asset_id) WHERE NOT is_archived.
--     So dropping these does not remove anybody's only access path — and the
--     org-composite index remains usable for the application's queries, whose
--     organization_id is pinned by RLS and therefore available as the leading
--     column.
--
-- `user_asset_widget_values` is deliberately NOT touched. Its
-- UNIQUE (widget_id, user_id) is already tenant-safe: widget_id is globally
-- unique and resolves to an org-scoped widget, so the pair cannot collide
-- across organizations.

ALTER TABLE public.user_asset_priorities
  DROP CONSTRAINT IF EXISTS user_asset_priorities_asset_id_user_id_key;

ALTER TABLE public.user_asset_widgets
  DROP CONSTRAINT IF EXISTS user_asset_widgets_user_id_asset_id_title_key;

-- ── Post-checks: fail the transaction rather than leave a half-boundary ─────
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_policy
   WHERE polrelid='public.asset_stage_deadlines'::regclass;
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'expected exactly 4 policies on asset_stage_deadlines, found %', v_n;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policy
              WHERE polrelid='public.asset_stage_deadlines'::regclass
                AND coalesce(pg_get_expr(polqual,polrelid),'') = 'true') THEN
    RAISE EXCEPTION 'an unconditional policy survived on asset_stage_deadlines';
  END IF;

  IF has_table_privilege('authenticated','public.asset_stage_deadlines','TRUNCATE') THEN
    RAISE EXCEPTION 'authenticated still holds TRUNCATE';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid='public.user_asset_priorities'::regclass
                AND conname='user_asset_priorities_asset_id_user_id_key') THEN
    RAISE EXCEPTION 'the narrow priorities constraint survived';
  END IF;

  -- The replacements must still be there; dropping both would be the bug this
  -- migration is meant to prevent.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid='public.user_asset_priorities'::regclass
                    AND conname='user_asset_priorities_org_asset_user_key')
  OR NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid='public.user_asset_widgets'::regclass
                    AND conname='user_asset_widgets_org_user_asset_title_key') THEN
    RAISE EXCEPTION 'an org-composite uniqueness guarantee is missing after the drop';
  END IF;

  RAISE NOTICE 'post-checks ok: 4 scoped policies, no TRUNCATE, narrow constraints gone, org-composite intact';
END $$;

COMMIT;
