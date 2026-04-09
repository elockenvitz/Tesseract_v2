-- ============================================================
-- Client Org Onboarding Status
-- ============================================================
--
-- Tracks the onboarding wizard progress for each client org.
-- Created automatically when an org is provisioned.
-- Wizard is mandatory-with-skip: shown until completed,
-- but individual steps can be skipped.
-- ============================================================

CREATE TABLE IF NOT EXISTS org_onboarding_status (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  is_completed BOOLEAN DEFAULT false,
  current_step INT DEFAULT 1,
  steps_completed JSONB DEFAULT '[]'::jsonb,   -- e.g. ["welcome","org_structure","portfolios"]
  steps_skipped JSONB DEFAULT '[]'::jsonb,     -- e.g. ["org_structure"]
  completed_by UUID REFERENCES users(id),
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE org_onboarding_status ENABLE ROW LEVEL SECURITY;

-- Org admins can read their own org's onboarding status
CREATE POLICY "Org onboarding: org admins can read"
  ON org_onboarding_status FOR SELECT TO authenticated
  USING (
    organization_id = current_org_id()
    AND is_active_org_admin_of_current_org()
  );

-- Org admins can update their own org's onboarding status
CREATE POLICY "Org onboarding: org admins can update"
  ON org_onboarding_status FOR UPDATE TO authenticated
  USING (
    organization_id = current_org_id()
    AND is_active_org_admin_of_current_org()
  );

-- Platform admins can read all (for ops portal)
CREATE POLICY "Org onboarding: platform admins can read all"
  ON org_onboarding_status FOR SELECT TO authenticated
  USING (is_platform_admin());

-- Platform admins can insert (for provisioning)
CREATE POLICY "Org onboarding: platform admins can insert"
  ON org_onboarding_status FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin());

-- Platform admins can update (for ops management)
CREATE POLICY "Org onboarding: platform admins can update all"
  ON org_onboarding_status FOR UPDATE TO authenticated
  USING (is_platform_admin());

-- ============================================================
-- Update provision_client_org to auto-create onboarding row
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
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Access denied: only platform admins can provision organizations';
  END IF;

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

  -- 3. Create onboarding status (not completed)
  INSERT INTO org_onboarding_status (organization_id)
  VALUES (v_org_id)
  ON CONFLICT (organization_id) DO NOTHING;

  -- 4. Seed default rating scale
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

  -- 5. Check if admin user exists
  SELECT id INTO v_admin_user_id FROM users WHERE email = p_admin_email;

  IF v_admin_user_id IS NOT NULL THEN
    INSERT INTO organization_memberships (user_id, organization_id, is_org_admin, status)
    VALUES (v_admin_user_id, v_org_id, true, 'active')
    ON CONFLICT (user_id, organization_id) DO UPDATE
      SET is_org_admin = true, status = 'active';
  ELSE
    INSERT INTO organization_invites (
      organization_id, email, role, invited_by, status
    ) VALUES (
      v_org_id, p_admin_email, 'admin', auth.uid(), 'pending'
    )
    RETURNING id INTO v_invite_id;
  END IF;

  -- 6. Audit event
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
