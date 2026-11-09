-- `set_theme_contribution_audience`: the Theme page's audience write path.
--
-- A line-for-line twin of `set_contribution_audience`, against
-- `theme_contributions_v2` and `theme_contribution_visibility_targets`. The
-- asset one is the reference implementation and the differences are only the
-- two table names; everything it refuses, this refuses, with the same
-- SQLSTATEs so the client's error handling is the same handling.
--
-- Separate from the schema migration beside it because ownership has to be
-- set after creation, and a failed ALTER should not roll back the policies.
--
-- ── Why it is a definer function at all ───────────────────────────────────
--
-- Writing an audience means deleting and re-inserting target rows for a
-- contribution and then updating the contribution. Doing that under the
-- caller's own policies would need broader INSERT/DELETE grants on the
-- targets table than the product otherwise wants, and the authorization is
-- not expressible as a single policy predicate: it has to check that every
-- named node is a group of the right TYPE, in this org, that the author
-- actually belongs to -- except for a node already attached, which an author
-- may remove after leaving the group.
--
-- ── Why it is owned by tesseract_audience_writer and not postgres ─────────
--
-- Because SECURITY DEFINER runs as the owner. Owned by postgres this would be
-- a superuser-equivalent entry point, and a bug in the body could reach any
-- table in the database. `tesseract_audience_writer` holds exactly four
-- policies: select/update on the contributions table and
-- select/insert/delete on its targets. A bug here can corrupt an audience and
-- nothing else. That is how the asset function is built, and copying the body
-- while skipping the ownership would have been the dangerous half of the
-- pattern.
--
-- ── The authorization, in order ───────────────────────────────────────────
--
--   1. authenticated                              28000
--   2. active member of the current org           42501
--   3. the contribution is this org's AND yours   42501
--   4. the level is one of the five               22023
--   5. a non-firm level names at least one group  23514   <- a restricted
--      audience naming nobody is readable by its author alone while the UI
--      shows it as shared.
--   6. every named node is a group of THAT TYPE
--      in this org                                42501
--   7. every named node is one you belong to,
--      unless it is already attached              42501   <- so an author who
--      has left a team can still take that team off their own research.
--
-- Only then are the targets replaced and the row updated.
--
-- `team_id` is NOT set here. The asset version keeps a single-node value in
-- `asset_contributions.team_id` for legacy readers; `theme_contributions_v2`
-- has no such column and does not need one invented.

create or replace function public.set_theme_contribution_audience(
  p_contribution_id uuid,
  p_visibility text,
  p_node_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_uid   uuid := public.current_user_id();
  v_org   uuid := public.current_org_id();
  v_row   public.theme_contributions_v2%ROWTYPE;
  v_bad   int;
  v_nodes uuid[] := coalesce(p_node_ids, '{}');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  IF v_org IS NULL OR NOT public.is_active_member_of_current_org() THEN
    RAISE EXCEPTION 'no active organization membership' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.theme_contributions_v2
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

    SELECT count(*) INTO v_bad
      FROM unnest(v_nodes) AS want(id)
     WHERE NOT EXISTS (
             SELECT 1 FROM public.user_effective_node_ids(v_uid, v_org) e
              WHERE e.node_id = want.id)
       AND NOT EXISTS (
             SELECT 1 FROM public.theme_contribution_visibility_targets t
              WHERE t.contribution_id = v_row.id
                AND t.node_id = want.id);
    IF v_bad > 0 THEN
      RAISE EXCEPTION '% target(s) are groups you do not belong to', v_bad
        USING ERRCODE = '42501';
    END IF;
  END IF;

  DELETE FROM public.theme_contribution_visibility_targets
   WHERE contribution_id = v_row.id;

  IF p_visibility <> 'firm' THEN
    INSERT INTO public.theme_contribution_visibility_targets
      (contribution_id, node_id, organization_id)
    SELECT DISTINCT v_row.id, n.id, v_org FROM unnest(v_nodes) AS n(id);
  END IF;

  UPDATE public.theme_contributions_v2
     SET visibility = p_visibility
   WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'contribution_id', v_row.id,
    'visibility',      p_visibility,
    'node_ids',        to_jsonb(CASE WHEN p_visibility = 'firm' THEN '{}'::uuid[] ELSE v_nodes END),
    'node_count',      CASE WHEN p_visibility = 'firm' THEN 0 ELSE coalesce(array_length(v_nodes,1),0) END
  );
END $function$;

-- Ownership is the security boundary, not a detail. See the note above.
--
-- ALTER FUNCTION ... OWNER TO requires the INCOMING owner to hold CREATE on the
-- schema, and `tesseract_audience_writer` deliberately does NOT have it. That
-- is the point of the role -- it can touch two tables and create nothing -- so
-- the privilege is borrowed for exactly one statement and handed back inside
-- the same transaction. Measured on the first production apply, 2026-11-09:
--
--   ERROR 42501: permission denied for schema public
--   has_schema_privilege('tesseract_audience_writer','public','create') = false
--   has_schema_privilege('tesseract_audience_writer','public','usage')  = true
--
-- Without the bracket this migration cannot apply at all. It rolled back whole
-- (Postgres DDL is transactional), so nothing partial was left behind.
grant create on schema public to tesseract_audience_writer;

alter function public.set_theme_contribution_audience(uuid, text, uuid[])
  owner to tesseract_audience_writer;

revoke create on schema public from tesseract_audience_writer;

revoke all on function public.set_theme_contribution_audience(uuid, text, uuid[]) from public;
-- `from public` does NOT remove anon's grant. Supabase's ALTER DEFAULT
-- PRIVILEGES gives `anon` EXECUTE directly on every function created in
-- `public`, and revoking the PUBLIC pseudo-role leaves a direct grant intact.
-- Measured right after the first successful apply: anon EXECUTE was still
-- true here while the asset twin `set_contribution_audience` had it false.
-- A SECURITY DEFINER function owned by a privileged role must not be
-- reachable by anon, regardless of the 28000 guard in its own first statement.
revoke all on function public.set_theme_contribution_audience(uuid, text, uuid[]) from anon;
grant execute on function public.set_theme_contribution_audience(uuid, text, uuid[])
  to authenticated, service_role, tesseract_audience_writer;

-- ── The pin: the function above is the ONLY way to change an audience ─────
--
-- Without this the ordinary UPDATE policy still lets a client write
-- `visibility` directly, which is how a contribution ends up labelled "Team"
-- with no target rows -- readable by its author alone while the UI shows it
-- as shared. The function refuses that case with 23514; a direct UPDATE
-- cannot.
--
-- It silently RESTORES the old value rather than raising, which is the same
-- choice `asset_contributions_pin_audience` makes and for the same reason:
-- the client patches whole rows, so a save that happens to carry an unchanged
-- `visibility` must not fail. A real change made the wrong way is reverted
-- and the function's result is the only thing that ever reports success.
--
-- The writer role is exempt because that is the function's own identity.
create or replace function public.theme_contributions_v2_pin_audience()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
BEGIN
  IF current_user = 'tesseract_audience_writer' THEN
    RETURN NEW;
  END IF;
  NEW.visibility := OLD.visibility;
  RETURN NEW;
END $function$;

drop trigger if exists a_pin_audience on public.theme_contributions_v2;
-- Named to sort first, as on asset_contributions: BEFORE triggers fire in
-- name order, and the pin has to win over anything that edits the row later.
create trigger a_pin_audience
  before update on public.theme_contributions_v2
  for each row execute function public.theme_contributions_v2_pin_audience();
