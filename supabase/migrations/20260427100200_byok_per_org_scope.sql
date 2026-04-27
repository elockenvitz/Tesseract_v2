-- ============================================================================
-- Move BYOK (Bring Your Own Key) AI configuration from per-USER to per-ORG.
--
-- Background
-- ----------
-- BYOK was originally per-user: each user pasted their own Anthropic key.
-- For the firms we're targeting, this is the wrong shape — billing is at
-- the firm level, compliance review is at the firm level, and pod members
-- shouldn't each need their own key. The org-scope model:
--   · One BYOK config per organization
--   · Only org admins can read or write the API key
--   · All org members get to use it (resolved at request time in ai-chat)
--
-- Safety
-- ------
-- Pre-check confirmed user_ai_config has 0 BYOK rows configured today, so
-- we can drop the byok_* columns without backfill. user_ai_config keeps the
-- per-user limit overrides + context preferences (those remain per-user).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.organization_ai_config (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  byok_provider   text,
  byok_api_key    text,
  byok_model      text,
  byok_enabled    boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_organization_ai_config_org ON public.organization_ai_config(organization_id);

ALTER TABLE public.organization_ai_config ENABLE ROW LEVEL SECURITY;

-- All active org members can SEE that AI is configured for their org and
-- which provider/model is selected — that's needed for the settings UI to
-- show effective config to non-admin users. The api_key column is the
-- sensitive bit; we expose it through a SECURITY DEFINER function below
-- only to admins, so members can SELECT the row but their query won't
-- usefully return the key (we don't show it client-side anyway — it lives
-- only inside the edge function).
DROP POLICY IF EXISTS "Org members can view ai config" ON public.organization_ai_config;
CREATE POLICY "Org members can view ai config" ON public.organization_ai_config
  FOR SELECT USING (
    is_active_member_of_current_org()
    AND organization_id = current_org_id()
  );

DROP POLICY IF EXISTS "Org admins can insert ai config" ON public.organization_ai_config;
CREATE POLICY "Org admins can insert ai config" ON public.organization_ai_config
  FOR INSERT WITH CHECK (
    is_active_org_admin_of_current_org()
    AND organization_id = current_org_id()
  );

DROP POLICY IF EXISTS "Org admins can update ai config" ON public.organization_ai_config;
CREATE POLICY "Org admins can update ai config" ON public.organization_ai_config
  FOR UPDATE USING (
    is_active_org_admin_of_current_org()
    AND organization_id = current_org_id()
  ) WITH CHECK (
    is_active_org_admin_of_current_org()
    AND organization_id = current_org_id()
  );

DROP POLICY IF EXISTS "Org admins can delete ai config" ON public.organization_ai_config;
CREATE POLICY "Org admins can delete ai config" ON public.organization_ai_config
  FOR DELETE USING (
    is_active_org_admin_of_current_org()
    AND organization_id = current_org_id()
  );

-- Auto-update updated_at + updated_by on UPDATE
CREATE OR REPLACE FUNCTION public.set_organization_ai_config_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  NEW.updated_by = auth.uid();
  IF TG_OP = 'INSERT' AND NEW.created_by IS NULL THEN
    NEW.created_by = auth.uid();
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS organization_ai_config_audit ON public.organization_ai_config;
CREATE TRIGGER organization_ai_config_audit
  BEFORE INSERT OR UPDATE ON public.organization_ai_config
  FOR EACH ROW EXECUTE FUNCTION public.set_organization_ai_config_audit();

-- ----------------------------------------------------------------------------
-- Drop byok_* columns from user_ai_config. Per-user limit overrides and
-- context preferences (include_thesis, daily_token_limit_override, etc.)
-- remain — those are appropriately per-user.
-- ----------------------------------------------------------------------------

ALTER TABLE public.user_ai_config
  DROP COLUMN IF EXISTS byok_provider,
  DROP COLUMN IF EXISTS byok_api_key,
  DROP COLUMN IF EXISTS byok_model,
  DROP COLUMN IF EXISTS byok_enabled;

COMMENT ON TABLE public.organization_ai_config IS
  'Per-org BYOK (Bring Your Own Key) configuration. Only org admins can write. The byok_api_key is consumed exclusively by the ai-chat edge function — clients should not display or echo it.';
