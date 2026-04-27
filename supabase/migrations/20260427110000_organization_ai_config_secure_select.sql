-- ============================================================================
-- Plug a key-leak in organization_ai_config.
--
-- Bug
-- ---
-- The 20260427100200_byok_per_org_scope migration created a SELECT policy
-- letting ALL active org members read the full row, including byok_api_key.
-- The frontend hook does `.select('*')`, so non-admin pilot users could see
-- the plaintext key in their network response. Only admins should ever see
-- the key value; members only need to know "is BYOK configured and which
-- provider/model".
--
-- Fix
-- ---
-- 1. Tighten SELECT to admins only. Non-admins lose direct table access.
-- 2. SECURITY DEFINER `get_org_ai_config_summary()` returns the public
--    fields (provider, model, enabled, is_configured) for any active
--    member. The api_key is never returned.
-- 3. SECURITY DEFINER `get_org_ai_config_for_resolution(org_id)` returns
--    the full row including api_key — used ONLY by the ai-chat edge
--    function to make provider calls. Caller must be an active member of
--    the requested org. The function bypasses RLS via SECURITY DEFINER
--    but enforces membership inside.
-- ============================================================================

-- 1. Tighten SELECT — admins only.
DROP POLICY IF EXISTS "Org members can view ai config" ON public.organization_ai_config;
DROP POLICY IF EXISTS "Org admins can view ai config"  ON public.organization_ai_config;
CREATE POLICY "Org admins can view ai config" ON public.organization_ai_config
  FOR SELECT USING (
    is_active_org_admin_of_current_org()
    AND organization_id = current_org_id()
  );

-- 2. Public summary for non-admin display. No api_key in the result.
CREATE OR REPLACE FUNCTION public.get_org_ai_config_summary()
RETURNS TABLE(
  organization_id uuid,
  byok_provider   text,
  byok_model      text,
  byok_enabled    boolean,
  is_configured   boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Caller must be an active member of their current org. If not, return
  -- nothing — same shape as "no config".
  IF NOT is_active_member_of_current_org() THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    c.organization_id,
    c.byok_provider,
    c.byok_model,
    c.byok_enabled,
    (c.byok_api_key IS NOT NULL AND length(c.byok_api_key) > 0) AS is_configured
  FROM organization_ai_config c
  WHERE c.organization_id = current_org_id();
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_org_ai_config_summary() TO authenticated;

-- 3. Resolution function for the edge function — returns the full config
-- including api_key. Membership is enforced inside (caller must be an
-- active member of the org they're asking about). Used exclusively by
-- ai-chat to mint provider calls — never exposed to the client.
CREATE OR REPLACE FUNCTION public.get_org_ai_config_for_resolution(p_org_id uuid)
RETURNS TABLE(
  byok_provider text,
  byok_api_key  text,
  byok_model    text,
  byok_enabled  boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_org_id IS NULL OR auth.uid() IS NULL THEN
    RETURN;
  END IF;

  -- Caller must be an active member of the requested org.
  IF NOT EXISTS (
    SELECT 1 FROM organization_memberships
    WHERE organization_id = p_org_id
      AND user_id         = auth.uid()
      AND status          = 'active'
      AND suspended_at IS NULL
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    c.byok_provider,
    c.byok_api_key,
    c.byok_model,
    c.byok_enabled
  FROM organization_ai_config c
  WHERE c.organization_id = p_org_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_org_ai_config_for_resolution(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_org_ai_config_summary() IS
  'Safe per-org AI config for non-admin display. Returns provider/model/enabled/is_configured — never the api_key. Use this from the frontend; only org admins can SELECT the table directly.';

COMMENT ON FUNCTION public.get_org_ai_config_for_resolution(uuid) IS
  'Returns the full org AI config including api_key. Used ONLY by the ai-chat edge function to mint provider calls. Membership is checked inside; never expose to the browser.';
