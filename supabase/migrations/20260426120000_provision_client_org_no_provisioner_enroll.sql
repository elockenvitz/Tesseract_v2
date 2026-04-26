-- Stop auto-enrolling the provisioner as an org admin of every client
-- they provision. The platform admin who clicks "Provision" wants to
-- create an org for someone else — they shouldn't end up as a member
-- of every client they spin up.
--
-- Backwards-compatible cleanup: removes the duplicate provisioner
-- membership from any org where audit_events recorded
-- provisioner_enrolled=true. Generic guard via the timestamp window
-- avoids stripping users who joined the org through other means.

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

  -- NOTE: previously this also enrolled the provisioner (auth.uid())
  -- as an org admin. Removed — the platform admin doesn't need to be
  -- a member of every client they provision. Platform-admin powers
  -- (morph, ops portal) cover the rare cases where they need access
  -- to the org without being a member of it.

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

-- Backfill cleanup: remove provisioner-side memberships that were
-- inserted simultaneously with the org's creation by the previous
-- behavior. We identify them by joining audit_events.metadata, which
-- recorded provisioner_enrolled=true for each affected org, and
-- removing the matching membership row that ISN'T the specified admin.
DELETE FROM organization_memberships om
USING audit_events ae
WHERE ae.entity_type = 'organization'
  AND ae.action_type = 'provision'
  AND (ae.metadata->>'provisioner_enrolled')::boolean = true
  AND om.organization_id = ae.entity_id
  AND om.user_id = ae.actor_id
  AND om.user_id <> COALESCE((ae.metadata->>'admin_user_id')::uuid, '00000000-0000-0000-0000-000000000000')
  AND abs(extract(epoch FROM (om.created_at - ae.occurred_at))) < 5
  AND (
    SELECT COUNT(*) FROM organization_memberships om2
    WHERE om2.organization_id = om.organization_id
      AND om2.is_org_admin = true
      AND om2.status = 'active'
  ) > 1;
