-- ============================================================================
-- P0 — Layer C: a database guard on authority-bearing user columns
-- ============================================================================
--
-- Layer B removes the privilege. This layer removes the *possibility*, so that
-- re-adding a broad grant — a future migration, a Supabase dashboard click, a
-- restored backup with older ACLs — does not silently reopen the bypass. It
-- also closes the one hole Layer B cannot: `coverage_admin` must stay
-- client-writable for the org-admin UI, and no column grant can distinguish
-- "an admin setting it on a member" from "a user setting it on themselves".
--
-- ── The trap this design is built around ──────────────────────────────────
--
-- The obvious trigger — "reject any change to current_organization_id unless
-- auth.uid() is an active member of the new value" — BREAKS PRODUCTION. Six
-- legitimate writers set that column, and two of them deliberately set an org
-- the caller is not a member of:
--
--   set_current_org(p_org_id)          validates the CALLER's membership   ok
--   morph_restore_org(p_org_id)        validates the CALLER's membership   ok
--   morph_switch_org(p_org_id)         validates the MORPH TARGET's        ✗
--                                      membership — a platform admin
--                                      morphing is almost never a member
--   maintain_current_org_on_membership_change()
--                                      trigger; rewrites ANOTHER user's    ✗
--                                      row when their membership is
--                                      deactivated
--   erase_user_personal_data()         sets it NULL on another user's row  ✗
--   auto_accept_pending_invites(),     set it for auth.uid() right after
--   bootstrap_organization()           creating the membership             ok
--
-- A naive membership check would have blocked morphing, membership
-- administration and GDPR erasure.
--
-- ── How privileged writers are distinguished ──────────────────────────────
--
-- Every one of those six is SECURITY DEFINER and owned by `postgres`, so
-- inside them `current_user` is `postgres`. A direct PostgREST write arrives
-- with `current_user` set to `authenticated` (or `anon`), because that is the
-- role PostgREST assumes per request.
--
-- So the guard polices exactly the client roles and stands aside for everyone
-- else. That is why the trigger function is SECURITY INVOKER — as DEFINER,
-- `current_user` would always read `postgres` and the guard would never fire.
-- The membership lookup it needs is delegated to a small SECURITY DEFINER
-- helper instead, so RLS on `organization_memberships` cannot hide a row and
-- cause a false rejection.
--
-- The privileged set is a named, auditable list rather than "not
-- authenticated": `service_role` is enumerated explicitly so that granting the
-- guard an exemption is a visible act in this file, not an accident of
-- whichever role happens to be connected.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Membership lookup, RLS-free.
--
-- SECURITY DEFINER because the guard runs as the client role, and
-- `organization_memberships` is itself org-scoped — a caller who has just been
-- moved out of an org may not be able to SEE the row that proves they no
-- longer belong. Reading it as the owner makes the answer about the data
-- rather than about the reader's current visibility.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_has_active_membership(p_user_id uuid, p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organization_memberships om
    WHERE om.user_id = p_user_id
      AND om.organization_id = p_org_id
      AND om.status = 'active'
      AND (om.expires_at IS NULL OR om.expires_at > now())
  );
$$;

COMMENT ON FUNCTION public.user_has_active_membership(uuid, uuid) IS
  'Whether a user currently holds an active, unexpired membership of an org. '
  'RLS-free by design so the authority guard cannot be defeated by a caller '
  'who can no longer see the membership row. See migration 20260826100200.';

REVOKE ALL ON FUNCTION public.user_has_active_membership(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_has_active_membership(uuid, uuid)
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- The guard.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_user_authority_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER          -- load-bearing: see the header. DEFINER would make
SET search_path = public  -- current_user always 'postgres' and never fire.
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  -- Privileged writers pass straight through. `postgres` covers every
  -- SECURITY DEFINER function and every trigger they fire; `service_role` is
  -- the trusted backend key; `supabase_admin` covers platform maintenance.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  -- ── current_organization_id ──────────────────────────────────────────────
  -- Validated against the membership of the ROW'S OWNER rather than of the
  -- actor. For a client write the two are the same (RLS confines you to your
  -- own row), and stating the invariant this way keeps it true even if a
  -- future policy widens which rows a client may touch.
  --
  -- NULL is always allowed: it grants nothing, and it is how a user with no
  -- remaining membership is represented.
  IF TG_OP = 'INSERT' THEN
    IF NEW.current_organization_id IS NOT NULL
       AND NOT public.user_has_active_membership(NEW.id, NEW.current_organization_id)
    THEN
      RAISE EXCEPTION
        'current_organization_id must reference an organization you are an active member of'
        USING ERRCODE = 'P0031';
    END IF;
  ELSIF NEW.current_organization_id IS DISTINCT FROM OLD.current_organization_id THEN
    IF NEW.current_organization_id IS NOT NULL
       AND NOT public.user_has_active_membership(NEW.id, NEW.current_organization_id)
    THEN
      RAISE EXCEPTION
        'current_organization_id must reference an organization you are an active member of'
        USING ERRCODE = 'P0031';
    END IF;
  END IF;

  -- ── coverage_admin ───────────────────────────────────────────────────────
  -- Mirrors the existing `Org admins can update coverage_admin for org
  -- members` policy so the OrganizationPage flow is untouched, and closes the
  -- gap that policy cannot: `Users can update their own profile` would
  -- otherwise let anyone grant themselves the flag on their own row.
  IF TG_OP = 'UPDATE' AND NEW.coverage_admin IS DISTINCT FROM OLD.coverage_admin THEN
    IF NOT EXISTS (
      SELECT 1
      FROM organization_memberships actor
      JOIN organization_memberships subject
        ON subject.organization_id = actor.organization_id
      WHERE actor.user_id = v_actor
        AND actor.is_org_admin = true
        AND actor.status = 'active'
        AND subject.user_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'coverage_admin may only be changed by an org admin of a shared organization'
        USING ERRCODE = 'P0032';
    END IF;
  END IF;

  -- ── flags no client writes ───────────────────────────────────────────────
  -- Layer B already withholds these columns. Restated here so that the
  -- invariant survives a re-grant, and so the failure is a named error rather
  -- than a privilege message.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      RAISE EXCEPTION 'is_active is not client-writable' USING ERRCODE = 'P0033';
    END IF;
    IF NEW.is_pilot_user IS DISTINCT FROM OLD.is_pilot_user THEN
      RAISE EXCEPTION 'is_pilot_user is not client-writable' USING ERRCODE = 'P0033';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_user_authority_columns() IS
  'Rejects client-role writes to authority-bearing columns of public.users. '
  'Stands aside for postgres/service_role so SECURITY DEFINER flows '
  '(set_current_org, morph_switch_org, membership maintenance, erasure) are '
  'unaffected. See migration 20260826100200.';

DROP TRIGGER IF EXISTS trg_enforce_user_authority_columns ON public.users;
CREATE TRIGGER trg_enforce_user_authority_columns
  BEFORE INSERT OR UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.enforce_user_authority_columns();
