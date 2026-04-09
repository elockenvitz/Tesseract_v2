-- ============================================================
-- Client Organization Provisioning
-- ============================================================
--
-- Server-side RPC to provision a new client organization with
-- all required scaffolding. Gated to platform admins only.
-- ============================================================

-- ============================================================
-- 1. Provisioning RPC
-- ============================================================

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
  v_result JSONB;
BEGIN
  -- Gate: only platform admins can provision
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Access denied: only platform admins can provision organizations';
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
  INSERT INTO rating_scales (name, description, organization_id, scale_type, values)
  VALUES (
    'Default Rating Scale',
    'Standard 5-point rating scale',
    v_org_id,
    'numeric',
    '[
      {"value": "1", "label": "Strong Buy", "color": "#10b981"},
      {"value": "2", "label": "Buy", "color": "#34d399"},
      {"value": "3", "label": "Neutral", "color": "#9ca3af"},
      {"value": "4", "label": "Sell", "color": "#f87171"},
      {"value": "5", "label": "Strong Sell", "color": "#ef4444"}
    ]'::jsonb
  );

  -- 4. Check if admin user exists
  SELECT id INTO v_admin_user_id
  FROM users
  WHERE email = p_admin_email;

  IF v_admin_user_id IS NOT NULL THEN
    -- User exists — create membership directly
    INSERT INTO organization_memberships (user_id, organization_id, is_org_admin, status)
    VALUES (v_admin_user_id, v_org_id, true, 'active')
    ON CONFLICT (user_id, organization_id) DO UPDATE
      SET is_org_admin = true, status = 'active';
  ELSE
    -- User doesn't exist — create invitation
    INSERT INTO organization_invites (
      organization_id, email, role, invited_by, status
    ) VALUES (
      v_org_id, p_admin_email, 'admin', auth.uid(), 'pending'
    )
    RETURNING id INTO v_invite_id;
  END IF;

  -- 5. Log the provisioning event
  INSERT INTO audit_events (
    actor_id, actor_type, entity_type, entity_id,
    action_type, action_category, to_state, metadata
  ) VALUES (
    auth.uid(), 'user', 'organization', v_org_id,
    'provision', 'lifecycle', 'active',
    jsonb_build_object(
      'org_name', p_name,
      'org_slug', p_slug,
      'admin_email', p_admin_email,
      'admin_user_id', v_admin_user_id,
      'invite_id', v_invite_id
    )
  );

  -- Build result
  v_result := jsonb_build_object(
    'organization_id', v_org_id,
    'name', p_name,
    'slug', p_slug,
    'admin_user_id', v_admin_user_id,
    'admin_invited', v_admin_user_id IS NULL,
    'invite_id', v_invite_id
  );

  RETURN v_result;
END;
$$;
