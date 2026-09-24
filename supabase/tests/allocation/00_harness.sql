-- Allocation security harness: principals, assertions, and the two fixtures.
--
-- Everything here runs against a DISPOSABLE database. It creates organisations
-- and users, flips RLS contexts, and rolls back. Never point it at production.
--
-- The point of the harness is that every case below runs as a real
-- `authenticated` principal with a real JWT claim, so the policies are what
-- decides the outcome. Calling `is_allocation_team_admin()` directly would
-- prove the function works and nothing about whether the policies use it.

\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS alloc_test;

-- ── Assertions ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION alloc_test.ok(p_label text, p_actual boolean, p_expected boolean)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'FAIL  %  (expected %, got %)', p_label, p_expected, p_actual;
  END IF;
  RAISE NOTICE 'ok    %', p_label;
END $$;

CREATE OR REPLACE FUNCTION alloc_test.eq(p_label text, p_actual anyelement, p_expected anyelement)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'FAIL  %  (expected %, got %)', p_label, p_expected, p_actual;
  END IF;
  RAISE NOTICE 'ok    %', p_label;
END $$;

/*
 * Did the database refuse this statement?
 *
 * An RLS refusal on INSERT/UPDATE surfaces as `new row violates row-level
 * security policy` (check_violation). A refusal on DELETE or a filtered
 * UPDATE surfaces as zero rows affected, not an error — so callers that test
 * those use `alloc_test.affected()` instead. Distinguishing the two is the
 * difference between "the policy rejected it" and "the policy silently
 * matched nothing", and both are correct outcomes for different commands.
 */
CREATE OR REPLACE FUNCTION alloc_test.refused(p_sql text)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION
  WHEN insufficient_privilege OR check_violation THEN RETURN true;
END $$;

/** Rows actually touched — for DELETE/UPDATE, where RLS filters rather than errors. */
CREATE OR REPLACE FUNCTION alloc_test.affected(p_sql text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
EXCEPTION
  WHEN insufficient_privilege OR check_violation THEN RETURN -1;  -- refused outright
END $$;

/** How many rows of a table this principal can actually see. */
CREATE OR REPLACE FUNCTION alloc_test.visible(p_table text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE format('SELECT count(*) FROM public.%I', p_table) INTO n;
  RETURN n;
END $$;

-- ── Principals ─────────────────────────────────────────────────────────────
--
-- `current_org_id()` reads `users.current_organization_id` AND requires an
-- active `organization_memberships` row, so becoming a principal means both
-- must already be set. The helper only swaps the JWT claim.

CREATE OR REPLACE FUNCTION alloc_test.become(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;

/** Back to the owner, for fixture manipulation between cases. */
CREATE OR REPLACE FUNCTION alloc_test.become_service()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- ── Identities ─────────────────────────────────────────────────────────────
--
-- Fixed UUIDs so every case file can refer to the same principals without
-- threading state, and so a failure message names something recognisable.

CREATE OR REPLACE VIEW alloc_test.ids AS SELECT
  '00000000-0000-4000-a000-00000000000a'::uuid AS org_a,
  '00000000-0000-4000-a000-00000000000b'::uuid AS org_b,
  '00000000-0000-4000-b000-000000000001'::uuid AS u_member_a,
  '00000000-0000-4000-b000-000000000002'::uuid AS u_invest_a,
  '00000000-0000-4000-b000-000000000003'::uuid AS u_orgadmin_a,
  '00000000-0000-4000-b000-000000000004'::uuid AS u_teamadmin_a,
  '00000000-0000-4000-b000-000000000005'::uuid AS u_teamadmin_b,
  '00000000-0000-4000-b000-000000000006'::uuid AS u_orgadmin_b,
  '00000000-0000-4000-b000-000000000007'::uuid AS u_inactive_a,
  '00000000-0000-4000-c000-000000000001'::uuid AS period_a,
  '00000000-0000-4000-c000-000000000002'::uuid AS period_b,
  '00000000-0000-4000-d000-000000000001'::uuid AS ac_a1,
  '00000000-0000-4000-d000-000000000002'::uuid AS ac_b1;

-- ── Fixture: organisations, users, memberships ─────────────────────────────

CREATE OR REPLACE FUNCTION alloc_test.seed_tenants()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE i record;
BEGIN
  PERFORM alloc_test.become_service();

  INSERT INTO organizations (id, name)
  SELECT x.id, x.nm FROM (VALUES
    ((SELECT org_a FROM alloc_test.ids), 'Org A'),
    ((SELECT org_b FROM alloc_test.ids), 'Org B')
  ) AS x(id, nm)
  ON CONFLICT (id) DO NOTHING;

  -- Users, each anchored to the org they act in.
  FOR i IN
    SELECT * FROM (VALUES
      ((SELECT u_member_a    FROM alloc_test.ids), 'member-a@test',    (SELECT org_a FROM alloc_test.ids), false),
      ((SELECT u_invest_a    FROM alloc_test.ids), 'invest-a@test',    (SELECT org_a FROM alloc_test.ids), false),
      ((SELECT u_orgadmin_a  FROM alloc_test.ids), 'orgadmin-a@test',  (SELECT org_a FROM alloc_test.ids), true),
      ((SELECT u_teamadmin_a FROM alloc_test.ids), 'teamadmin-a@test', (SELECT org_a FROM alloc_test.ids), false),
      ((SELECT u_inactive_a  FROM alloc_test.ids), 'inactive-a@test',  (SELECT org_a FROM alloc_test.ids), false),
      ((SELECT u_teamadmin_b FROM alloc_test.ids), 'teamadmin-b@test', (SELECT org_b FROM alloc_test.ids), false),
      ((SELECT u_orgadmin_b  FROM alloc_test.ids), 'orgadmin-b@test',  (SELECT org_b FROM alloc_test.ids), true)
    ) AS t(uid, email, org, is_admin)
  LOOP
    INSERT INTO users (id, email, current_organization_id)
    VALUES (i.uid, i.email, i.org)
    ON CONFLICT (id) DO UPDATE SET current_organization_id = EXCLUDED.current_organization_id;

    INSERT INTO organization_memberships (user_id, organization_id, status, is_org_admin)
    VALUES (i.uid, i.org, 'active', i.is_admin)
    ON CONFLICT (user_id, organization_id) DO UPDATE
      SET status = 'active', is_org_admin = EXCLUDED.is_org_admin;
  END LOOP;
END $$;

-- ── Fixture A: fresh-migration state ───────────────────────────────────────
--
-- What a Supabase branch actually gives us: schema from repository migrations,
-- no data. Asset classes and periods are created post-M2, so they already
-- carry `organization_id`.

CREATE OR REPLACE FUNCTION alloc_test.seed_fresh()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM alloc_test.seed_tenants();
  PERFORM alloc_test.become_service();

  INSERT INTO asset_classes (id, name, organization_id)
  VALUES ((SELECT ac_a1 FROM alloc_test.ids), 'Equities', (SELECT org_a FROM alloc_test.ids)),
         ((SELECT ac_b1 FROM alloc_test.ids), 'Equities', (SELECT org_b FROM alloc_test.ids))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO allocation_periods (id, name, start_date, end_date, organization_id)
  VALUES ((SELECT period_a FROM alloc_test.ids), 'Q1 A', '2026-01-01', '2026-03-31',
          (SELECT org_a FROM alloc_test.ids)),
         ((SELECT period_b FROM alloc_test.ids), 'Q1 B', '2026-01-01', '2026-03-31',
          (SELECT org_b FROM alloc_test.ids))
  ON CONFLICT (id) DO NOTHING;

  -- One published view per org, so cross-tenant reads have something to fail
  -- to see.
  INSERT INTO official_allocation_views (period_id, asset_class_id, view)
  VALUES ((SELECT period_a FROM alloc_test.ids), (SELECT ac_a1 FROM alloc_test.ids), 'overweight'),
         ((SELECT period_b FROM alloc_test.ids), (SELECT ac_b1 FROM alloc_test.ids), 'underweight')
  ON CONFLICT (period_id, asset_class_id) DO NOTHING;
END $$;

/** Put someone on the allocation team. Service-role, i.e. fixture setup. */
CREATE OR REPLACE FUNCTION alloc_test.grant_team(p_user uuid, p_org uuid, p_role text, p_active boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM alloc_test.become_service();
  INSERT INTO allocation_team_members (user_id, organization_id, role, is_active)
  VALUES (p_user, p_org, p_role, p_active)
  ON CONFLICT (organization_id, user_id) DO UPDATE
    SET role = EXCLUDED.role, is_active = EXCLUDED.is_active;
END $$;

CREATE OR REPLACE FUNCTION alloc_test.clear_team()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM alloc_test.become_service();
  DELETE FROM allocation_team_members;
END $$;
