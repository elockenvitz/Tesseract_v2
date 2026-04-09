-- ============================================================
-- Bug Reports — In-App Issue Reporting
-- ============================================================

CREATE TABLE IF NOT EXISTS bug_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  reported_by UUID NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT,
  severity TEXT NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'investigating', 'resolved', 'closed', 'wont_fix')),
  page_url TEXT,
  browser_info JSONB,
  console_errors JSONB,
  metadata JSONB DEFAULT '{}',
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE bug_reports ENABLE ROW LEVEL SECURITY;

-- Users can view their own reports
CREATE POLICY "Bug reports: users can read own reports"
  ON bug_reports FOR SELECT TO authenticated
  USING (reported_by = auth.uid());

-- Org admins can view all reports in their org
CREATE POLICY "Bug reports: org admins can read org reports"
  ON bug_reports FOR SELECT TO authenticated
  USING (
    organization_id = current_org_id()
    AND is_active_org_admin_of_current_org()
  );

-- Platform admins can read all reports
CREATE POLICY "Bug reports: platform admins can read all"
  ON bug_reports FOR SELECT TO authenticated
  USING (is_platform_admin());

-- Users can submit reports for their own org
CREATE POLICY "Bug reports: users can insert"
  ON bug_reports FOR INSERT TO authenticated
  WITH CHECK (
    reported_by = auth.uid()
    AND organization_id = current_org_id()
  );

-- Platform admins can update any report (status changes)
CREATE POLICY "Bug reports: platform admins can update"
  ON bug_reports FOR UPDATE TO authenticated
  USING (is_platform_admin());

CREATE INDEX IF NOT EXISTS idx_bug_reports_org ON bug_reports(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_bug_reports_reporter ON bug_reports(reported_by);
CREATE INDEX IF NOT EXISTS idx_bug_reports_status ON bug_reports(status);
