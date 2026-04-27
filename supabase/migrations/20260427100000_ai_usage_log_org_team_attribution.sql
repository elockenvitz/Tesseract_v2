-- Add org/team attribution to ai_usage_log so usage can be grouped
-- by firm and by pod/team for billing and reporting. Both nullable
-- because (a) the table is empty today, and (b) some platform-level
-- system calls may not have a clear org/team owner.

ALTER TABLE public.ai_usage_log
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS team_id         uuid REFERENCES public.teams(id)         ON DELETE SET NULL;

-- Reporting queries: SUM(cost) WHERE organization_id = X AND created_at >= ...
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_org_created
  ON public.ai_usage_log (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_usage_log_team_created
  ON public.ai_usage_log (team_id, created_at DESC)
  WHERE team_id IS NOT NULL;

COMMENT ON COLUMN public.ai_usage_log.organization_id IS
  'Org the user belonged to at request time. Captured at insert; not retroactively updated if the user later changes orgs.';

COMMENT ON COLUMN public.ai_usage_log.team_id IS
  'Optional team/pod the user belonged to at request time. Used for pod-shop usage attribution. NULL if user has no team or is in multiple teams without a default.';
