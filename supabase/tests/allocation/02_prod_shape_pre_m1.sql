-- The production-shaped pre-M1 state, from synthetic data.
--
-- Load after 01_local_baseline.sql and BEFORE M1, to exercise the other half
-- of M1's contract: against a database that already has the drift tables it
-- must change nothing at all.
--
-- Shapes and policy names are transcribed from the live catalog; the rows are
-- invented. Eight asset classes with no organisation, each referenced by one
-- official view, which is what makes them deterministically resolvable — the
-- same shape production is in, at the same counts.

\set ON_ERROR_STOP on

CREATE TABLE allocation_cell_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES allocation_periods(id) ON DELETE CASCADE,
  asset_class_id uuid NOT NULL REFERENCES asset_classes(id) ON DELETE CASCADE,
  view_type text NOT NULL,
  thesis_notes text,
  updated_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE allocation_cell_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view allocation cell notes"
  ON allocation_cell_notes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can insert allocation cell notes"
  ON allocation_cell_notes FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Users can update allocation cell notes"
  ON allocation_cell_notes FOR UPDATE TO authenticated USING (true);

CREATE TABLE allocation_team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'member',
  asset_class_assignments uuid[] DEFAULT '{}'::uuid[],
  is_active boolean DEFAULT true,
  added_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE allocation_team_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view allocation team members"
  ON allocation_team_members FOR SELECT TO authenticated USING (true);
-- The self-referential bootstrap deadlock, verbatim.
CREATE POLICY "Admins can manage allocation team members"
  ON allocation_team_members FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM allocation_team_members m
             WHERE m.user_id = auth.uid() AND m.role = 'admin')
  );

CREATE TABLE allocation_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid REFERENCES allocation_periods(id) ON DELETE CASCADE,
  asset_class_id uuid REFERENCES asset_classes(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_size bigint,
  file_type text,
  attachment_type text DEFAULT 'document'
    CHECK (attachment_type = ANY (ARRAY['document','model','presentation','spreadsheet','other'])),
  description text,
  uploaded_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE allocation_attachments ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_allocation_attachments_period ON allocation_attachments(period_id);
CREATE INDEX idx_allocation_attachments_asset_class ON allocation_attachments(asset_class_id);
CREATE POLICY "Users can view allocation attachments"
  ON allocation_attachments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Team members can manage allocation attachments"
  ON allocation_attachments FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM allocation_team_members m
                  WHERE m.user_id = auth.uid() AND m.is_active = true));

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;

-- Data at production's counts.
INSERT INTO organizations (id, name)
VALUES ('00000000-0000-4000-a000-00000000000a', 'Org A');

INSERT INTO allocation_periods (id, name, start_date, end_date, organization_id)
VALUES ('00000000-0000-4000-c000-000000000001', 'Q1',
        '2026-01-01', '2026-03-31', '00000000-0000-4000-a000-00000000000a');

INSERT INTO asset_classes (id, name)
SELECT ('00000000-0000-4000-d000-' || lpad(i::text, 12, '0'))::uuid, 'Class ' || i
FROM generate_series(1, 8) i;

INSERT INTO official_allocation_views (period_id, asset_class_id, view)
SELECT '00000000-0000-4000-c000-000000000001', id, 'market_weight' FROM asset_classes;

INSERT INTO allocation_cell_notes (period_id, asset_class_id, view_type)
VALUES ('00000000-0000-4000-c000-000000000001',
        '00000000-0000-4000-d000-000000000001', 'market_weight');
