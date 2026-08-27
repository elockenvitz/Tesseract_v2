-- ============================================================================
-- Early Access — invitation acceptance requires the token and the identity
-- ============================================================================
--
-- The audit found two ways to obtain a membership without ever proving control
-- of the invited mailbox.
--
-- 1. `auto_accept_pending_invites()` ran on every login for any user with no
--    current organization. It selected every pending invitation whose `email`
--    string matched `auth.users.email` and granted the memberships — including
--    `invited_is_org_admin` — with no token, no link, and no proof. Combined
--    with open signup and `mailer_autoconfirm = true`, the whole attack was:
--    learn that alice@fund.example has a pending invite, sign up as that
--    address (instantly "confirmed"), log in, and be an org admin of her
--    workspace. It also had no `search_path` pinned, which for a SECURITY
--    DEFINER function is a second problem on its own.
--
-- 2. `accept_org_invite()` did check the token and the address, but never
--    looked at `revoked_at`, and raised on a replayed acceptance instead of
--    returning the same answer twice.
--
-- The model after this migration
-- ------------------------------
-- Membership is granted only when BOTH hold:
--
--   possession — the caller presents the invitation token. It is 122 bits of
--                gen_random_uuid() entropy that only ever travelled to the
--                invited mailbox, so presenting it is evidence of access to
--                that mailbox. This is the load-bearing factor, and it is the
--                one that does not depend on Supabase's mailer settings.
--
--   identity   — the caller is authenticated, and the address on their
--                auth.users row equals the invited address. auth.users, never
--                public.users: the profile row's email is client-writable, so
--                matching on it would let anyone rename themselves into
--                someone else's invitation.
--
-- plus a confirmation check on auth.users.email_confirmed_at, which is a real
-- second factor the moment `mailer_autoconfirm` is turned off (see the
-- rollout plan) and is inert but harmless until then. Writing it now means
-- flipping that setting later needs no code change.
--
-- `auto_accept_pending_invites()` is not fixable — an email-only match has no
-- possession factor to add — so it stops granting anything.
--
-- ============================================================================


-- -- 1. The grandfathering record -------------------------------------------
--
-- Every one of the existing auth users carries email_confirmed_at, but that is
-- an artefact of `mailer_autoconfirm = true`: it was stamped at signup without
-- anyone opening an email. It therefore proves nothing about historical
-- mailbox ownership, and this migration must not pretend otherwise — but it
-- also must not lock out the pilots who are already legitimately inside.
--
-- What IS trustworthy is their membership. `organization_memberships` is
-- written only by SECURITY DEFINER functions and, after the companion
-- migration, insertable only by platform admins — a pilot cannot forge a row
-- in it. So the grandfathering set is defined as "had an active membership at
-- the moment the rule changed", captured here explicitly rather than inferred
-- later from mutable state.
--
-- Nothing in this branch reads it as a bypass of the token requirement; it
-- exists so that (a) the set is auditable and frozen, and (b) if a future
-- change tightens verification further, there is a durable record of who
-- predates it. Acceptance consults it only to waive the confirmation check,
-- never the token or the address.

CREATE TABLE IF NOT EXISTS public.early_access_grandfathered_identities (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  grandfathered_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL
);

COMMENT ON TABLE public.early_access_grandfathered_identities IS
  'Frozen set of identities that held a trusted active organization membership before Early Access invitation/verification enforcement landed. Membership state, not email state, is the evidence. Never grants membership; only waives the email-confirmation check during invite acceptance.';

ALTER TABLE public.early_access_grandfathered_identities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins can read grandfathered identities"
  ON public.early_access_grandfathered_identities;
CREATE POLICY "Platform admins can read grandfathered identities"
  ON public.early_access_grandfathered_identities FOR SELECT
  TO authenticated
  USING (is_platform_admin());

REVOKE ALL ON TABLE public.early_access_grandfathered_identities FROM anon;
REVOKE ALL ON TABLE public.early_access_grandfathered_identities FROM authenticated;
GRANT SELECT ON TABLE public.early_access_grandfathered_identities TO authenticated;

-- Idempotent: re-running the migration adds nobody who joined afterwards,
-- because ON CONFLICT DO NOTHING keeps the original grandfathered_at, and the
-- WHERE clause is evaluated against whoever is active at first run.
INSERT INTO public.early_access_grandfathered_identities (user_id, reason)
SELECT DISTINCT m.user_id, 'active_membership_before_early_access_enforcement'
FROM public.organization_memberships m
JOIN auth.users u ON u.id = m.user_id
WHERE m.status = 'active'
ON CONFLICT (user_id) DO NOTHING;


-- -- 2. auto_accept_pending_invites — no longer grants anything --------------
--
-- Kept as a function, and kept EXECUTE-able by `authenticated`, on purpose:
-- the deployed frontend calls it on every login where the user has no current
-- organization. Dropping it would make that call error during the window
-- between the database deploy and the frontend deploy. Returning a zero result
-- makes the old client fall through to its existing "no organization" path,
-- which is the correct destination now — so the two deploys are safe in either
-- order.
--
-- Also pins search_path, which the SECURITY DEFINER original never set.

CREATE OR REPLACE FUNCTION public.auto_accept_pending_invites()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $fn$
  -- Retired. Matching an invitation on the email string alone carried no proof
  -- that the caller controlled the mailbox. Invitations are now claimed only
  -- through accept_org_invite(token) from the /invite/:token link.
  SELECT jsonb_build_object(
    'accepted_count', 0,
    'organization_id', NULL::uuid,
    'org_name', NULL::text,
    'retired', true
  );
$fn$;

COMMENT ON FUNCTION public.auto_accept_pending_invites() IS
  'Retired no-op kept for deploy-order compatibility. Email-only invite matching had no possession factor; use accept_org_invite(token).';

REVOKE ALL ON FUNCTION public.auto_accept_pending_invites() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auto_accept_pending_invites() FROM anon;
GRANT EXECUTE ON FUNCTION public.auto_accept_pending_invites() TO authenticated, service_role;


-- -- 3. accept_org_invite — the single way in --------------------------------

CREATE OR REPLACE FUNCTION public.accept_org_invite(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_caller_uid uuid := auth.uid();
  v_caller_email text;
  v_caller_confirmed_at timestamptz;
  v_grandfathered boolean;
  v_invite RECORD;
  v_node jsonb;
  v_portfolio jsonb;
  v_current_org uuid;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  -- Lock the invitation for the whole decision so two concurrent accepts of
  -- the same token cannot both pass the status check.
  SELECT * INTO v_invite
  FROM organization_invites
  WHERE token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite not found' USING ERRCODE = 'P0002';
  END IF;

  -- Identity comes from auth.users. public.users.email is client-writable and
  -- is deliberately never consulted here.
  SELECT lower(email), email_confirmed_at
    INTO v_caller_email, v_caller_confirmed_at
  FROM auth.users WHERE id = v_caller_uid;

  IF v_caller_email IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  -- Address check runs before the status checks so that a stranger holding a
  -- leaked token learns nothing about the invitation's state.
  IF v_caller_email IS DISTINCT FROM lower(v_invite.email) THEN
    RAISE EXCEPTION 'This invite was sent to a different email address'
      USING ERRCODE = 'P0022';
  END IF;

  -- Idempotence: the same person replaying their own accepted invite gets the
  -- same answer, not an error. This is what makes the /invite/:token page safe
  -- to refresh, and it cannot be used to re-grant anything — no writes happen
  -- on this branch.
  IF v_invite.status = 'accepted' THEN
    IF v_invite.accepted_by = v_caller_uid THEN
      RETURN jsonb_build_object(
        'organization_id', v_invite.organization_id,
        'status', 'already_accepted',
        'is_org_admin', v_invite.invited_is_org_admin
      );
    END IF;
    RAISE EXCEPTION 'Invite is no longer valid (status: accepted)'
      USING ERRCODE = 'P0003';
  END IF;

  IF v_invite.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invite has been revoked' USING ERRCODE = 'P0025';
  END IF;

  IF v_invite.status NOT IN ('pending', 'sent') THEN
    RAISE EXCEPTION 'Invite is no longer valid (status: %)', v_invite.status
      USING ERRCODE = 'P0003';
  END IF;

  IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at < now() THEN
    UPDATE organization_invites SET status = 'expired' WHERE id = v_invite.id;
    RAISE EXCEPTION 'Invite has expired' USING ERRCODE = 'P0021';
  END IF;

  -- Confirmation check. Inert while mailer_autoconfirm is on (every row is
  -- stamped at signup), meaningful the moment it is turned off, and waived for
  -- the frozen grandfathered set so that turning it off cannot strand a pilot
  -- who predates the rule.
  SELECT EXISTS (
    SELECT 1 FROM early_access_grandfathered_identities WHERE user_id = v_caller_uid
  ) INTO v_grandfathered;

  IF v_caller_confirmed_at IS NULL AND NOT v_grandfathered THEN
    RAISE EXCEPTION 'Confirm your email address before accepting this invitation'
      USING ERRCODE = 'P0026';
  END IF;

  -- ---- everything below this line is the grant -----------------------------

  UPDATE organization_invites
  SET status = 'accepted',
      accepted_at = now(),
      accepted_by = v_caller_uid
  WHERE id = v_invite.id;

  -- Membership is created for the AUTHENTICATED CALLER only; the invite never
  -- names a user id. The status filter on the conflict branch is what stops an
  -- old admin-flagged invite from being replayed to upgrade an existing
  -- ordinary member: an already-active membership is left exactly as it is.
  --
  -- The admin flag is OR'd rather than assigned, which is the behaviour the
  -- retired auto-accept path had. It only ever widens a row that is still
  -- 'invited', 'inactive' or 'pending', and every such row got its flag from an
  -- invitation or a platform admin in the first place, so nothing enters here
  -- that did not come from an invitation. Assigning instead would be the
  -- stricter reading of "privileges come only from this invite", at the cost of
  -- silently demoting someone when a second, plainer invitation is sent to an
  -- address that already holds an admin invitation. Flip it if that trade ever
  -- reverses.
  INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin)
  VALUES (v_invite.organization_id, v_caller_uid, 'active', v_invite.invited_is_org_admin)
  ON CONFLICT (organization_id, user_id) DO UPDATE
    SET status = 'active',
        is_org_admin = organization_memberships.is_org_admin OR v_invite.invited_is_org_admin
    WHERE organization_memberships.status IN ('invited', 'inactive', 'pending');

  -- Preassignments, ported from the retired auto-accept path so that the Ops
  -- "put them on these nodes / portfolios" feature still lands.
  IF v_invite.preassignments IS NOT NULL AND v_invite.preassignments ? 'org_nodes' THEN
    FOR v_node IN SELECT * FROM jsonb_array_elements(v_invite.preassignments -> 'org_nodes')
    LOOP
      INSERT INTO org_chart_node_members (node_id, user_id, role, created_by)
      VALUES (
        (v_node ->> 'node_id')::uuid,
        v_caller_uid,
        COALESCE(v_node ->> 'role', 'member'),
        v_invite.invited_by
      )
      ON CONFLICT (node_id, user_id) DO NOTHING;
    END LOOP;
  END IF;

  IF v_invite.preassignments IS NOT NULL AND v_invite.preassignments ? 'portfolios' THEN
    FOR v_portfolio IN SELECT * FROM jsonb_array_elements(v_invite.preassignments -> 'portfolios')
    LOOP
      INSERT INTO portfolio_team (portfolio_id, user_id, role)
      VALUES (
        (v_portfolio ->> 'portfolio_id')::uuid,
        v_caller_uid,
        COALESCE(v_portfolio ->> 'role', 'analyst')
      )
      ON CONFLICT (portfolio_id, user_id) DO NOTHING;
    END LOOP;
  END IF;

  -- Land them in the workspace they were invited to. Only when they have none:
  -- an existing pilot accepting a second invitation should not be yanked out
  -- of the organization they were working in.
  SELECT current_organization_id INTO v_current_org FROM users WHERE id = v_caller_uid;
  IF v_current_org IS NULL THEN
    UPDATE users SET current_organization_id = v_invite.organization_id
    WHERE id = v_caller_uid;
  END IF;

  INSERT INTO organization_audit_log
    (organization_id, actor_id, action, target_type, target_id, details)
  VALUES (
    v_invite.organization_id, v_caller_uid, 'invite.accepted', 'invite', v_invite.id,
    jsonb_build_object(
      'email', v_invite.email,
      'invited_is_org_admin', v_invite.invited_is_org_admin,
      'grandfathered_identity', v_grandfathered
    )
  );

  RETURN jsonb_build_object(
    'organization_id', v_invite.organization_id,
    'status', 'accepted',
    'is_org_admin', v_invite.invited_is_org_admin
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.accept_org_invite(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_org_invite(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.accept_org_invite(uuid) TO authenticated, service_role;
