-- ═══════════════════════════════════════════════════════════════════════════
--  Rollback for 10-effective-membership.sql
--
--  Restores direct-only membership on both read paths and removes the author
--  eligibility check from the RPC. Run as `postgres`, in one transaction.
--
--  WHAT THIS UNDOES, in product terms: research shared with a Department or
--  Division stops reaching the teams beneath it. Nothing becomes MORE visible
--  — the rollback is strictly narrowing — so it is safe to run in a hurry.
--  Readers simply lose access they had, which is the pre-migration behaviour.
--
--  Stored audiences are untouched in both directions. No target row is
--  written, moved or deleted by either script, so rolling back and rolling
--  forward again returns exactly the same reach.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. can_read_asset_contribution — back to the exact-node join ────────────
CREATE OR REPLACE FUNCTION public.can_read_asset_contribution(p_contribution_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.asset_contributions c
    WHERE c.id = p_contribution_id
      AND c.organization_id = public.current_org_id()
      AND public.is_active_member_of_current_org()
      AND (
            c.created_by = auth.uid()
            OR c.visibility = 'firm'
            OR EXISTS (
                 SELECT 1
                 FROM public.contribution_visibility_targets cvt
                 JOIN public.org_chart_node_members ocnm
                   ON ocnm.node_id = cvt.node_id
                  AND ocnm.user_id = auth.uid()
                 JOIN public.org_chart_nodes ocn
                   ON ocn.id = cvt.node_id
                  AND ocn.organization_id = c.organization_id
                WHERE cvt.contribution_id = c.id
               )
          )
  );
$$;

-- ── 2. asset_contributions_select — its own inline copy ─────────────────────
DROP POLICY IF EXISTS asset_contributions_select ON public.asset_contributions;
CREATE POLICY asset_contributions_select ON public.asset_contributions
  FOR SELECT TO authenticated
  USING (
    public.is_active_member_of_current_org()
    AND organization_id = public.current_org_id()
    AND (
      created_by = auth.uid()
      OR visibility = 'firm'
      OR EXISTS (
        SELECT 1
        FROM public.contribution_visibility_targets cvt
        JOIN public.org_chart_node_members ocnm
          ON ocnm.node_id = cvt.node_id
         AND ocnm.user_id = auth.uid()
        JOIN public.org_chart_nodes ocn
          ON ocn.id = cvt.node_id
         AND ocn.organization_id = asset_contributions.organization_id
        WHERE cvt.contribution_id = asset_contributions.id
      )
    )
  );

-- ── 3. set_contribution_audience — drop the eligibility check ───────────────
--
-- Reinstates the body as 20-audience-management.sql left it. Note this makes
-- the RPC permissive again: an author may target any group in their
-- organization, which the picker does not offer but a crafted call could.
CREATE OR REPLACE FUNCTION public.set_contribution_audience(
  p_contribution_id uuid,
  p_visibility      text,
  p_node_ids        uuid[] DEFAULT '{}'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   uuid := public.current_user_id();
  v_org   uuid := public.current_org_id();
  v_row   public.asset_contributions%ROWTYPE;
  v_bad   int;
  v_nodes uuid[] := coalesce(p_node_ids, '{}');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  IF v_org IS NULL OR NOT public.is_active_member_of_current_org() THEN
    RAISE EXCEPTION 'no active organization membership' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.asset_contributions
   WHERE id = p_contribution_id
     AND organization_id = v_org
     AND created_by = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'contribution not found or not yours' USING ERRCODE = '42501';
  END IF;

  IF p_visibility NOT IN ('firm','division','department','team','portfolio') THEN
    RAISE EXCEPTION 'invalid visibility %', p_visibility USING ERRCODE = '22023';
  END IF;

  IF p_visibility <> 'firm' AND coalesce(array_length(v_nodes, 1), 0) = 0 THEN
    RAISE EXCEPTION 'a % audience must name at least one group', p_visibility
      USING ERRCODE = '23514';
  END IF;

  IF p_visibility <> 'firm' THEN
    SELECT count(*) INTO v_bad
      FROM unnest(v_nodes) AS want(id)
     WHERE NOT EXISTS (
       SELECT 1 FROM public.org_chart_nodes n
        WHERE n.id = want.id
          AND n.organization_id = v_org
          AND n.node_type = p_visibility);
    IF v_bad > 0 THEN
      RAISE EXCEPTION '% target(s) are not % groups in your organization',
        v_bad, p_visibility USING ERRCODE = '42501';
    END IF;
  END IF;

  DELETE FROM public.contribution_visibility_targets
   WHERE contribution_id = v_row.id;

  IF p_visibility <> 'firm' THEN
    INSERT INTO public.contribution_visibility_targets (contribution_id, node_id, organization_id)
    SELECT DISTINCT v_row.id, n.id, v_org FROM unnest(v_nodes) AS n(id);
  END IF;

  UPDATE public.asset_contributions
     SET visibility = p_visibility,
         team_id    = CASE WHEN array_length(v_nodes, 1) = 1 THEN v_nodes[1] ELSE NULL END
   WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'contribution_id', v_row.id,
    'visibility',      p_visibility,
    'node_ids',        to_jsonb(CASE WHEN p_visibility = 'firm' THEN '{}'::uuid[] ELSE v_nodes END),
    'node_count',      CASE WHEN p_visibility = 'firm' THEN 0 ELSE coalesce(array_length(v_nodes,1),0) END
  );
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tesseract_audience_writer') THEN
    EXECUTE 'ALTER FUNCTION public.set_contribution_audience(uuid, text, uuid[]) OWNER TO tesseract_audience_writer';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.set_contribution_audience(uuid, text, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_contribution_audience(uuid, text, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_contribution_audience(uuid, text, uuid[]) TO authenticated;

-- ── 4. the helpers ──────────────────────────────────────────────────────────
-- Dropped last: the two objects above must stop referencing them first.
DROP FUNCTION IF EXISTS public.current_user_effective_node_ids();
DROP FUNCTION IF EXISTS public.user_effective_node_ids(uuid, uuid);

COMMIT;

-- Re-running supabase/tests/research-hierarchy-visibility.sql after this
-- should return to 15 PASS / 5 FAIL — the pre-migration grid, and the proof
-- that the rollback is complete.
