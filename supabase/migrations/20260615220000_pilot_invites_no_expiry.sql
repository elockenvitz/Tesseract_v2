-- Pilot pre-provisioning invites should not expire.
--
-- Incident: "Cecero Capital" was provisioned on May 26 for a pilot user
-- (nicholas.cecero@gmail.com) who had not yet signed up, so provision_client_org
-- created an organization_invites row. organization_invites.expires_at defaults
-- to now() + 7 days. The pilot didn't sign up until June 15 — 20 days later —
-- by which point the invite was expired. auto_accept_pending_invites only
-- accepts invites WHERE expires_at > now(), so it was skipped: no membership
-- was created, and because the email domain (gmail.com) has no verified
-- organization_domains row, route_org_for_email fell through to action='blocked'
-- → the user hit the "Access Required" screen. A hard refresh couldn't help
-- because the blocker was server-side data, not browser cache.
--
-- Root cause: a pilot provisioning is a *pre-authorization* for a specific
-- person we expect to onboard on their own schedule (often weeks out), not a
-- time-boxed invite. The 7-day default is wrong for this path.
--
-- Fix:
--   1. provision_client_org sets expires_at = NULL on the invite it creates,
--      so the pre-authorization never lapses before the pilot signs up.
--   2. Backfill: clear expires_at on all currently-pending invites belonging
--      to pilot orgs, unblocking the cohort of pilots provisioned ahead of
--      signup who would otherwise hit the same wall.
--
-- Only the invite path of provision_client_org changes; the existing-user
-- direct-membership path and everything else is identical to the prior
-- definition (20260426120000_provision_client_org_no_provisioner_enroll).

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
AS $function$
DECLARE
  v_org_id UUID;
  v_admin_user_id UUID;
  v_invite_id UUID;
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

  SELECT id INTO v_admin_user_id
  FROM users
  WHERE lower(email) = v_normalized_email;

  IF v_admin_user_id IS NOT NULL THEN
    INSERT INTO organization_memberships (user_id, organization_id, is_org_admin, status)
    VALUES (v_admin_user_id, v_org_id, true, 'active')
    ON CONFLICT (user_id, organization_id) DO UPDATE
      SET is_org_admin = true, status = 'active';
  ELSE
    -- Pre-authorization for a pilot who hasn't signed up yet. expires_at is
    -- explicitly NULL (overriding the table's 7-day default) so the invite
    -- survives however long it takes the person to create their account —
    -- auto_accept_pending_invites consumes it on their first login.
    INSERT INTO organization_invites (
      organization_id, email, invited_by, invited_is_org_admin, status, expires_at
    ) VALUES (
      v_org_id, v_normalized_email, v_provisioner_id, true, 'pending', NULL
    )
    RETURNING id INTO v_invite_id;
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

  v_result := jsonb_build_object(
    'organization_id', v_org_id,
    'name', p_name,
    'slug', p_slug,
    'admin_user_id', v_admin_user_id,
    'admin_invited', v_admin_user_id IS NULL,
    'invite_id', v_invite_id,
    'provisioner_enrolled', false
  );

  RETURN v_result;
END;
$function$;

-- Backfill: unblock pilots already provisioned ahead of signup. Clear the
-- 7-day expiry on every still-pending invite belonging to a pilot org so it
-- behaves like the new pre-authorization invites above. Scoped to pilot orgs
-- so ordinary (intentionally time-boxed) invites keep their expiry.
UPDATE organization_invites i
SET expires_at = NULL
FROM organizations o
WHERE i.organization_id = o.id
  AND i.status = 'pending'
  AND COALESCE(o.settings->>'pilot_mode', 'false') = 'true';
