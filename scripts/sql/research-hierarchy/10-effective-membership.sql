-- ═══════════════════════════════════════════════════════════════════════════
--  Research visibility — inherited (effective) org-chart membership
--
--  NOT APPLIED. Prepared for review; run as `postgres`, in one transaction.
--  Rollback: 90-rollback.sql. Tests: supabase/tests/research-hierarchy-visibility.sql
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── The semantics being implemented ──────────────────────────────────────────
--
--   1. Membership is inherited UPWARD from direct memberships: a member of a
--      Team is effectively a member of its Department and Division.
--   2. Sharing with a parent reaches direct members of that parent AND of every
--      descendant group.
--   3. Sharing with a child never reaches siblings or parent-only members.
--   4. An author may select only restricted nodes of which they are an
--      effective member.
--   5. Firm-wide is unchanged.
--   6. Cross-organization access stays prohibited.
--
-- Rules 1 and 2 are the same relation read from opposite ends, so ONE predicate
-- serves both the reader and the author: *the set of nodes a user is an
-- effective member of* = their direct nodes plus every ancestor of those.
--
-- Rule 3 falls out of the direction. The walk is strictly UPWARD and never
-- downward, so a parent-only member's effective set never contains a child
-- node, and a sibling's never contains its sibling.
--
-- ── Why upward from the user, not downward from the target ──────────────────
--
-- Expanding a target's subtree is the same relation and the wrong shape: a
-- Division's subtree is unbounded in principle, while the walk up from one
-- user is bounded by tree depth times their membership count — six rows across
-- the whole production org chart today. The set is also independent of which
-- contribution is being tested, which is what lets the planner evaluate it
-- once per statement rather than once per row (see the note on correlation
-- below).
--
-- ── Cycle safety ────────────────────────────────────────────────────────────
--
-- `org_chart_nodes.parent_id` has no cycle guard — nothing in the schema stops
-- A→B→A. An unguarded recursive CTE inside an RLS predicate would not error,
-- it would hang, and it would hang inside every read of the table. Two
-- independent stops: `UNION` (not `UNION ALL`) discards rows already seen, and
-- an explicit depth bound terminates regardless of what dedup does. Either
-- alone would do; a predicate that can hang a page load gets both.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.org_chart_nodes') IS NULL
  OR to_regclass('public.org_chart_node_members') IS NULL THEN
    RAISE EXCEPTION 'the org chart tables are missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='current_org_id'
                   AND pronamespace='public'::regnamespace) THEN
    RAISE EXCEPTION 'public.current_org_id() is missing';
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
--  1 — the effective-membership set
-- ════════════════════════════════════════════════════════════════════════════

/*
 * Every node `p_user` is an effective member of, within ONE organization.
 *
 * SECURITY DEFINER because the callers cannot read these tables themselves:
 * `tesseract_audience_writer` has no policy on org_chart_node_members at all,
 * and a reader's own policy would filter the walk to nodes they can see rather
 * than the ones they belong to. The function is a closed question — it takes a
 * user and an organization and returns node ids — so it discloses nothing a
 * caller could not already establish about themselves, and it never takes a
 * caller-supplied predicate.
 *
 * `p_org` is a parameter rather than read from current_org_id() inside, so the
 * RPC can call it while running as the writer role, where the session's
 * organization is still the author's but the call site wants to be explicit.
 */
CREATE OR REPLACE FUNCTION public.user_effective_node_ids(p_user uuid, p_org uuid)
RETURNS TABLE (node_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH RECURSIVE up(id, parent_id, depth) AS (
    -- the nodes the user actually belongs to
    SELECT n.id, n.parent_id, 1
      FROM public.org_chart_node_members m
      JOIN public.org_chart_nodes n ON n.id = m.node_id
     WHERE m.user_id = p_user
       AND n.organization_id = p_org
    UNION
    -- …and every ancestor, never a descendant
    SELECT p.id, p.parent_id, up.depth + 1
      FROM up
      JOIN public.org_chart_nodes p ON p.id = up.parent_id
     WHERE p.organization_id = p_org
       AND up.depth < 32
  )
  -- DISTINCT because `depth` rides along in the UNION, so a cycle yields the
  -- same node once per lap until the bound stops it. Membership tests use
  -- EXISTS and would not care; the caller reading this as a set would.
  SELECT DISTINCT id FROM up;
$$;

COMMENT ON FUNCTION public.user_effective_node_ids(uuid, uuid) IS
  'Nodes a user is an EFFECTIVE member of in one organization: their direct '
  'memberships plus all ancestors. Strictly upward, so a parent-only member '
  'never gains a child and a sibling never gains a sibling. Cycle-safe via '
  'UNION plus a depth bound of 32. Tenant-pinned by p_org — the recursion '
  'refuses to leave the organization at every step.';

ALTER FUNCTION public.user_effective_node_ids(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.user_effective_node_ids(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_effective_node_ids(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.user_effective_node_ids(uuid, uuid) TO authenticated;

/*
 * The caller's own set, for the current organization.
 *
 * This exists for CORRELATION, not convenience. A policy that writes
 * `… IN (SELECT node_id FROM user_effective_node_ids(auth.uid(), c.organization_id))`
 * references the outer row, so the planner must re-run the recursion for every
 * row it tests. With no outer reference the subquery becomes an InitPlan,
 * evaluated once per statement. The two forms are equivalent here because
 * every policy below already requires organization_id = current_org_id().
 */
CREATE OR REPLACE FUNCTION public.current_user_effective_node_ids()
RETURNS TABLE (node_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT e.node_id
    FROM public.user_effective_node_ids(auth.uid(), public.current_org_id()) e;
$$;

ALTER FUNCTION public.current_user_effective_node_ids() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.current_user_effective_node_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_effective_node_ids() FROM anon;
GRANT EXECUTE ON FUNCTION public.current_user_effective_node_ids() TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
--  2 — both server-side read paths
-- ════════════════════════════════════════════════════════════════════════════
--
-- There are TWO, and fixing one would split the feature: the contribution rows
-- would follow one rule while their history, revision events, replies and
-- reactions followed another.
--
--   asset_contributions_select          — its own inline copy of the match
--   can_read_asset_contribution()       — used by the other four policies
--
-- The only change in each is the membership test. The organization checks, the
-- author clause and the 'firm' clause are untouched.

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
                 JOIN public.org_chart_nodes ocn
                   ON ocn.id = cvt.node_id
                  AND ocn.organization_id = c.organization_id
                WHERE cvt.contribution_id = c.id
                  AND cvt.node_id IN (
                        SELECT e.node_id FROM public.current_user_effective_node_ids() e)
               )
          )
  );
$$;

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
        JOIN public.org_chart_nodes ocn
          ON ocn.id = cvt.node_id
         AND ocn.organization_id = asset_contributions.organization_id
        WHERE cvt.contribution_id = asset_contributions.id
          AND cvt.node_id IN (
                SELECT e.node_id FROM public.current_user_effective_node_ids() e)
      )
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
--  3 — author eligibility, enforced on the server
-- ════════════════════════════════════════════════════════════════════════════
--
-- The picker has always offered the author their ancestors by walking up the
-- chart in the browser. The RPC never checked: it validated that each node
-- exists, is in the organization and matches the scope, so a crafted call
-- could target any group in the organization. With inheritance live that
-- matters more than it did — targeting a Division you do not belong to would
-- now reach everyone beneath it.
--
-- The contract is unchanged: same name, same three arguments, same return
-- shape. Only a rule is added, and it is the rule the UI already applies.
--
-- ALREADY-STORED TARGETS ARE EXEMPT, deliberately. audience-reach.ts keeps a
-- node in the list when the contribution is already shared with it even if the
-- author could not pick it today — they may have left the team. Without this
-- exemption, re-saving such a contribution would start failing, and an author
-- would be unable to edit an audience they can see. The exemption cannot widen
-- anything: the node is already a target.

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
    -- unchanged: existence, tenancy and scope/type agreement
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

    -- NEW: the author must be an effective member of each target, unless the
    -- contribution is already shared with it.
    SELECT count(*) INTO v_bad
      FROM unnest(v_nodes) AS want(id)
     WHERE NOT EXISTS (
             SELECT 1 FROM public.user_effective_node_ids(v_uid, v_org) e
              WHERE e.node_id = want.id)
       AND NOT EXISTS (
             SELECT 1 FROM public.contribution_visibility_targets t
              WHERE t.contribution_id = v_row.id
                AND t.node_id = want.id);
    IF v_bad > 0 THEN
      RAISE EXCEPTION '% target(s) are groups you do not belong to', v_bad
        USING ERRCODE = '42501';
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

-- The RPC runs as its owning role, which must be able to call the helper.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tesseract_audience_writer') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.user_effective_node_ids(uuid, uuid) TO tesseract_audience_writer';
    EXECUTE 'ALTER FUNCTION public.set_contribution_audience(uuid, text, uuid[]) OWNER TO tesseract_audience_writer';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.set_contribution_audience(uuid, text, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_contribution_audience(uuid, text, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_contribution_audience(uuid, text, uuid[]) TO authenticated;

-- ── Post-checks ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF (SELECT prosrc FROM pg_proc WHERE proname='can_read_asset_contribution'
       AND pronamespace='public'::regnamespace) NOT LIKE '%current_user_effective_node_ids%' THEN
    RAISE EXCEPTION 'can_read_asset_contribution was not updated';
  END IF;

  IF (SELECT pg_get_expr(polqual, polrelid) FROM pg_policy
       WHERE polname='asset_contributions_select'
         AND polrelid='public.asset_contributions'::regclass)
     NOT LIKE '%current_user_effective_node_ids%' THEN
    RAISE EXCEPTION 'asset_contributions_select was not updated';
  END IF;

  -- The old exact-node join must be gone from BOTH paths, or one of them is
  -- still on the previous semantics.
  IF (SELECT prosrc FROM pg_proc WHERE proname='can_read_asset_contribution'
       AND pronamespace='public'::regnamespace) LIKE '%ocnm.node_id = cvt.node_id%' THEN
    RAISE EXCEPTION 'the direct-only join survived in can_read_asset_contribution';
  END IF;

  RAISE NOTICE 'post-checks ok: both read paths use effective membership';
END $$;

COMMIT;
