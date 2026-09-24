-- Allocation: capture three tables that reached production without a migration.
--
-- `allocation_cell_notes`, `allocation_team_members` and
-- `allocation_attachments` exist in production with RLS enabled and policies
-- attached, but no migration in this repository creates them. They were
-- verified by reading the live catalog on 2026-09-24: the column lists,
-- constraints, indexes and policy predicates below are transcriptions of what
-- is actually there, not a redesign.
--
-- The inventory was taken from the catalog rather than by name. The domain is
-- ten tables: everything holding a `period_id` or `asset_class_id`, everything
-- with a foreign key into `allocation_periods` or `asset_classes`, those two
-- themselves, and `allocation_team_members` — which has neither and is
-- reachable by neither, which is precisely why a prefix search is not an
-- inventory. Seven come from 20251127000001_add_allocation_framework.sql;
-- these three come from nowhere, and are captured here.
--
-- This migration therefore does two different jobs depending on where it runs:
--
--   * against production it is a no-op. Every object already exists, and every
--     guard below sees it and does nothing. Nothing is dropped, nothing is
--     recreated, no policy is replaced.
--   * against a fresh environment it creates the same pre-hardening shape, so
--     the migrations that follow have the same starting point everywhere.
--
-- It deliberately reproduces the INSECURE policies that exist today rather
-- than fixing them. Repairing them here would mean a fresh database never has
-- the state the next migrations are written against, and the repair would be
-- invisible in the file that performs it. The hardening is the next migration.
--
-- Note `CREATE POLICY IF NOT EXISTS` is not valid Postgres, hence the guards.
--
-- Wrapped in an explicit transaction. Three tables, two indexes and seven
-- policies are one baseline, not eleven independent facts, and a runner that
-- autocommits per statement — `psql -f` does — would leave a partial one
-- behind on failure. The migrations that follow are written against the whole
-- of it. Postgres does DDL transactionally; this only says so.

BEGIN;

-- ── allocation_cell_notes ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS allocation_cell_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES allocation_periods(id) ON DELETE CASCADE,
  asset_class_id uuid NOT NULL REFERENCES asset_classes(id) ON DELETE CASCADE,
  view_type text NOT NULL,
  thesis_notes text,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE allocation_cell_notes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                   AND tablename = 'allocation_cell_notes'
                   AND policyname = 'Users can view allocation cell notes') THEN
    CREATE POLICY "Users can view allocation cell notes"
      ON allocation_cell_notes FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                   AND tablename = 'allocation_cell_notes'
                   AND policyname = 'Users can insert allocation cell notes') THEN
    CREATE POLICY "Users can insert allocation cell notes"
      ON allocation_cell_notes FOR INSERT TO authenticated WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                   AND tablename = 'allocation_cell_notes'
                   AND policyname = 'Users can update allocation cell notes') THEN
    CREATE POLICY "Users can update allocation cell notes"
      ON allocation_cell_notes FOR UPDATE TO authenticated USING (true);
  END IF;
END $$;

-- ── allocation_team_members ────────────────────────────────────────────────
--
-- Note the production table has no `organization_id`: allocation-team
-- membership is currently global, so one team member is a team member of every
-- organisation. That is fixed in the next migration, not here — this file
-- records what is, so the repair has something to be a diff against.

CREATE TABLE IF NOT EXISTS allocation_team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  asset_class_assignments uuid[] DEFAULT '{}'::uuid[],
  is_active boolean DEFAULT true,
  added_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE allocation_team_members ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                   AND tablename = 'allocation_team_members'
                   AND policyname = 'Users can view allocation team members') THEN
    CREATE POLICY "Users can view allocation team members"
      ON allocation_team_members FOR SELECT TO authenticated USING (true);
  END IF;

  -- Self-referential: to be an admin you must already be an admin, and the
  -- table has zero rows, so nobody can ever satisfy it. Reproduced as-is;
  -- the next migration replaces it with an ORG_ADMIN bootstrap path.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                   AND tablename = 'allocation_team_members'
                   AND policyname = 'Admins can manage allocation team members') THEN
    CREATE POLICY "Admins can manage allocation team members"
      ON allocation_team_members FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM allocation_team_members m
          WHERE m.user_id = auth.uid() AND m.role = 'admin'
        )
        OR auth.uid() = (
          SELECT u.id FROM users u WHERE allocation_team_members.role = 'admin' LIMIT 1
        )
      );
  END IF;
END $$;

-- ── allocation_attachments ─────────────────────────────────────────────────
--
-- Files hung off a period or an asset class. Both references are nullable in
-- production, so an attachment may belong to a period, to an asset class, or
-- to neither — which is why the hardening migration's policies key off
-- `period_id` and tolerate the rest.
--
-- The legacy write policy below is the worst shape in the domain: membership
-- of the allocation team with no organisation on it at all, so one firm's team
-- member could attach to another firm's period. Reproduced verbatim, because
-- the next migration's job is to replace it and a diff needs two sides.

CREATE TABLE IF NOT EXISTS allocation_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid REFERENCES allocation_periods(id) ON DELETE CASCADE,
  asset_class_id uuid REFERENCES asset_classes(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_size bigint,
  file_type text,
  attachment_type text DEFAULT 'document'
    CHECK (attachment_type = ANY (ARRAY['document', 'model', 'presentation', 'spreadsheet', 'other'])),
  description text,
  uploaded_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE allocation_attachments ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_allocation_attachments_period
  ON allocation_attachments USING btree (period_id);
CREATE INDEX IF NOT EXISTS idx_allocation_attachments_asset_class
  ON allocation_attachments USING btree (asset_class_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                   AND tablename = 'allocation_attachments'
                   AND policyname = 'Users can view allocation attachments') THEN
    CREATE POLICY "Users can view allocation attachments"
      ON allocation_attachments FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                   AND tablename = 'allocation_attachments'
                   AND policyname = 'Team members can manage allocation attachments') THEN
    CREATE POLICY "Team members can manage allocation attachments"
      ON allocation_attachments FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM allocation_team_members m
          WHERE m.user_id = auth.uid() AND m.is_active = true
        )
      );
  END IF;
END $$;

COMMIT;
