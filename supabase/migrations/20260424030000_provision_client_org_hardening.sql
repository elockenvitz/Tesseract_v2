/**
 * Harden provision_client_org against orphaned orgs.
 *
 * Context: a pilot provisioning ("Money Moves Capital") silently created
 * an org with zero active memberships because the admin_email was typed
 * as "elockenvitz@yahoo,com" (comma instead of dot). The RPC couldn't
 * match a user, so it fell through to the invite path and queued a mail
 * to an unreachable address. The org existed but was invisible to every
 * logged-in user — no one was enrolled.
 *
 * Changes:
 *   1. Server-side email format validation. Reject malformed emails
 *      rather than creating an invite that will never land.
 *   2. Always enroll the provisioning admin (auth.uid()) as an active
 *      org admin. This is the durable fallback — even if the intended
 *      admin email is typoed, the platform admin who provisioned the
 *      org retains access and can fix it from the ops console.
 *
 * Soft-delete and hard-delete paths are unaffected.
 */

CREATE OR REPLACE FUNCTION provision_client_org(
  p_name TEXT,
  p_slug TEXT,
  p_admin_email TEXT,
  p_settings JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_admin_user_id UUID;
  v_invite_id UUID;
  v_provisioner_id UUID := auth.uid();
  v_normalized_email TEXT := lower(btrim(p_admin_email));
  v_result JSONB;
BEGIN
  -- Gate: only platform admins can provision
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Access denied: only platform admins can provision organizations';
  END IF;

  -- Validate email format. The prior version accepted anything non-empty,
  -- which meant a comma-for-dot typo silently produced an invite to a
  -- dead address. Require a basic shape: something@something.something.
  IF v_normalized_email IS NULL
     OR v_normalized_email !~ '^[^@\s,]+@[^@\s,]+\.[^@\s,]+$' THEN
    RAISE EXCEPTION 'Invalid admin email format: "%"', p_admin_email;
  END IF;

  -- Validate slug uniqueness
  IF EXISTS (SELECT 1 FROM organizations WHERE slug = p_slug) THEN
    RAISE EXCEPTION 'Organization slug "%" already exists', p_slug;
  END IF;

  -- 1. Create the organization
  INSERT INTO organizations (name, slug, settings, onboarding_policy)
  VALUES (p_name, p_slug, p_settings, 'invite_only')
  RETURNING id INTO v_org_id;

  -- 2. Create governance record
  INSERT INTO organization_governance (organization_id)
  VALUES (v_org_id)
  ON CONFLICT (organization_id) DO NOTHING;

  -- 3. Seed default rating scale for the org
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

  -- 4. Always enroll the provisioner as org admin. This is the durable
  --    fallback — even if the intended admin email doesn't match a user
  --    and the invite expires, the provisioning platform admin keeps
  --    access and can recover the org from the ops console.
  IF v_provisioner_id IS NOT NULL THEN
    INSERT INTO organization_memberships (user_id, organization_id, is_org_admin, status)
    VALUES (v_provisioner_id, v_org_id, true, 'active')
    ON CONFLICT (user_id, organization_id) DO UPDATE
      SET is_org_admin = true, status = 'active';
  END IF;

  -- 5. Check if the intended admin user exists
  SELECT id INTO v_admin_user_id
  FROM users
  WHERE lower(email) = v_normalized_email;

  IF v_admin_user_id IS NOT NULL THEN
    -- User exists — create membership directly
    INSERT INTO organization_memberships (user_id, organization_id, is_org_admin, status)
    VALUES (v_admin_user_id, v_org_id, true, 'active')
    ON CONFLICT (user_id, organization_id) DO UPDATE
      SET is_org_admin = true, status = 'active';
  ELSE
    -- User doesn't exist — create invitation
    INSERT INTO organization_invites (
      organization_id, email, invited_by, invited_is_org_admin, status
    ) VALUES (
      v_org_id, v_normalized_email, v_provisioner_id, true, 'pending'
    )
    RETURNING id INTO v_invite_id;
  END IF;

  -- 6. Log the provisioning event
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
      'provisioner_enrolled', v_provisioner_id IS NOT NULL
    ),
    v_org_id,
    encode(sha256(convert_to(v_org_id::text || '-provision-' || now()::text, 'UTF8')), 'hex')
  );

  -- Build result
  v_result := jsonb_build_object(
    'organization_id', v_org_id,
    'name', p_name,
    'slug', p_slug,
    'admin_user_id', v_admin_user_id,
    'admin_invited', v_admin_user_id IS NULL,
    'invite_id', v_invite_id,
    'provisioner_enrolled', v_provisioner_id IS NOT NULL
  );

  RETURN v_result;
END;
$$;
