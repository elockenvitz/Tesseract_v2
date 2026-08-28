-- ============================================================================
-- Early Access — the remaining two paths that could mint a membership
-- ============================================================================
--
-- The companion migrations closed invitation creation, invitation acceptance
-- and organization creation. Two doors were still standing, both of them
-- SECURITY DEFINER and both reachable from the browser.
--
-- 1. `route_org_for_email(p_email text)` — granted to `anon` AND
--    `authenticated`, and it takes the address to route on as an ARGUMENT.
--    Nothing checked that argument against the caller's own identity. Given a
--    verified row in `organization_domains` pointing at an organization whose
--    `onboarding_policy` is 'open', any authenticated user could name that
--    domain and be INSERTed into the organization as an active member — not
--    "routed by their own email", but routed by whatever domain they cared to
--    type. With 'approval_required' it created an access_request plus a
--    'pending' membership row, which is the same door with a bell on it.
--
--    It also answered `anon`. With no `auth.uid()` the membership INSERT would
--    have failed, but the *lookup* still succeeded, so an unauthenticated
--    caller could map any domain to an organization's id and name.
--
-- 2. `approve_org_join_request()` — authorized on "active org admin of the
--    organization", and its approve branch INSERTs an active membership. An
--    org admin approving someone into their workspace is exactly the authority
--    Early Access says org admins do not have.
--
-- Neither is exploitable in production as it stands: `organization_domains`
-- holds 0 rows, all 27 organizations are `invite_only`, and `access_requests`
-- is empty. That is the entire reason this is a migration and not an incident.
-- But "safe because a table is empty" is a configuration, not a control —
-- inserting one domain row, or flipping one `onboarding_policy`, would have
-- silently restored self-service membership with no code change and no review.
--
-- ── What this does NOT do ──────────────────────────────────────────────────
--
-- The domain-routing architecture is kept intact, because it is the right
-- shape for entitlement-controlled onboarding later: a Team or Enterprise
-- workspace that verifies its domain and admits its own staff is a feature,
-- not a bug. What changes is that the branches which GRANT something now ask
-- the same question the rest of Early Access asks:
--
--     can_invite_members()  ->  is_platform_admin()
--
-- rather than introducing a second authority model. The read-only branches —
-- "you already belong to exactly one organization, switch to it" — are
-- untouched, because they grant nothing and every existing pilot's login
-- depends on them.
--
-- ============================================================================


-- -- 1. route_org_for_email ---------------------------------------------------
--
-- Three changes:
--
--   * Identity is the caller's, not the caller's argument. `p_email` is kept
--     in the signature so the deployed frontend keeps working, but it is now
--     checked against `auth.users.email` and a mismatch is refused rather than
--     honoured. Ignoring it silently would have worked too; refusing makes the
--     tampering visible and gives the security suite something to assert.
--
--   * The two granting branches require can_invite_members(). During Early
--     Access that is false for everyone but platform staff, so 'open' and
--     'approval_required' both fall through to blocked — with a distinct
--     reason, so the UI can say why rather than showing a generic dead end.
--
--   * `anon` loses EXECUTE. It could never obtain a membership, but it could
--     enumerate domain -> organization, and it has no reason to call this.

CREATE OR REPLACE FUNCTION public.route_org_for_email(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_caller_uid uuid := auth.uid();
  v_caller_email text;
  v_domain text;
  v_active_memberships int;
  v_single_org_id uuid;
  v_domain_org_id uuid;
  v_org_name text;
  v_policy text;
  v_is_member boolean;
BEGIN
  IF v_caller_uid IS NULL THEN
    RETURN jsonb_build_object('org_id', null, 'action', 'blocked', 'reason', 'not_authenticated');
  END IF;

  SELECT lower(email) INTO v_caller_email FROM auth.users WHERE id = v_caller_uid;
  IF v_caller_email IS NULL THEN
    RETURN jsonb_build_object('org_id', null, 'action', 'blocked', 'reason', 'not_authenticated');
  END IF;

  -- The argument is advisory. It must agree with the authenticated identity;
  -- routing is then done on the identity, never on the argument.
  IF p_email IS NOT NULL AND lower(btrim(p_email)) IS DISTINCT FROM v_caller_email THEN
    RETURN jsonb_build_object('org_id', null, 'action', 'blocked', 'reason', 'identity_mismatch');
  END IF;

  v_domain := lower(split_part(v_caller_email, '@', 2));
  IF v_domain = '' OR v_domain IS NULL THEN
    RETURN jsonb_build_object('org_id', null, 'action', 'blocked', 'reason', 'invalid_email');
  END IF;

  -- ── Read-only: exactly one active membership, switch to it ───────────────
  -- Grants nothing. Every existing pilot's login resolves through here.
  SELECT count(*) INTO v_active_memberships
  FROM organization_memberships
  WHERE user_id = v_caller_uid
    AND status = 'active'
    AND (expires_at IS NULL OR expires_at > now());

  IF v_active_memberships = 1 THEN
    SELECT organization_id INTO v_single_org_id
    FROM organization_memberships
    WHERE user_id = v_caller_uid
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > now())
    LIMIT 1;

    SELECT name INTO v_org_name FROM organizations WHERE id = v_single_org_id;
    RETURN jsonb_build_object(
      'org_id', v_single_org_id,
      'org_name', v_org_name,
      'action', 'switch',
      'reason', 'single_membership'
    );
  END IF;

  -- ── Verified domain match ────────────────────────────────────────────────
  SELECT od.organization_id INTO v_domain_org_id
  FROM organization_domains od
  WHERE od.domain = v_domain AND od.status = 'verified'
  LIMIT 1;

  IF v_domain_org_id IS NULL THEN
    RETURN jsonb_build_object('org_id', null, 'action', 'blocked', 'reason', 'no_match');
  END IF;

  SELECT name INTO v_org_name FROM organizations WHERE id = v_domain_org_id;

  -- Already a member: read-only switch, no grant.
  SELECT EXISTS (
    SELECT 1 FROM organization_memberships
    WHERE user_id = v_caller_uid
      AND organization_id = v_domain_org_id
      AND status = 'active'
  ) INTO v_is_member;

  IF v_is_member THEN
    RETURN jsonb_build_object(
      'org_id', v_domain_org_id,
      'org_name', v_org_name,
      'action', 'switch',
      'reason', 'domain_match'
    );
  END IF;

  SELECT onboarding_policy INTO v_policy FROM organizations WHERE id = v_domain_org_id;

  -- ── Everything below this line creates something ─────────────────────────
  --
  -- One gate for both policies. When entitlements arrive, the body of
  -- can_invite_members() changes and self-service domain onboarding comes back
  -- on for the tiers that have paid for it — this function does not.
  IF v_policy IN ('open', 'approval_required') AND NOT public.can_invite_members() THEN
    RETURN jsonb_build_object(
      'org_id', v_domain_org_id,
      'org_name', v_org_name,
      'action', 'blocked',
      'reason', 'early_access_invite_only'
    );
  END IF;

  IF v_policy = 'open' THEN
    INSERT INTO organization_memberships (user_id, organization_id, status, role)
    VALUES (v_caller_uid, v_domain_org_id, 'active', 'member')
    ON CONFLICT (organization_id, user_id) DO UPDATE
    SET status = 'active';

    INSERT INTO organization_audit_log (organization_id, actor_id, action, target_type, target_id, details)
    VALUES (v_domain_org_id, v_caller_uid, 'member.auto_joined', 'user', v_caller_uid,
      jsonb_build_object('reason', 'domain_match', 'domain', v_domain));

    RETURN jsonb_build_object(
      'org_id', v_domain_org_id,
      'org_name', v_org_name,
      'action', 'auto_join',
      'reason', 'domain_match'
    );
  END IF;

  IF v_policy = 'approval_required' THEN
    INSERT INTO access_requests (organization_id, requester_id, request_type, reason, status)
    VALUES (v_domain_org_id, v_caller_uid, 'join_org', 'Domain match: ' || v_domain, 'pending')
    ON CONFLICT DO NOTHING;

    INSERT INTO organization_memberships (user_id, organization_id, status, role)
    VALUES (v_caller_uid, v_domain_org_id, 'pending', 'member')
    ON CONFLICT (organization_id, user_id) DO NOTHING;

    INSERT INTO organization_audit_log (organization_id, actor_id, action, target_type, target_id, details)
    VALUES (v_domain_org_id, v_caller_uid, 'member.join_requested', 'user', v_caller_uid,
      jsonb_build_object('reason', 'domain_match', 'domain', v_domain));

    RETURN jsonb_build_object(
      'org_id', v_domain_org_id,
      'org_name', v_org_name,
      'action', 'request_created',
      'reason', 'domain_match'
    );
  END IF;

  -- invite_only, or any policy value not listed above.
  RETURN jsonb_build_object(
    'org_id', v_domain_org_id,
    'org_name', v_org_name,
    'action', 'blocked',
    'reason', 'invite_only'
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.route_org_for_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.route_org_for_email(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.route_org_for_email(text) TO authenticated, service_role;


-- -- 2. approve_org_join_request ----------------------------------------------
--
-- Approving provisions an active membership, so approving needs membership-
-- granting authority. Rejecting does not provision anything, so it stays with
-- the org admin — they should be able to clear their own queue without
-- escalating, and refusing them that would be security theatre.
--
-- The org-admin check is kept as well as, not replaced by, the platform check
-- for the reject path: a platform admin who is not a member of the
-- organization can still act, because can_invite_members() short-circuits the
-- membership lookup.

CREATE OR REPLACE FUNCTION public.approve_org_join_request(
  p_request_id uuid,
  p_new_status text,
  p_notes text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_request RECORD;
  v_caller_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_may_grant boolean := false;
  v_provisioned boolean := false;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_request FROM access_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Access request not found'; END IF;
  IF v_request.request_type != 'join_org' THEN RAISE EXCEPTION 'Request is not a join_org request'; END IF;
  IF v_request.status != 'pending' THEN RAISE EXCEPTION 'Request is not pending (current: %)', v_request.status; END IF;

  v_may_grant := public.can_invite_members();

  SELECT EXISTS (
    SELECT 1 FROM organization_memberships
    WHERE organization_id = v_request.organization_id AND user_id = v_caller_uid
      AND is_org_admin = true AND status = 'active'
  ) INTO v_is_admin;

  IF NOT v_is_admin AND NOT v_may_grant THEN
    RAISE EXCEPTION 'Not authorized — must be org admin' USING ERRCODE = 'P0042';
  END IF;

  -- Early Access: admitting someone to a workspace is platform-controlled,
  -- exactly like issuing an invitation. Org admin status is not enough.
  IF p_new_status = 'approved' AND NOT v_may_grant THEN
    RAISE EXCEPTION 'Not authorized: joining a workspace is approved by Tesseract platform administrators during Early Access'
      USING ERRCODE = 'P0042';
  END IF;

  UPDATE access_requests SET status = p_new_status, reviewed_by = v_caller_uid, reviewed_at = now(), review_notes = p_notes
  WHERE id = p_request_id;

  IF p_new_status = 'approved' THEN
    INSERT INTO organization_memberships (user_id, organization_id, status, role)
    VALUES (v_request.requester_id, v_request.organization_id, 'active', 'member')
    ON CONFLICT (organization_id, user_id) DO UPDATE SET status = 'active';
    v_provisioned := true;
    INSERT INTO organization_audit_log (organization_id, actor_id, action, target_type, target_id, details)
    VALUES (v_request.organization_id, v_caller_uid, 'member.join_approved', 'user', v_request.requester_id,
      jsonb_build_object('request_id', p_request_id));
  ELSE
    INSERT INTO organization_audit_log (organization_id, actor_id, action, target_type, target_id, details)
    VALUES (v_request.organization_id, v_caller_uid, 'member.join_rejected', 'user', v_request.requester_id,
      jsonb_build_object('request_id', p_request_id, 'notes', coalesce(p_notes, '')));
  END IF;

  RETURN jsonb_build_object('status', p_new_status, 'provisioned_membership', v_provisioned);
END;
$fn$;

REVOKE ALL ON FUNCTION public.approve_org_join_request(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_org_join_request(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.approve_org_join_request(uuid, text, text) TO authenticated, service_role;


-- -- 3. organization_memberships — drop the unused INSERT grant ---------------
--
-- `authenticated` held INSERT, UPDATE and DELETE on this table, with RLS as
-- the only thing standing between a browser and a membership row. Audited
-- against the application:
--
--   INSERT  no call site anywhere in src/. Every membership the product
--           creates is written by a SECURITY DEFINER function, which runs as
--           the table owner and is unaffected by this grant. REVOKED.
--
--   UPDATE  REQUIRED. OrganizationPage.tsx:2546 toggles `is_org_admin` for a
--           member, and OpsClientDetailPage.tsx suspends and reactivates. Both
--           are ordinary client writes gated by the existing org-admin and
--           platform-admin policies. Kept.
--
--   DELETE  REQUIRED. OpsSettingsPage.tsx:101 clears memberships when deleting
--           an organization. Platform-admin-only in practice via OpsGuard, and
--           policy-gated at the row level. Kept.
--
-- The platform-admin INSERT policy from the authority migration is left in
-- place deliberately even though the revoke makes it unreachable. That looks
-- like the dormant-policy smell that migration warns about, but it is the
-- inverse: a dormant PERMISSIVE policy that grants ("org admins may insert")
-- is a loaded gun if the grant returns; a dormant policy that RESTRICTS to
-- platform admins is the seatbelt for exactly that event. If someone re-grants
-- INSERT on this table, the only INSERT policy standing is the platform-admin
-- one, and the boundary holds.

REVOKE INSERT ON TABLE public.organization_memberships FROM authenticated;
