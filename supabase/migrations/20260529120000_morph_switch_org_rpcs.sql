-- Missing RPCs for the morph flow.
--
-- useMorphSession.ts has always called supabase.rpc('morph_switch_org')
-- after start_morph_session, and supabase.rpc('morph_restore_org')
-- after end_morph_session. Neither function ever existed in the
-- database, so both calls fail silently — and the symptom is exactly
-- what an ops user reported: morphing as another user swaps the
-- header identity (Ryan Metz) but leaves the org switcher and every
-- org-scoped query pointed at the admin's original org.
--
-- These two functions complete the flow by allowing the admin's
-- `users.current_organization_id` to be temporarily switched to the
-- morph target's org, then restored on unmorph. Both write to the
-- admin's own row (auth.uid()), so the change is per-session and
-- doesn't affect the morphed user.
--
-- Security: gated tightly so they can't be abused outside the morph
-- flow itself.

-- ────────────────────────────────────────────────────────────────────
-- morph_switch_org
--
-- Called by the admin immediately after start_morph_session to point
-- their `current_organization_id` at the target user's org. Bypasses
-- the normal "is the user a member" check that set_current_org would
-- apply (the whole point is to enter an org the admin isn't a member
-- of). Tightly gated:
--   1. Only platform admins can call.
--   2. The caller must have an active, unexpired morph session.
--   3. p_org_id must match the target_org_id captured at session start
--      — preventing this RPC from being used as a backdoor to jump
--      into any org once a morph session is active.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION morph_switch_org(p_org_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_target_org UUID;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Access denied: only platform admins can morph_switch_org';
  END IF;

  SELECT target_org_id INTO v_session_target_org
  FROM morph_sessions
  WHERE admin_user_id = auth.uid()
    AND is_active = true
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_session_target_org IS NULL THEN
    RAISE EXCEPTION 'No active morph session for this admin';
  END IF;

  IF v_session_target_org IS DISTINCT FROM p_org_id THEN
    RAISE EXCEPTION 'p_org_id does not match the active morph session''s target_org_id';
  END IF;

  UPDATE users
     SET current_organization_id = p_org_id,
         updated_at = now()
   WHERE id = auth.uid();
END;
$$;

-- ────────────────────────────────────────────────────────────────────
-- morph_restore_org
--
-- Called by the admin after end_morph_session to restore their
-- original `current_organization_id`. The client passes the org id it
-- saved at morph start; this function only writes it if the caller is
-- actually an active member of that org (so it can't be abused to
-- bounce into an arbitrary org post-morph).
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION morph_restore_org(p_org_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Access denied: only platform admins can morph_restore_org';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM organization_memberships
    WHERE user_id = auth.uid()
      AND organization_id = p_org_id
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Caller is not an active member of the target restore org';
  END IF;

  UPDATE users
     SET current_organization_id = p_org_id,
         updated_at = now()
   WHERE id = auth.uid();
END;
$$;

-- Allow authenticated users to call these — the in-function checks
-- gate on is_platform_admin() and the morph session state, so the
-- grant is safe (non-admin calls will RAISE EXCEPTION immediately).
GRANT EXECUTE ON FUNCTION morph_switch_org(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION morph_restore_org(UUID) TO authenticated;
