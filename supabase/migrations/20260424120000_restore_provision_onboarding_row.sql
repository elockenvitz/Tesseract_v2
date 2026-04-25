/**
 * Restore org_onboarding_status creation in provision_client_org.
 *
 * Context: the hardening pass in 20260424030000 replaced the RPC but
 * accidentally dropped step 3 from the 20260409100000 version (the
 * INSERT INTO org_onboarding_status). Without that row, ProtectedRoute's
 * wizard query returns null and `needsOnboarding` is always false — so
 * newly provisioned client orgs never show the setup wizard, even though
 * the admin has never configured anything. Pilot orgs are the worst hit
 * because the wizard is the primary way an admin enters portfolios,
 * uploads holdings, and seeds the demo data.
 *
 * This migration:
 *   1. Rebuilds provision_client_org to include the onboarding row insert
 *      (keeping the hardening-era email validation and provisioner-enrollment
 *      fallback from 20260424030000).
 *   2. Backfills any existing org that has no onboarding row, so clients
 *      provisioned between 20260424030000 and this migration can still
 *      land on the wizard after switching into the new org.
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

  -- Validate email format (prior incident: comma-for-dot typo silently
  -- produced an orphan org with no active members).
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

  -- 3. Create onboarding status (not completed). This was dropped by
  --    the hardening migration 20260424030000; restoring it here ensures
  --    freshly provisioned orgs actually show the setup wizard to their
  --    admin on first entry.
  INSERT INTO org_onboarding_status (organization_id)
  VALUES (v_org_id)
  ON CONFLICT (organization_id) DO NOTHING;

  -- 4. Seed default rating scale for the org
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

  -- 5. Always enroll the provisioner as org admin (durable fallback if
  --    the intended admin email doesn't match a user and the invite
  --    eventually expires).
  IF v_provisioner_id IS NOT NULL THEN
    INSERT INTO organization_memberships (user_id, organization_id, is_org_admin, status)
    VALUES (v_provisioner_id, v_org_id, true, 'active')
    ON CONFLICT (user_id, organization_id) DO UPDATE
      SET is_org_admin = true, status = 'active';
  END IF;

  -- 6. Enroll intended admin or create invite
  SELECT id INTO v_admin_user_id
  FROM users
  WHERE lower(email) = v_normalized_email;

  IF v_admin_user_id IS NOT NULL THEN
    INSERT INTO organization_memberships (user_id, organization_id, is_org_admin, status)
    VALUES (v_admin_user_id, v_org_id, true, 'active')
    ON CONFLICT (user_id, organization_id) DO UPDATE
      SET is_org_admin = true, status = 'active';
  ELSE
    INSERT INTO organization_invites (
      organization_id, email, invited_by, invited_is_org_admin, status
    ) VALUES (
      v_org_id, v_normalized_email, v_provisioner_id, true, 'pending'
    )
    RETURNING id INTO v_invite_id;
  END IF;

  -- 7. Audit event
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

-- Backfill: any org created during the window where the hardening RPC
-- existed but didn't create an onboarding row. Idempotent via the
-- ON CONFLICT clause on the (organization_id) unique index.
INSERT INTO org_onboarding_status (organization_id)
SELECT o.id
FROM organizations o
LEFT JOIN org_onboarding_status s ON s.organization_id = o.id
WHERE s.organization_id IS NULL
ON CONFLICT (organization_id) DO NOTHING;
