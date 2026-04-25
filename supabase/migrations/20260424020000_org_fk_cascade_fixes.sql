/**
 * Fix the FK constraints that block hard-deletion of an organization row.
 *
 * Context: Tesseract has TWO deletion paths for an org —
 *   1. Soft delete (the default): organization_governance.deletion_scheduled_at
 *      set, org-deletion-runner cron executes execute_org_deletion() which
 *      flips flags but keeps the row. Used for real clients — audit + recovery.
 *   2. Hard delete (pilot cleanup): a direct DELETE on organizations. Used
 *      when a pilot is abandoned and we want the data actually gone.
 *
 * This migration ONLY affects hard delete: 16 FKs that previously had
 * NO ACTION now have the correct cascade rule:
 *   - CASCADE for purely org-scoped data (audit, coverage, holdings,
 *     portfolios + their subtree, invites, per-org logs, morph sessions
 *     targeting the org).
 *   - SET NULL for cross-org platform signal we want to preserve across
 *     pilot churn (bug_reports).
 *
 * Soft-delete is untouched — execute_org_deletion never hard-deletes.
 */

-- CASCADE — org-scoped, meaningless without the org
ALTER TABLE public.organization_audit_log
  DROP CONSTRAINT IF EXISTS organization_audit_log_organization_id_fkey,
  ADD  CONSTRAINT organization_audit_log_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.organization_invites
  DROP CONSTRAINT IF EXISTS organization_invites_organization_id_fkey,
  ADD  CONSTRAINT organization_invites_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.user_sessions
  DROP CONSTRAINT IF EXISTS user_sessions_organization_id_fkey,
  ADD  CONSTRAINT user_sessions_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.holdings_integration_runs
  DROP CONSTRAINT IF EXISTS holdings_integration_runs_organization_id_fkey,
  ADD  CONSTRAINT holdings_integration_runs_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.holdings_upload_log
  DROP CONSTRAINT IF EXISTS holdings_upload_log_organization_id_fkey,
  ADD  CONSTRAINT holdings_upload_log_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.morph_sessions
  DROP CONSTRAINT IF EXISTS morph_sessions_target_org_id_fkey,
  ADD  CONSTRAINT morph_sessions_target_org_id_fkey
    FOREIGN KEY (target_org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.asset_contributions
  DROP CONSTRAINT IF EXISTS asset_contributions_organization_id_fkey,
  ADD  CONSTRAINT asset_contributions_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.contribution_visibility_targets
  DROP CONSTRAINT IF EXISTS contribution_visibility_targets_organization_id_fkey,
  ADD  CONSTRAINT contribution_visibility_targets_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.coverage
  DROP CONSTRAINT IF EXISTS coverage_organization_id_fkey,
  ADD  CONSTRAINT coverage_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.coverage_history
  DROP CONSTRAINT IF EXISTS coverage_history_organization_id_fkey,
  ADD  CONSTRAINT coverage_history_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.coverage_requests
  DROP CONSTRAINT IF EXISTS coverage_requests_organization_id_fkey,
  ADD  CONSTRAINT coverage_requests_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.portfolio_holdings_positions
  DROP CONSTRAINT IF EXISTS portfolio_holdings_positions_organization_id_fkey,
  ADD  CONSTRAINT portfolio_holdings_positions_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.portfolio_holdings_snapshots
  DROP CONSTRAINT IF EXISTS portfolio_holdings_snapshots_organization_id_fkey,
  ADD  CONSTRAINT portfolio_holdings_snapshots_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.portfolio_team_links
  DROP CONSTRAINT IF EXISTS portfolio_team_links_organization_id_fkey,
  ADD  CONSTRAINT portfolio_team_links_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.portfolios
  DROP CONSTRAINT IF EXISTS portfolios_organization_id_fkey,
  ADD  CONSTRAINT portfolios_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- SET NULL — cross-org platform signal preserved across pilot churn
ALTER TABLE public.bug_reports
  DROP CONSTRAINT IF EXISTS bug_reports_organization_id_fkey,
  ADD  CONSTRAINT bug_reports_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
