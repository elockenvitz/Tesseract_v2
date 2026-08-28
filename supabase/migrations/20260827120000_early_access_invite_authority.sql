-- ============================================================================
-- Early Access — invitation authority moves to the platform-admin boundary
-- ============================================================================
--
-- Tesseract is invitation-only Professional Early Access. The founder creates
-- pilot access from the Ops portal and sends the recipient a link. Nobody else
-- may bring a new person into the product.
--
-- Before this migration the database did not enforce that. `create_org_invite`
-- authorized on "active org admin of the target organization", and
-- `bootstrap_organization` authorized on "is authenticated". Together those two
-- facts formed a complete self-service escalation path:
--
--     open signup  ->  bootstrap_organization()  ->  admin of a brand-new org
--                  ->  create_org_invite()       ->  invite anyone, as admin
--                  ->  invitee repeats the chain
--
-- and it was reachable entirely through the public PostgREST surface, with no
-- UI involved. 22 of the 24 pilots with an active membership are org admins of
-- their own org, so in practice nearly every pilot held invitation authority.
--
-- The fix is to state the business rule once, at the trusted boundary:
--
--     can_invite_members()  ->  is_platform_admin()
--
-- `can_invite_members()` is deliberately a separate function from
-- `is_platform_admin()` even though it currently only delegates to it. It is
-- the seam a future entitlement layer replaces (Pro: none; Team: workspace
-- admins; Enterprise: admin-provisioned) without having to re-audit every call
-- site. Nothing downstream may assume "org admin => may invite".
--
-- Three layers, matching the P0 users-authority pattern already in this repo:
--
--   A. RPC authorization  — every invite-creating function checks
--                           can_invite_members() before it writes.
--   B. Privilege          — `authenticated` loses INSERT/UPDATE/DELETE on
--                           organization_invites entirely, and loses SELECT on
--                           the `token` column. All writes go through
--                           SECURITY DEFINER functions; `anon` loses the table.
--   C. Policy             — the org-admin INSERT/UPDATE/DELETE policies are
--                           removed rather than left dormant behind Layer B,
--                           so a future re-GRANT does not silently reopen them.
--
-- One incidental correction. The old authorization failure raised SQLSTATE
-- P0004, which is PL/pgSQL's reserved `assert_failure` — the one code, along
-- with query_canceled, that `EXCEPTION WHEN OTHERS` is documented NOT to catch.
-- An authorization refusal that no caller can trap is a bad primitive, and it
-- made the security suite itself unwritable. Early Access refusals now raise
-- P0042 (invitation authority) and P0043 (organization creation), which are
-- unused, catchable, and adjacent to the existing P0040/P0041 platform-admin
-- codes in grant_temporary_org_membership.
--
-- ============================================================================


-- -- 1. The entitlement seam --------------------------------------------------
--
-- For Early Access this resolves for platform administrators only. When
-- entitlements land, this body is the only thing that changes.

CREATE OR REPLACE FUNCTION public.can_invite_members()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  -- Early Access: invitation authority is platform-controlled. Organization
  -- admin status alone grants nothing here, by design.
  SELECT public.is_platform_admin();
$fn$;

COMMENT ON FUNCTION public.can_invite_members() IS
  'Early Access invitation authority. Resolves only for platform admins. This is the seam a future entitlement layer replaces - do not inline is_platform_admin() at invite call sites.';

REVOKE ALL ON FUNCTION public.can_invite_members() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_invite_members() FROM anon;
GRANT EXECUTE ON FUNCTION public.can_invite_members() TO authenticated, service_role;


-- -- 2. create_org_invite — platform admins only -----------------------------
--
-- Two changes beyond the authorization swap:
--
--   * The "does this person already have an account?" lookup moves from
--     public.users to auth.users. public.users.email is client-writable (the
--     app syncs it on login), so matching on it let any authenticated user
--     point an invitation's pre-created membership at themselves by claiming
--     someone else's address on their own profile row.
--
--   * `p_preassignments` becomes a parameter. It used to be applied by a
--     follow-up UPDATE from the browser, which Layer B now forbids — and that
--     UPDATE never worked anyway: it keyed off `data.id` while the function
--     returns `invite_id`, so org-node and portfolio preassignments have been
--     silently dropped on every invite created from the People tab.
--
-- The old 3-argument signature is dropped rather than overloaded; keeping both
-- would make the existing 2-argument call sites ambiguous.

DROP FUNCTION IF EXISTS public.create_org_invite(uuid, text, boolean);

CREATE OR REPLACE FUNCTION public.create_org_invite(
  p_organization_id uuid,
  p_email text,
  p_is_org_admin boolean DEFAULT false,
  p_preassignments jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_caller_uid uuid := auth.uid();
  v_invite_id uuid;
  v_token uuid;
  v_email text := lower(btrim(p_email));
  v_existing_user_id uuid;
  v_existing_membership_id uuid;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  -- Early Access: invitation authority is platform-controlled. Org admin
  -- status is deliberately not consulted.
  IF NOT public.can_invite_members() THEN
    RAISE EXCEPTION 'Not authorized: invitations are created by Tesseract platform administrators during Early Access'
      USING ERRCODE = 'P0042';
  END IF;

  IF v_email IS NULL OR v_email !~ '^[^@\s,]+@[^@\s,]+\.[^@\s,]+$' THEN
    RAISE EXCEPTION 'Invalid email address: "%"', p_email USING ERRCODE = 'P0023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = p_organization_id) THEN
    RAISE EXCEPTION 'Organization not found' USING ERRCODE = 'P0002';
  END IF;

  -- Identity comes from auth.users — the address the person actually
  -- authenticates with — never from the client-writable profile row.
  SELECT id INTO v_existing_user_id
  FROM auth.users
  WHERE lower(email) = v_email
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_existing_user_id IS NOT NULL THEN
    SELECT id INTO v_existing_membership_id
    FROM organization_memberships
    WHERE organization_id = p_organization_id
      AND user_id = v_existing_user_id
      AND status = 'active';

    IF v_existing_membership_id IS NOT NULL THEN
      RAISE EXCEPTION 'User is already an active member of this organization'
        USING ERRCODE = 'P0020';
    END IF;
  END IF;

  INSERT INTO organization_invites (
    organization_id, email, invited_by, invited_is_org_admin, preassignments
  )
  VALUES (p_organization_id, v_email, v_caller_uid, p_is_org_admin, p_preassignments)
  RETURNING id, token INTO v_invite_id, v_token;

  IF v_existing_user_id IS NOT NULL THEN
    INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin)
    VALUES (p_organization_id, v_existing_user_id, 'invited', p_is_org_admin)
    ON CONFLICT (organization_id, user_id) DO UPDATE
      SET status = 'invited',
          is_org_admin = p_is_org_admin
      WHERE organization_memberships.status IN ('inactive');
  END IF;

  -- The token is the invitation secret; it stays out of the audit trail.
  INSERT INTO organization_audit_log
    (organization_id, actor_id, action, target_type, target_id, details)
  VALUES (
    p_organization_id, v_caller_uid, 'invite.created', 'invite', v_invite_id,
    jsonb_build_object(
      'email', v_email,
      'invited_is_org_admin', p_is_org_admin,
      'preassignments', p_preassignments
    )
  );

  RETURN jsonb_build_object(
    'invite_id', v_invite_id,
    'token', v_token,
    'email', v_email,
    'existing_user', v_existing_user_id IS NOT NULL
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.create_org_invite(uuid, text, boolean, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_org_invite(uuid, text, boolean, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_org_invite(uuid, text, boolean, jsonb) TO authenticated, service_role;


-- -- 3. revoke_org_invite — platform admins only -----------------------------
--
-- Replaces the browser's direct `UPDATE organization_invites SET status =
-- 'cancelled'`, which Layer B now forbids. `revoked_at` / `revoked_by` have
-- existed on the table since it was created and were never written; a revoked
-- invite was indistinguishable from one cancelled by mistake, and
-- accept_org_invite never consulted them at all.
--
-- Status stays within the existing chk_invite_status vocabulary ('cancelled');
-- the revocation stamp is what acceptance checks.

CREATE OR REPLACE FUNCTION public.revoke_org_invite(p_invite_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_caller_uid uuid := auth.uid();
  v_invite RECORD;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.can_invite_members() THEN
    RAISE EXCEPTION 'Not authorized: invitations are managed by Tesseract platform administrators during Early Access'
      USING ERRCODE = 'P0042';
  END IF;

  SELECT * INTO v_invite FROM organization_invites WHERE id = p_invite_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite not found' USING ERRCODE = 'P0002';
  END IF;

  -- Idempotent: revoking an already-revoked invite is a no-op success.
  IF v_invite.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('invite_id', p_invite_id, 'status', 'cancelled', 'already_revoked', true);
  END IF;

  IF v_invite.status = 'accepted' THEN
    RAISE EXCEPTION 'Invite has already been accepted; remove the membership instead'
      USING ERRCODE = 'P0024';
  END IF;

  UPDATE organization_invites
  SET status = 'cancelled', revoked_at = now(), revoked_by = v_caller_uid
  WHERE id = p_invite_id;

  INSERT INTO organization_audit_log
    (organization_id, actor_id, action, target_type, target_id, details)
  VALUES (
    v_invite.organization_id, v_caller_uid, 'invite.revoked', 'invite', p_invite_id,
    jsonb_build_object('email', v_invite.email)
  );

  RETURN jsonb_build_object('invite_id', p_invite_id, 'status', 'cancelled', 'already_revoked', false);
END;
$fn$;

REVOKE ALL ON FUNCTION public.revoke_org_invite(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_org_invite(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.revoke_org_invite(uuid) TO authenticated, service_role;


-- -- 4. get_org_invite_link — platform admins only ---------------------------
--
-- The Ops portal has to be able to hand the founder a link to send. Layer B
-- takes the `token` column away from every client role, so this is the only
-- way back to it, and it is gated on the same authority as creating one.

CREATE OR REPLACE FUNCTION public.get_org_invite_link(p_invite_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_invite RECORD;
BEGIN
  IF NOT public.can_invite_members() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = 'P0042';
  END IF;

  SELECT i.id, i.token, i.email, i.status, i.expires_at, i.revoked_at, o.name AS org_name
    INTO v_invite
  FROM organization_invites i
  JOIN organizations o ON o.id = i.organization_id
  WHERE i.id = p_invite_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'invite_id',   v_invite.id,
    'token',       v_invite.token,
    'email',       v_invite.email,
    'status',      v_invite.status,
    'expires_at',  v_invite.expires_at,
    'revoked_at',  v_invite.revoked_at,
    'org_name',    v_invite.org_name
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_org_invite_link(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_org_invite_link(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_org_invite_link(uuid) TO authenticated, service_role;


-- -- 5. get_invite_preview — the only pre-auth read of an invitation ---------
--
-- Backs the /invite/:token landing page, which has to render something useful
-- to someone who is not signed in yet. It returns the minimum needed to do
-- that and nothing else: no invited_by, no preassignments, and in particular
-- no `invited_is_org_admin` — a recipient does not need to know their role
-- before they accept, and an attacker holding a leaked token should not learn
-- which invitations are worth attacking.
--
-- The invited address IS returned for a valid invite. The token is 122 bits of
-- gen_random_uuid() entropy delivered to that mailbox; anyone holding it can
-- already read the mail it arrived in, so echoing the address back discloses
-- nothing new and lets the page tell the recipient which account to use.
--
-- Invalid tokens return a uniform `valid: false` with a coarse reason.

CREATE OR REPLACE FUNCTION public.get_invite_preview(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_invite RECORD;
BEGIN
  SELECT i.email, i.status, i.expires_at, i.revoked_at, i.accepted_by, o.name AS org_name
    INTO v_invite
  FROM organization_invites i
  JOIN organizations o ON o.id = i.organization_id
  WHERE i.token = p_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'not_found');
  END IF;

  IF v_invite.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'revoked');
  END IF;

  IF v_invite.status = 'accepted' THEN
    RETURN jsonb_build_object(
      'valid', false,
      'reason', 'already_accepted',
      'org_name', v_invite.org_name,
      -- Lets the page say "you already joined" instead of a dead end, but only
      -- to the person who actually accepted it.
      'accepted_by_you', v_invite.accepted_by IS NOT DISTINCT FROM auth.uid()
    );
  END IF;

  IF v_invite.status NOT IN ('pending', 'sent') THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'revoked');
  END IF;

  IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at < now() THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'expired', 'org_name', v_invite.org_name);
  END IF;

  RETURN jsonb_build_object(
    'valid',     true,
    'email',     v_invite.email,
    'org_name',  v_invite.org_name
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_invite_preview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invite_preview(uuid) TO anon, authenticated, service_role;


-- -- 6. Layer B — take the write surface away from client roles --------------
--
-- Postgres has no way to subtract a column from a table-level SELECT grant, so
-- the grant is dropped and re-issued column by column, minus `token`. This is
-- the same shape as the P0 users-authority migration.

REVOKE ALL ON TABLE public.organization_invites FROM anon;
REVOKE ALL ON TABLE public.organization_invites FROM authenticated;

GRANT SELECT (
  id, organization_id, email, invited_by, status, created_at, expires_at,
  accepted_at, accepted_by, invited_is_org_admin, revoked_at, revoked_by,
  preassignments
) ON public.organization_invites TO authenticated;

-- `anon` keeps nothing. The pre-auth landing page reads through
-- get_invite_preview(), which is SECURITY DEFINER.


-- -- 7. Layer C — remove the org-admin write policies -------------------------
--
-- Dropped rather than left in place behind Layer B: a dormant policy that says
-- "org admins may create invites" is a loaded gun pointed at the next person
-- who re-grants INSERT on this table.

DROP POLICY IF EXISTS "Org admins can create invites in current org" ON public.organization_invites;
DROP POLICY IF EXISTS "Org admins can delete invites in current org" ON public.organization_invites;
DROP POLICY IF EXISTS "Org admins or invited user can update invites in current org" ON public.organization_invites;

-- Read stays: the People tab and the Ops portal both list pending invites, and
-- neither can reach the token column any more.
DROP POLICY IF EXISTS "Org admins can view invites in current org" ON public.organization_invites;
CREATE POLICY "Org admins can view invites in current org"
  ON public.organization_invites FOR SELECT
  TO authenticated
  USING (organization_id = current_org_id() AND is_active_org_admin_of_current_org());

DROP POLICY IF EXISTS "Platform admins can view all invites" ON public.organization_invites;
CREATE POLICY "Platform admins can view all invites"
  ON public.organization_invites FOR SELECT
  TO authenticated
  USING (is_platform_admin());


-- -- 8. Memberships may not be created around the invitation ------------------
--
-- The invite path is worth nothing if an org admin can simply INSERT the
-- membership row the invite would have produced. No application code has ever
-- used this policy — every membership is written by a SECURITY DEFINER
-- function — so removing it costs nothing and closes the bypass.

DROP POLICY IF EXISTS "Org admins can insert memberships in current org" ON public.organization_memberships;

DROP POLICY IF EXISTS "Platform admins can insert memberships" ON public.organization_memberships;
CREATE POLICY "Platform admins can insert memberships"
  ON public.organization_memberships FOR INSERT
  TO authenticated
  WITH CHECK (is_platform_admin());

REVOKE INSERT, UPDATE, DELETE ON TABLE public.organization_memberships FROM anon;


-- -- 9. bootstrap_organization — the invite-only rule at the boundary ---------
--
-- The route that called this was removed from App.tsx ("org creation is
-- invite-only"), but the EXECUTE grant to `authenticated` was left behind, so
-- the rule lived only in the router. One PostgREST call created an
-- organization and made the caller its admin — which, before section 2, also
-- made them able to invite.
--
-- Preserved for platform admins and service_role, which is how legitimate
-- organizations are created (Ops -> provision_client_org, and this for the
-- rare hand-built case).

CREATE OR REPLACE FUNCTION public.bootstrap_organization(
  p_name text,
  p_slug text,
  p_description text DEFAULT NULL::text,
  p_logo_url text DEFAULT NULL::text,
  p_seed_defaults boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_membership_id uuid;
  v_team_id uuid;
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  -- Early Access: workspace creation is platform-controlled, exactly like
  -- invitation creation. There is no self-service path.
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized: organization creation is platform-controlled during Early Access'
      USING ERRCODE = 'P0043';
  END IF;

  IF p_slug !~ '^[a-z0-9][a-z0-9\-]{1,48}[a-z0-9]$' THEN
    RAISE EXCEPTION 'Invalid slug format. Use lowercase letters, numbers, and hyphens (3-50 chars).'
      USING ERRCODE = 'P0010';
  END IF;

  IF EXISTS (SELECT 1 FROM organizations WHERE slug = p_slug) THEN
    RAISE EXCEPTION 'Organization slug already taken' USING ERRCODE = 'P0011';
  END IF;

  INSERT INTO organizations (name, slug, description, logo_url)
  VALUES (p_name, p_slug, p_description, p_logo_url)
  RETURNING id INTO v_org_id;

  INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin)
  VALUES (v_org_id, v_user_id, 'active', true)
  RETURNING id INTO v_membership_id;

  UPDATE users SET current_organization_id = v_org_id WHERE id = v_user_id;

  IF p_seed_defaults THEN
    INSERT INTO teams (organization_id, name, slug, description, color, icon)
    VALUES (v_org_id, 'General', p_slug || '-general', 'Default team', '#6366f1', 'users')
    RETURNING id INTO v_team_id;

    INSERT INTO team_memberships (team_id, user_id, is_team_admin)
    VALUES (v_team_id, v_user_id, true);

    INSERT INTO research_sections (organization_id, name, description, sort_order, is_active)
    VALUES
      (v_org_id, 'Investment Thesis',      'Core investment thesis and rationale', 1, true),
      (v_org_id, 'Key Risks',              'Material risks and mitigants', 2, true),
      (v_org_id, 'Catalysts',              'Near-term catalysts and timeline', 3, true),
      (v_org_id, 'Valuation',              'Valuation framework and targets', 4, true),
      (v_org_id, 'Management & Governance','Management quality and corporate governance', 5, true);

    INSERT INTO coverage_roles (organization_id, name, description, sort_order)
    VALUES
      (v_org_id, 'Lead Analyst',   'Primary coverage responsibility', 1),
      (v_org_id, 'Backup Analyst', 'Secondary coverage', 2),
      (v_org_id, 'PM Oversight',   'Portfolio manager oversight', 3);

    INSERT INTO user_role_definitions (organization_id, role_key, label, description, sort_order)
    VALUES
      (v_org_id, 'portfolio_manager', 'Portfolio Manager', 'Manages portfolio allocations', 1),
      (v_org_id, 'analyst',           'Research Analyst',  'Covers securities and writes research', 2),
      (v_org_id, 'trader',            'Trader',            'Executes trades', 3),
      (v_org_id, 'operations',        'Operations',        'Back-office and compliance', 4);
  END IF;

  INSERT INTO organization_audit_log (organization_id, actor_id, action, target_type, details)
  VALUES (v_org_id, v_user_id, 'organization.created', 'organization',
    jsonb_build_object('name', p_name, 'slug', p_slug, 'seed_defaults', p_seed_defaults));

  v_result := jsonb_build_object(
    'organization_id', v_org_id,
    'membership_id', v_membership_id,
    'slug', p_slug,
    'seed_defaults', p_seed_defaults
  );

  IF p_seed_defaults THEN
    v_result := v_result || jsonb_build_object('default_team_id', v_team_id);
  END IF;

  RETURN v_result;
END;
$fn$;

REVOKE ALL ON FUNCTION public.bootstrap_organization(text, text, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bootstrap_organization(text, text, text, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_organization(text, text, text, text, boolean) TO authenticated, service_role;


-- -- 10. provision_client_org — same identity fix ----------------------------
--
-- Already platform-admin gated, and it stays the founder's canonical path. The
-- one change is the existing-user lookup, which had the same public.users.email
-- weakness as create_org_invite: a user who set someone else's address on their
-- own profile row would have been handed an ACTIVE ORG ADMIN membership of the
-- next organization provisioned for that address.
--
-- The invite it creates keeps expires_at = NULL (pilot invites do not expire —
-- see 20260615220000_pilot_invites_no_expiry.sql), and the token now comes back
-- in the result so Ops can render a copyable link at the moment of provisioning.

CREATE OR REPLACE FUNCTION public.provision_client_org(
  p_name text,
  p_slug text,
  p_admin_email text,
  p_settings jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_org_id UUID;
  v_admin_user_id UUID;
  v_invite_id UUID;
  v_invite_token UUID;
  v_provisioner_id UUID := auth.uid();
  v_normalized_email TEXT := lower(btrim(p_admin_email));
  v_result JSONB;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Access denied: only platform admins can provision organizations';
  END IF;

  IF v_normalized_email IS NULL
     OR v_normalized_email !~ '^[^@\s,]+@[^@\s,]+\.[^@\s,]+$' THEN
    RAISE EXCEPTION 'Invalid admin email format: "%"', p_admin_email;
  END IF;

  IF EXISTS (SELECT 1 FROM organizations WHERE slug = p_slug) THEN
    RAISE EXCEPTION 'Organization slug "%" already exists', p_slug;
  END IF;

  INSERT INTO organizations (name, slug, settings, onboarding_policy)
  VALUES (p_name, p_slug, p_settings, 'invite_only')
  RETURNING id INTO v_org_id;

  INSERT INTO organization_governance (organization_id)
  VALUES (v_org_id)
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO org_onboarding_status (organization_id)
  VALUES (v_org_id)
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO rating_scales (name, description, organization_id, values)
  VALUES (
    'Default Rating Scale',
    'Standard 5-point rating scale',
    v_org_id,
    '[
      {"value": "1", "label": "Strong Buy", "color": "#10b981", "sort": 1},
      {"value": "2", "label": "Buy", "color": "#34d399", "sort": 2},
      {"value": "3", "label": "Neutral", "color": "#9ca3af", "sort": 3},
      {"value": "4", "label": "Sell", "color": "#f87171", "sort": 4},
      {"value": "5", "label": "Strong Sell", "color": "#ef4444", "sort": 5}
    ]'::jsonb
  );

  PERFORM seed_default_research_catalog(v_org_id);

  -- Identity from auth.users, not the client-writable profile row.
  SELECT id INTO v_admin_user_id
  FROM auth.users
  WHERE lower(email) = v_normalized_email
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_admin_user_id IS NOT NULL THEN
    INSERT INTO organization_memberships (user_id, organization_id, is_org_admin, status)
    VALUES (v_admin_user_id, v_org_id, true, 'active')
    ON CONFLICT (user_id, organization_id) DO UPDATE
      SET is_org_admin = true, status = 'active';
  ELSE
    INSERT INTO organization_invites (
      organization_id, email, invited_by, invited_is_org_admin, status, expires_at
    ) VALUES (
      v_org_id, v_normalized_email, v_provisioner_id, true, 'pending', NULL
    )
    RETURNING id, token INTO v_invite_id, v_invite_token;
  END IF;

  INSERT INTO audit_events (
    actor_id, actor_type, entity_type, entity_id,
    action_type, action_category, to_state, metadata,
    org_id, checksum
  ) VALUES (
    v_provisioner_id, 'user', 'organization', v_org_id,
    'provision', 'lifecycle', '"active"'::jsonb,
    jsonb_build_object(
      'org_name', p_name,
      'org_slug', p_slug,
      'admin_email', v_normalized_email,
      'admin_user_id', v_admin_user_id,
      'invite_id', v_invite_id,
      'provisioner_enrolled', false
    ),
    v_org_id,
    encode(sha256(convert_to(v_org_id::text || '-provision-' || now()::text, 'UTF8')), 'hex')
  );

  -- The token is returned so Ops can render a copyable invite link at the
  -- moment of provisioning; it is not written to the audit record.
  v_result := jsonb_build_object(
    'organization_id', v_org_id,
    'name', p_name,
    'slug', p_slug,
    'admin_user_id', v_admin_user_id,
    'admin_invited', v_admin_user_id IS NULL,
    'invite_id', v_invite_id,
    'invite_token', v_invite_token,
    'provisioner_enrolled', false
  );

  RETURN v_result;
END;
$fn$;

REVOKE ALL ON FUNCTION public.provision_client_org(text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provision_client_org(text, text, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.provision_client_org(text, text, text, jsonb) TO authenticated, service_role;
