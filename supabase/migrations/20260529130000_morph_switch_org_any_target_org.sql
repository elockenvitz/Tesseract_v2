-- Relax morph_switch_org so a morphing admin can switch BETWEEN the
-- target user's orgs during the session, not just into the one
-- captured at session start. The gate now is "p_org_id must be an
-- active org membership of the morph target," which is the right
-- semantic for impersonation: see anything the target can see.
--
-- Use case the original tight check broke: an ops admin morphs as a
-- pilot tester who's in two orgs and wants to inspect what they've
-- been doing in each. The dropdown lists both of the target's orgs;
-- clicking either one needs to flip the admin's current_organization_id
-- to that org. The earlier "p_org_id must match the initial
-- target_org_id" gate rejected anything except the first one.

CREATE OR REPLACE FUNCTION morph_switch_org(p_org_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_user UUID;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Access denied: only platform admins can morph_switch_org';
  END IF;

  SELECT target_user_id INTO v_target_user
  FROM morph_sessions
  WHERE admin_user_id = auth.uid()
    AND is_active = true
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_target_user IS NULL THEN
    RAISE EXCEPTION 'No active morph session for this admin';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM organization_memberships
    WHERE user_id = v_target_user
      AND organization_id = p_org_id
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'p_org_id is not an active org membership of the morph target';
  END IF;

  UPDATE users
     SET current_organization_id = p_org_id,
         updated_at = now()
   WHERE id = auth.uid();
END;
$$;
