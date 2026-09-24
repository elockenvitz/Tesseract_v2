-- The two environments M1 has to survive, and the backfill's abort conditions.
--
-- M1 exists because two tables reached production without a migration. That
-- gives it two jobs that pull in opposite directions: against production it
-- must change nothing, and against a fresh database it must create exactly
-- what production already has. A migration that is only ever run in one of
-- those is only ever half tested.
--
-- Fixture B reconstructs the production-shaped pre-M1 state from synthetic
-- data — same schema and relational shape, none of the real rows.

\set ON_ERROR_STOP on
\i 00_harness.sql

-- ═══ Mode A0: fresh database, after M1 only ════════════════════════════════
--
-- Run this with the database reset to 20260924100000 and no further. It proves
-- M1 leaves a fresh database in the same PRE-hardening state production was
-- in — permissive policies included — because that is the state M2 and M3 are
-- written against. A drift capture that quietly created the hardened shape
-- would make the hardening migration untestable.

BEGIN;

SELECT alloc_test.eq('A0 legacy attachment policies present after M1',
  (SELECT count(*) FROM pg_policies
    WHERE schemaname='public' AND tablename='allocation_attachments'
      AND policyname IN ('Users can view allocation attachments',
                         'Team members can manage allocation attachments')), 2::bigint);

SELECT alloc_test.eq('A0 attachment read is still wide open after M1',
  (SELECT qual FROM pg_policies
    WHERE schemaname='public' AND tablename='allocation_attachments'
      AND policyname='Users can view allocation attachments'), 'true');

SELECT alloc_test.eq('A0 legacy cell-note policies present after M1',
  (SELECT count(*) FROM pg_policies
    WHERE schemaname='public' AND tablename='allocation_cell_notes'), 3::bigint);

SELECT alloc_test.eq('A0 legacy team policies present after M1',
  (SELECT count(*) FROM pg_policies
    WHERE schemaname='public' AND tablename='allocation_team_members'), 2::bigint);

ROLLBACK;

-- ─── apply 20260924100100 (M2) and 20260924100200 (M3) ─────────────────────

-- ═══ Mode A: fresh migration, all three applied ════════════════════════════
-- Precondition: the three allocation migrations have been applied to an
-- otherwise empty database.

BEGIN;

-- M3 replaced what M1 laid down: none of the legacy names survive.
SELECT alloc_test.eq('A  M3 replaced the legacy attachment policies',
  (SELECT count(*) FROM pg_policies
    WHERE schemaname='public' AND tablename='allocation_attachments'
      AND policyname IN ('Users can view allocation attachments',
                         'Team members can manage allocation attachments')), 0::bigint);

SELECT alloc_test.eq('A  attachments now have per-command policies',
  (SELECT count(*) FROM pg_policies
    WHERE schemaname='public' AND tablename='allocation_attachments'
      AND cmd IN ('SELECT','INSERT','UPDATE','DELETE')), 4::bigint);

SELECT alloc_test.eq('A  M1 created allocation_cell_notes',
  (SELECT count(*) FROM information_schema.tables
    WHERE table_schema='public' AND table_name='allocation_cell_notes'), 1::bigint);

SELECT alloc_test.eq('A  M1 created allocation_team_members',
  (SELECT count(*) FROM information_schema.tables
    WHERE table_schema='public' AND table_name='allocation_team_members'), 1::bigint);

-- Without this, M3 fails on a fresh database: it writes policies on a
-- relation nothing creates. That is the defect this file caught.
SELECT alloc_test.eq('A  M1 created allocation_attachments',
  (SELECT count(*) FROM information_schema.tables
    WHERE table_schema='public' AND table_name='allocation_attachments'), 1::bigint);

SELECT alloc_test.eq('A  attachments shape',
  (SELECT string_agg(column_name, ',' ORDER BY ordinal_position)
     FROM information_schema.columns
    WHERE table_schema='public' AND table_name='allocation_attachments'),
  'id,period_id,asset_class_id,file_name,file_path,file_size,file_type,'
  || 'attachment_type,description,uploaded_by,created_at,updated_at');

SELECT alloc_test.eq('A  attachments constraints reproduced',
  (SELECT count(*) FROM pg_constraint
    WHERE conrelid='public.allocation_attachments'::regclass
      AND conname IN ('allocation_attachments_pkey',
                      'allocation_attachments_period_id_fkey',
                      'allocation_attachments_asset_class_id_fkey',
                      'allocation_attachments_uploaded_by_fkey',
                      'allocation_attachments_attachment_type_check')), 5::bigint);

SELECT alloc_test.eq('A  attachments indexes reproduced',
  (SELECT count(*) FROM pg_indexes
    WHERE schemaname='public' AND tablename='allocation_attachments'
      AND indexname IN ('idx_allocation_attachments_period',
                        'idx_allocation_attachments_asset_class')), 2::bigint);

SELECT alloc_test.eq('A  attachments RLS enabled',
  (SELECT relrowsecurity FROM pg_class
    WHERE oid='public.allocation_attachments'::regclass), true);

-- The shape M1 claims to reproduce, column for column.
SELECT alloc_test.eq('A  cell notes shape',
  (SELECT string_agg(column_name, ',' ORDER BY ordinal_position)
     FROM information_schema.columns
    WHERE table_schema='public' AND table_name='allocation_cell_notes'),
  'id,period_id,asset_class_id,view_type,thesis_notes,updated_by,created_at,updated_at,organization_id');

SELECT alloc_test.eq('A  team members shape',
  (SELECT string_agg(column_name, ',' ORDER BY ordinal_position)
     FROM information_schema.columns
    WHERE table_schema='public' AND table_name='allocation_team_members'),
  'id,user_id,role,asset_class_assignments,is_active,added_by,created_at,updated_at,organization_id');

-- No table was created twice, and no policy duplicated by the guards.
SELECT alloc_test.eq('A  no duplicate policies anywhere in the domain',
  (SELECT count(*) FROM (
      SELECT tablename, policyname, count(*) AS n
        FROM pg_policies
       WHERE schemaname='public'
         AND (tablename LIKE 'allocation%' OR tablename IN ('asset_classes',
              'official_allocation_views','individual_allocation_views'))
       GROUP BY tablename, policyname HAVING count(*) > 1) d),
  0::bigint);

ROLLBACK;

-- ═══ Mode B: production-shaped, pre-M1 ═════════════════════════════════════
--
-- Run this against a database reset to the migration immediately BEFORE
-- 20260924100000, then apply M1/M2/M3 between the marked points.
--
-- It reconstructs what production actually looked like: drift tables already
-- present with their permissive policies, eight asset classes with no
-- organisation, eight official views resolving them to one org, one cell
-- note, and an empty allocation team.

BEGIN;

CREATE OR REPLACE FUNCTION alloc_test.seed_production_shape()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_org uuid := (SELECT org_a FROM alloc_test.ids);
  v_period uuid := (SELECT period_a FROM alloc_test.ids);
  i int;
  v_ac uuid;
BEGIN
  PERFORM alloc_test.seed_tenants();
  PERFORM alloc_test.become_service();

  -- The drift tables as they existed before source control caught up: no
  -- organization_id, and the permissive policies verbatim.
  CREATE TABLE IF NOT EXISTS allocation_cell_notes (
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

  CREATE TABLE IF NOT EXISTS allocation_team_members (
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

  -- Attachments, as production has them: nullable references, the check
  -- constraint, both indexes, and the two permissive policies.
  CREATE TABLE IF NOT EXISTS allocation_attachments (
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
  CREATE INDEX IF NOT EXISTS idx_allocation_attachments_period
    ON allocation_attachments USING btree (period_id);
  CREATE INDEX IF NOT EXISTS idx_allocation_attachments_asset_class
    ON allocation_attachments USING btree (asset_class_id);

  BEGIN
    CREATE POLICY "Users can view allocation cell notes"
      ON allocation_cell_notes FOR SELECT TO authenticated USING (true);
  EXCEPTION WHEN duplicate_object THEN NULL; END;

  BEGIN
    CREATE POLICY "Users can view allocation attachments"
      ON allocation_attachments FOR SELECT TO authenticated USING (true);
  EXCEPTION WHEN duplicate_object THEN NULL; END;

  BEGIN
    CREATE POLICY "Team members can manage allocation attachments"
      ON allocation_attachments FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM allocation_team_members m
                      WHERE m.user_id = auth.uid() AND m.is_active = true));
  EXCEPTION WHEN duplicate_object THEN NULL; END;

  INSERT INTO allocation_periods (id, name, start_date, end_date, organization_id)
  VALUES (v_period, 'Q1', '2026-01-01', '2026-03-31', v_org)
  ON CONFLICT (id) DO NOTHING;

  -- Eight asset classes with no owner, each referenced by one official view,
  -- which is what makes them deterministically resolvable.
  FOR i IN 1..8 LOOP
    v_ac := ('00000000-0000-4000-d000-' || lpad(i::text, 12, '0'))::uuid;
    INSERT INTO asset_classes (id, name) VALUES (v_ac, 'Class ' || i)
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO official_allocation_views (period_id, asset_class_id, view)
      VALUES (v_period, v_ac, 'market_weight')
      ON CONFLICT (period_id, asset_class_id) DO NOTHING;
  END LOOP;

  INSERT INTO allocation_cell_notes (period_id, asset_class_id, view_type, thesis_notes)
  VALUES (v_period, '00000000-0000-4000-d000-000000000001'::uuid, 'market_weight', 'note')
  ON CONFLICT DO NOTHING;
END $$;

SELECT alloc_test.seed_production_shape();

-- Record the state M1 must not disturb.
CREATE TEMP TABLE _pre AS
SELECT (SELECT count(*) FROM asset_classes)               AS ac,
       (SELECT count(*) FROM official_allocation_views)   AS oav,
       (SELECT count(*) FROM allocation_cell_notes)       AS notes,
       (SELECT array_agg(id ORDER BY id) FROM asset_classes) AS ac_ids;

-- ─── apply 20260924100000 (M1) here ────────────────────────────────────────

SELECT alloc_test.eq('B  M1 preserved asset class rows',
  (SELECT count(*) FROM asset_classes), (SELECT ac FROM _pre));
SELECT alloc_test.eq('B  M1 preserved official views',
  (SELECT count(*) FROM official_allocation_views), (SELECT oav FROM _pre));
SELECT alloc_test.eq('B  M1 preserved cell notes',
  (SELECT count(*) FROM allocation_cell_notes), (SELECT notes FROM _pre));
SELECT alloc_test.eq('B  M1 did not duplicate a policy',
  (SELECT count(*) FROM (
     SELECT tablename, policyname FROM pg_policies
      WHERE schemaname='public'
        AND tablename IN ('allocation_cell_notes','allocation_team_members',
                          'allocation_attachments')
      GROUP BY tablename, policyname HAVING count(*) > 1) d), 0::bigint);

-- M1 must not have touched an attachments table that was already there: same
-- policy count, same constraints, same indexes.
SELECT alloc_test.eq('B  M1 left attachment policies alone',
  (SELECT count(*) FROM pg_policies
    WHERE schemaname='public' AND tablename='allocation_attachments'), 2::bigint);
SELECT alloc_test.eq('B  M1 left attachment constraints alone',
  (SELECT count(*) FROM pg_constraint
    WHERE conrelid='public.allocation_attachments'::regclass), 5::bigint);
SELECT alloc_test.eq('B  M1 left attachment indexes alone',
  (SELECT count(*) FROM pg_indexes
    WHERE schemaname='public' AND tablename='allocation_attachments'), 3::bigint);

-- ─── apply 20260924100100 (M2) here ────────────────────────────────────────

SELECT alloc_test.eq('B  every asset class resolved to an org',
  (SELECT count(*) FROM asset_classes WHERE organization_id IS NULL), 0::bigint);
SELECT alloc_test.eq('B  all resolved to org A',
  (SELECT count(DISTINCT organization_id) FROM asset_classes), 1::bigint);
SELECT alloc_test.eq('B  asset class ids unchanged',
  (SELECT array_agg(id ORDER BY id) FROM asset_classes), (SELECT ac_ids FROM _pre));
SELECT alloc_test.eq('B  official views not orphaned',
  (SELECT count(*) FROM official_allocation_views o
     LEFT JOIN asset_classes ac ON ac.id = o.asset_class_id
    WHERE ac.id IS NULL), 0::bigint);
SELECT alloc_test.eq('B  global name uniqueness removed',
  (SELECT count(*) FROM pg_constraint WHERE conname='asset_classes_name_key'), 0::bigint);
SELECT alloc_test.eq('B  per-org name uniqueness added',
  (SELECT count(*) FROM pg_constraint WHERE conname='asset_classes_org_name_key'), 1::bigint);

-- The same name is now legal in a second organisation, which is the whole
-- reason for the swap.
SELECT alloc_test.ok('B  same name allowed in another org',
  alloc_test.refused($q$
    INSERT INTO asset_classes (name, organization_id)
    SELECT 'Class 1', org_b FROM alloc_test.ids
  $q$), false);

ROLLBACK;

-- ═══ Mode C: the backfill must abort, not guess ════════════════════════════
--
-- Two shapes M2 refuses. Both are run by reproducing M2's guard against a
-- deliberately broken fixture; the assertion is that it raises.

BEGIN;
SELECT alloc_test.seed_tenants();

CREATE OR REPLACE FUNCTION alloc_test.m2_guard() RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_bad int;
BEGIN
  WITH refs AS (
    SELECT asset_class_id, period_id FROM official_allocation_views
  ), resolved AS (
    SELECT ac.id, count(DISTINCT p.organization_id) AS org_count
      FROM asset_classes ac
      LEFT JOIN refs r ON r.asset_class_id = ac.id
      LEFT JOIN allocation_periods p ON p.id = r.period_id
     GROUP BY ac.id
  )
  SELECT count(*) INTO v_bad FROM resolved WHERE org_count <> 1;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ambiguous or unattributable asset classes: %', v_bad;
  END IF;
END $$;

-- C1: an asset class no allocation data references → zero orgs.
SAVEPOINT c1;
INSERT INTO asset_classes (id, name)
VALUES ('00000000-0000-4000-e000-000000000001'::uuid, 'Orphan');
SELECT alloc_test.ok('C1 zero-org asset class aborts the backfill',
  (SELECT alloc_test.refused('SELECT alloc_test.m2_guard()')), true);
ROLLBACK TO SAVEPOINT c1;

-- C2: an asset class referenced by two organisations' periods → ambiguous.
SAVEPOINT c2;
INSERT INTO allocation_periods (id, name, start_date, end_date, organization_id)
SELECT period_a, 'A', '2026-01-01', '2026-03-31', org_a FROM alloc_test.ids;
INSERT INTO allocation_periods (id, name, start_date, end_date, organization_id)
SELECT period_b, 'B', '2026-01-01', '2026-03-31', org_b FROM alloc_test.ids;
INSERT INTO asset_classes (id, name)
VALUES ('00000000-0000-4000-e000-000000000002'::uuid, 'Shared');
INSERT INTO official_allocation_views (period_id, asset_class_id, view)
SELECT period_a, '00000000-0000-4000-e000-000000000002'::uuid, 'market_weight' FROM alloc_test.ids;
INSERT INTO official_allocation_views (period_id, asset_class_id, view)
SELECT period_b, '00000000-0000-4000-e000-000000000002'::uuid, 'market_weight' FROM alloc_test.ids;
SELECT alloc_test.ok('C2 two-org asset class aborts the backfill',
  (SELECT alloc_test.refused('SELECT alloc_test.m2_guard()')), true);
ROLLBACK TO SAVEPOINT c2;

ROLLBACK;
