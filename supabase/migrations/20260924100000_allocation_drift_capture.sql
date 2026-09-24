-- Allocation: capture two tables that reached production without a migration.
--
-- `allocation_cell_notes` and `allocation_team_members` exist in production
-- with RLS enabled and policies attached, but no migration in this repository
-- creates them. They were verified by reading the live catalog on 2026-09-24:
-- the column lists and policy predicates below are transcriptions of what is
-- actually there, not a redesign.
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
