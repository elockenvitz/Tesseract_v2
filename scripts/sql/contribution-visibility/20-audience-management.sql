-- ============================================================================
-- contribution-visibility / 20 — AUDIENCE MANAGEMENT  ***DO NOT APPLY***
--
-- Prepared, unapplied, deliberately outside supabase/migrations/.
-- Requires 10-policy-fix.sql applied first (it uses can_read_asset_contribution
-- only indirectly, but the two are one release).
--
-- ── What this replaces ──────────────────────────────────────────────────────
--
-- Today an audience is editable field-by-field by anything holding a session:
--   UPDATE asset_contributions SET visibility, team_id   (parent row)
--   DELETE FROM contribution_visibility_targets          (two HTTP requests…)
--   INSERT INTO contribution_visibility_targets          (…no transaction)
--
-- Three consequences, all demonstrated during this lane:
--   * A content save carrying a stale `visibility` widens a restricted
--     contribution to firm. Reachable today with no stale bundle: AssetTab
--     seeds its picker from three legacy sections only (:1037-1039), so an
--     author editing business_model with none of those sends visibility='firm'.
--   * The delete and the insert are separate requests. A dropped connection
--     between them destroys the audience with nothing to recover it from.
--   * The "a restricted audience must name someone" rule lives in the client,
--     where an older bundle simply does not have it.
--
-- After this file the audience is changeable through ONE operation that
-- authorizes the caller itself, and direct field writes are inert. Client age
-- stops mattering — not because it is detected, but because it is irrelevant.
-- ============================================================================

BEGIN;

-- ── 1. The privilege boundary ──────────────────────────────────────────────
--
-- Preflight A8: every table is owned by `postgres` with relforcerowsecurity
-- false, so a table owner bypasses RLS. Owning this function as `postgres`
-- would therefore work — and was rejected. The pin trigger below asks WHO is
-- executing, and `current_user = 'postgres'` would admit every other
-- postgres-owned definer function and the SQL Editor. It also breaks silently
-- the day anyone sets FORCE ROW LEVEL SECURITY.
--
-- A dedicated role names exactly one thing that nothing else can be.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tesseract_audience_writer') THEN
    CREATE ROLE tesseract_audience_writer NOLOGIN NOBYPASSRLS NOINHERIT;
  END IF;
END $$;

COMMENT ON ROLE tesseract_audience_writer IS
  'Owns set_contribution_audience() and nothing else. NOLOGIN, NOBYPASSRLS, '
  'granted to no one. Its only purpose is to be a current_user value the pin '
  'trigger can recognise. It grants reach, never identity: the function still '
  'authorizes the caller through auth.uid().';

-- ── 2. Pin the parent row's audience fields ────────────────────────────────
--
-- Silently preserving rather than raising is what keeps ordinary research
-- editing working. The UPDATE still writes content, supporting_detail,
-- attachments and updated_at, so a content save succeeds for every client,
-- however old. Only the audience is inert.
--
-- Raising instead would break saving prose for any bundle that still sends
-- these fields — which is every bundle deployed before this release.
CREATE OR REPLACE FUNCTION public.asset_contributions_pin_audience()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user = 'tesseract_audience_writer' THEN
    RETURN NEW;                      -- the authorized path
  END IF;
  NEW.visibility := OLD.visibility;
  NEW.team_id    := OLD.team_id;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.asset_contributions_pin_audience() IS
  'visibility and team_id are changeable only through '
  'set_contribution_audience(). Every other caller has those two fields '
  'silently preserved, so a content save still succeeds and an audience '
  'cannot be changed by a field write.';

-- Name sorts before both existing BEFORE triggers (preflight A7):
--   a_pin_audience < asset_contributions_set_organization_id < contribution_history_trigger
-- The pin writes only visibility/team_id; the org trigger writes only
-- organization_id; the history trigger reads only content/attachments and
-- stamps updated_at. No interaction — verified against the real definitions,
-- not assumed.
DROP TRIGGER IF EXISTS a_pin_audience ON public.asset_contributions;
CREATE TRIGGER a_pin_audience
  BEFORE UPDATE ON public.asset_contributions
  FOR EACH ROW EXECUTE FUNCTION public.asset_contributions_pin_audience();

-- ── 3. Remove the direct write paths on the target table ───────────────────
--
-- UPDATE is included because preflight A4 found it granted even though no
-- UPDATE policy exists. It is inert while RLS is on (A8), but leaving it would
-- let a target row be re-pointed at another node the moment an UPDATE policy
-- appeared — a direct audience change that bypasses this function entirely.
REVOKE INSERT, UPDATE, DELETE ON public.contribution_visibility_targets FROM authenticated;

-- The function is not a table owner, so RLS applies to it. Narrow policies
-- naming the role — the B-i shape from the design review. They read as
-- permissive and are reachable only through one SECURITY DEFINER function
-- whose own checks run first.
DROP POLICY IF EXISTS contribution_visibility_targets_writer_insert ON public.contribution_visibility_targets;
CREATE POLICY contribution_visibility_targets_writer_insert ON public.contribution_visibility_targets
  FOR INSERT TO tesseract_audience_writer WITH CHECK (true);

DROP POLICY IF EXISTS contribution_visibility_targets_writer_delete ON public.contribution_visibility_targets;
CREATE POLICY contribution_visibility_targets_writer_delete ON public.contribution_visibility_targets
  FOR DELETE TO tesseract_audience_writer USING (true);

DROP POLICY IF EXISTS asset_contributions_writer_update ON public.asset_contributions;
CREATE POLICY asset_contributions_writer_update ON public.asset_contributions
  FOR UPDATE TO tesseract_audience_writer USING (true) WITH CHECK (true);

GRANT SELECT, UPDATE ON public.asset_contributions TO tesseract_audience_writer;
GRANT SELECT, INSERT, DELETE ON public.contribution_visibility_targets TO tesseract_audience_writer;
GRANT SELECT ON public.org_chart_nodes, public.organizations TO tesseract_audience_writer;

-- ── 4. The one operation ───────────────────────────────────────────────────
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
  v_uid   uuid := auth.uid();     -- the CALLER. Never a parameter — see below.
  v_org   uuid := public.current_org_id();
  v_row   public.asset_contributions%ROWTYPE;
  v_bad   int;
  v_nodes uuid[] := coalesce(p_node_ids, '{}');
BEGIN
  /*
   * SECURITY DEFINER bypasses RLS, so every rule the policies enforce is
   * re-enforced here. A contribution id is an opaque uuid anyone can hold;
   * possessing one grants nothing.
   *
   * The caller's identity is read from auth.uid() and is NOT a parameter.
   * can_view_contribution (preflight A3d) takes p_user_id as an argument and
   * is consequently a membership oracle — the mistake is not repeated.
   */
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  -- current_org_id() already requires an active, unexpired membership
  -- (migration 20260826100000, verified in preflight A3). The explicit call
  -- below is the same belt-and-braces the existing policies use.
  IF v_org IS NULL OR NOT public.is_active_member_of_current_org() THEN
    RAISE EXCEPTION 'no active organization membership' USING ERRCODE = '42501';
  END IF;

  /*
   * Existence, tenancy and ownership in ONE lookup with ONE error. Separating
   * them would let a caller distinguish "not yours" from "does not exist" and
   * so probe for another organization's contributions.
   */
  SELECT * INTO v_row FROM public.asset_contributions
   WHERE id = p_contribution_id
     AND organization_id = v_org
     AND created_by = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'contribution not found or not yours' USING ERRCODE = '42501';
  END IF;

  -- A CHECK constraint already restricts this column to the five scopes
  -- (preflight A5), so this is defence in depth. It stays because the CHECK
  -- cannot see a scope/target mismatch, which rule 6 below catches.
  IF p_visibility NOT IN ('firm','division','department','team','portfolio') THEN
    RAISE EXCEPTION 'invalid visibility %', p_visibility USING ERRCODE = '22023';
  END IF;

  -- The rule that used to live only in the client, where an older bundle does
  -- not have it. A restricted contribution naming nobody is readable by its
  -- author alone while still displaying as shared.
  IF p_visibility <> 'firm' AND coalesce(array_length(v_nodes, 1), 0) = 0 THEN
    RAISE EXCEPTION 'a % audience must name at least one group', p_visibility
      USING ERRCODE = '23514';
  END IF;

  -- Every node must exist, belong to THIS organization, and be of a type
  -- matching the scope. Without the type check, 'department' visibility could
  -- be stored against a team node and the recorded scope would describe
  -- something its targets do not.
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

  /*
   * REACHABILITY IS DELIBERATELY NOT ENFORCED. A node with no direct members
   * is a product warning the picker shows, not an authorization rule —
   * refusing it would block an author targeting a group about to be staffed,
   * and fail-closed already covers the outcome: such a contribution reaches
   * its author only.
   */

  -- ── The replace, in ONE transaction ──────────────────────────────────────
  -- This is the defect that made the whole design worth building: the client
  -- does delete-then-insert as two HTTP requests, so a dropped connection
  -- between them destroys the audience. Here either both happen or neither.
  DELETE FROM public.contribution_visibility_targets
   WHERE contribution_id = v_row.id;

  IF p_visibility <> 'firm' THEN
    INSERT INTO public.contribution_visibility_targets (contribution_id, node_id, organization_id)
    SELECT DISTINCT v_row.id, n.id, v_org FROM unnest(v_nodes) AS n(id);
  END IF;

  /*
   * updated_at is NOT written. Preflight A7: track_contribution_history()
   * stamps it on a content or attachment change, and a visibility-only UPDATE
   * is neither — so an audience change does not contaminate the "last written"
   * clock unless something writes it by hand. updateVisibility currently does
   * (useContributions.ts:529); this must not inherit that.
   */
  UPDATE public.asset_contributions
     SET visibility = p_visibility,
         team_id    = CASE WHEN array_length(v_nodes, 1) = 1 THEN v_nodes[1] ELSE NULL END
   WHERE id = v_row.id;

  -- Return what was actually stored, so the client confirms rather than
  -- assumes. Silent preservation is backward compatibility for stale content
  -- saves; it is not the audience-editing experience.
  RETURN jsonb_build_object(
    'contribution_id', v_row.id,
    'visibility',      p_visibility,
    'node_ids',        to_jsonb(CASE WHEN p_visibility = 'firm' THEN '{}'::uuid[] ELSE v_nodes END),
    'node_count',      CASE WHEN p_visibility = 'firm' THEN 0 ELSE coalesce(array_length(v_nodes,1),0) END
  );
END $$;

ALTER FUNCTION public.set_contribution_audience(uuid, text, uuid[])
  OWNER TO tesseract_audience_writer;

REVOKE ALL ON FUNCTION public.set_contribution_audience(uuid, text, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_contribution_audience(uuid, text, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_contribution_audience(uuid, text, uuid[]) TO authenticated;

COMMIT;

-- ============================================================================
-- VERIFY AFTER APPLYING — read-only
-- ============================================================================
-- -- the role must be inert and unheld
-- SELECT rolname, rolcanlogin, rolbypassrls, rolinherit FROM pg_roles
--  WHERE rolname = 'tesseract_audience_writer';                   -- f, f, f
-- SELECT count(*) AS should_be_zero FROM pg_auth_members m
--   JOIN pg_roles r ON r.oid = m.roleid
--  WHERE r.rolname = 'tesseract_audience_writer';                 -- 0
--
-- -- the direct write paths must be gone
-- SELECT grantee, privilege_type FROM information_schema.role_table_grants
--  WHERE table_name = 'contribution_visibility_targets' AND grantee = 'authenticated';
--                                                      -- SELECT only
--
-- -- the function must be owned by the role and callable only by authenticated
-- SELECT pg_get_userbyid(proowner) AS owner, prosecdef FROM pg_proc
--  WHERE proname = 'set_contribution_audience';   -- tesseract_audience_writer, t
--
-- -- the pin must be first
-- SELECT tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
--  WHERE c.relname = 'asset_contributions' AND NOT t.tgisinternal ORDER BY tgname;
--                                      -- a_pin_audience first
-- ============================================================================
