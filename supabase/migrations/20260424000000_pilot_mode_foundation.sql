/**
 * Pilot Mode foundation.
 *
 * Adds:
 *   - users.is_pilot_user          per-user opt-in flag
 *   - is_current_pilot_session()   SQL helper (user flag OR org pilot_mode)
 *   - pilot_scenarios              staging table for Trade Lab landing
 *
 * Existing infra left alone:
 *   - organizations.settings.pilot_mode (already widely set for pilot clients)
 *   - organizations.settings.pilot_access (JSONB, read from app for per-feature
 *     overrides; defaults provided in TS so NULL is safe)
 */

-- Per-user flag
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_pilot_user boolean NOT NULL DEFAULT false;

-- Session helper (used from app; ready for RLS use if we need server-side gates later)
CREATE OR REPLACE FUNCTION public.is_current_pilot_session()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT u.is_pilot_user FROM public.users u WHERE u.id = auth.uid()),
    false
  ) OR COALESCE(
    (
      SELECT (o.settings->>'pilot_mode')::boolean
      FROM public.organizations o
      WHERE o.id = (SELECT u2.current_organization_id FROM public.users u2 WHERE u2.id = auth.uid())
    ),
    false
  );
$$;

-- Staging table
CREATE TABLE IF NOT EXISTS public.pilot_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  asset_id uuid REFERENCES public.assets(id) ON DELETE SET NULL,
  symbol text,
  direction text CHECK (direction IN ('buy','sell','add','trim','reduce','close','swap')),
  thesis text,
  why_now text,
  proposed_action text,
  proposed_sizing_input text,
  target_weight_pct numeric(7,4),
  delta_weight_pct numeric(7,4),
  portfolio_id uuid REFERENCES public.portfolios(id) ON DELETE SET NULL,
  trade_queue_item_id uuid REFERENCES public.trade_queue_items(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','archived')),
  assigned_at timestamptz,
  accepted_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pilot_scenarios_org       ON public.pilot_scenarios (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_pilot_scenarios_user      ON public.pilot_scenarios (user_id)    WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pilot_scenarios_portfolio ON public.pilot_scenarios (portfolio_id) WHERE portfolio_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.pilot_scenarios_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_pilot_scenarios_touch ON public.pilot_scenarios;
CREATE TRIGGER trg_pilot_scenarios_touch
BEFORE UPDATE ON public.pilot_scenarios
FOR EACH ROW EXECUTE FUNCTION public.pilot_scenarios_touch();

ALTER TABLE public.pilot_scenarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view pilot scenarios" ON public.pilot_scenarios;
CREATE POLICY "Org members can view pilot scenarios"
  ON public.pilot_scenarios FOR SELECT
  USING (organization_id = current_org_id());

DROP POLICY IF EXISTS "Org admins can manage pilot scenarios" ON public.pilot_scenarios;
CREATE POLICY "Org admins can manage pilot scenarios"
  ON public.pilot_scenarios FOR ALL
  USING (
    organization_id = current_org_id()
    AND EXISTS (
      SELECT 1 FROM public.organization_memberships om
      WHERE om.user_id = auth.uid()
        AND om.organization_id = pilot_scenarios.organization_id
        AND om.status = 'active'
        AND om.is_org_admin = true
    )
  )
  WITH CHECK (
    organization_id = current_org_id()
    AND EXISTS (
      SELECT 1 FROM public.organization_memberships om
      WHERE om.user_id = auth.uid()
        AND om.organization_id = pilot_scenarios.organization_id
        AND om.status = 'active'
        AND om.is_org_admin = true
    )
  );

DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.pilot_scenarios;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
