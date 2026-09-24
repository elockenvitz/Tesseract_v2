-- What the catalog must say after M3.
--
-- Migrations completing is not evidence that policies are right. Postgres
-- combines permissive policies with OR, so a legacy `USING (true)` surviving
-- beside a new restrictive one leaves the table exactly as open as before
-- while every behavioural test that only checks the happy path still passes.
-- These read pg_policies and pg_proc directly and assert the shape.

\set ON_ERROR_STOP on
\i 00_harness.sql

BEGIN;

CREATE TEMP VIEW domain_tables AS
SELECT unnest(ARRAY[
  'asset_classes','allocation_periods','official_allocation_views',
  'individual_allocation_views','allocation_votes','allocation_comments',
  'allocation_history','allocation_cell_notes','allocation_attachments',
  'allocation_team_members'
]) AS t;

-- ── The domain is ten tables, and the inventory is taken from the catalog ──
--
-- Not from a name prefix. `allocation_team_members` holds neither `period_id`
-- nor `asset_class_id` and has no foreign key into either root, so a
-- relationship walk misses it; `official_allocation_views` and
-- `individual_allocation_views` do not start with "allocation", so a prefix
-- search misses them. Both mistakes were made while tracing this domain, and
-- each hid a table with an open policy on it.
--
-- This asserts the count so that a new allocation table arriving without being
-- classified fails here rather than being discovered later.

SELECT alloc_test.eq('domain is exactly the ten known tables',
  (SELECT count(*) FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r'
      AND (
        c.oid IN (SELECT DISTINCT conrelid FROM pg_constraint
                   WHERE confrelid IN ('public.allocation_periods'::regclass,
                                       'public.asset_classes'::regclass))
        OR c.relname IN ('allocation_periods','asset_classes','allocation_team_members')
        OR EXISTS (SELECT 1 FROM information_schema.columns col
                    WHERE col.table_schema='public' AND col.table_name=c.relname
                      AND col.column_name IN ('period_id','asset_class_id'))
      )), 10::bigint);

-- ── RLS is on, everywhere ──────────────────────────────────────────────────

SELECT alloc_test.eq('RLS enabled on all ten domain tables',
  (SELECT count(*) FROM domain_tables d
     JOIN pg_class c ON c.relname = d.t
     JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname='public'
    WHERE c.relrowsecurity), 10::bigint);

-- ── No permissive `true` survives ──────────────────────────────────────────
--
-- The single most important assertion in this file. `allocation_history` is
-- exempt from the write half only because it has no write policy at all.

SELECT alloc_test.eq('no USING (true) left in the domain',
  (SELECT count(*) FROM pg_policies p
     JOIN domain_tables d ON d.t = p.tablename
    WHERE p.schemaname='public' AND p.qual = 'true'), 0::bigint);

SELECT alloc_test.eq('no WITH CHECK (true) left in the domain',
  (SELECT count(*) FROM pg_policies p
     JOIN domain_tables d ON d.t = p.tablename
    WHERE p.schemaname='public' AND p.with_check = 'true'), 0::bigint);

-- ── Nothing duplicated ─────────────────────────────────────────────────────

SELECT alloc_test.eq('no duplicate policy names per table',
  (SELECT count(*) FROM (
     SELECT p.tablename, p.policyname FROM pg_policies p
       JOIN domain_tables d ON d.t = p.tablename
      WHERE p.schemaname='public'
      GROUP BY p.tablename, p.policyname HAVING count(*) > 1) x), 0::bigint);

-- Two permissive policies for the same command on the same table means the
-- weaker one wins, since they are ORed. The design has exactly one per
-- command, so more than one is a mistake rather than a style choice.
SELECT alloc_test.eq('at most one permissive policy per table per command',
  (SELECT count(*) FROM (
     SELECT p.tablename, p.cmd FROM pg_policies p
       JOIN domain_tables d ON d.t = p.tablename
      WHERE p.schemaname='public' AND p.permissive = 'PERMISSIVE'
      GROUP BY p.tablename, p.cmd HAVING count(*) > 1) x), 0::bigint);

-- ── Every table can still be read by its own org, and only by its own org ──

SELECT alloc_test.eq('every domain table has a SELECT policy',
  (SELECT count(*) FROM domain_tables d
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_policies p
       WHERE p.schemaname='public' AND p.tablename = d.t AND p.cmd = 'SELECT')),
  0::bigint);

-- ── history is read-only to clients ────────────────────────────────────────

SELECT alloc_test.eq('allocation_history has no write policy',
  (SELECT count(*) FROM pg_policies
    WHERE schemaname='public' AND tablename='allocation_history'
      AND cmd IN ('INSERT','UPDATE','DELETE','ALL')), 0::bigint);

-- ── official views are gated on the investment authority, not membership ───

SELECT alloc_test.eq('official view writes name the team-admin helper',
  (SELECT count(*) FROM pg_policies
    WHERE schemaname='public' AND tablename='official_allocation_views'
      AND cmd IN ('INSERT','UPDATE','DELETE')
      AND coalesce(qual,'') || coalesce(with_check,'') LIKE '%is_allocation_team_admin%'),
  3::bigint);

-- ── team membership is gated on ORG_ADMIN, and NOT on the team helper ──────
--
-- This is the separation of the two authorities, asserted structurally. If
-- `is_allocation_team_admin` ever appears here, an allocation-team admin can
-- appoint peers and the model has quietly collapsed.

SELECT alloc_test.eq('team membership writes name the org-admin helper',
  (SELECT count(*) FROM pg_policies
    WHERE schemaname='public' AND tablename='allocation_team_members'
      AND cmd IN ('INSERT','UPDATE','DELETE')
      AND coalesce(qual,'') || coalesce(with_check,'') LIKE '%is_org_admin_of%'),
  3::bigint);

SELECT alloc_test.eq('team membership does NOT name the team-admin helper',
  (SELECT count(*) FROM pg_policies
    WHERE schemaname='public' AND tablename='allocation_team_members'
      AND coalesce(qual,'') || coalesce(with_check,'') LIKE '%is_allocation_team_admin%'),
  0::bigint);

-- ── Helper security posture ────────────────────────────────────────────────

CREATE TEMP VIEW helpers AS
SELECT unnest(ARRAY[
  'is_allocation_team_member','is_allocation_team_admin',
  'allocation_period_in_current_org','allocation_asset_class_in_current_org',
  'is_org_admin_of'
]) AS fn;

SELECT alloc_test.eq('all five helpers exist',
  (SELECT count(*) FROM helpers h
     JOIN pg_proc p ON p.proname = h.fn
     JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname='public'), 5::bigint);

SELECT alloc_test.eq('all five are SECURITY DEFINER',
  (SELECT count(*) FROM helpers h
     JOIN pg_proc p ON p.proname = h.fn
     JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname='public'
    WHERE p.prosecdef), 5::bigint);

-- An unpinned search_path on a SECURITY DEFINER function is the classic
-- privilege-escalation hole: the caller chooses which `allocation_team_members`
-- it reads.
SELECT alloc_test.eq('all five pin search_path to public',
  (SELECT count(*) FROM helpers h
     JOIN pg_proc p ON p.proname = h.fn
     JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname='public'
    WHERE 'search_path=public' = ANY(coalesce(p.proconfig, ARRAY[]::text[]))), 5::bigint);

SELECT alloc_test.eq('all five return boolean only',
  (SELECT count(*) FROM helpers h
     JOIN pg_proc p ON p.proname = h.fn
     JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname='public'
    WHERE pg_get_function_result(p.oid) = 'boolean'), 5::bigint);

-- None takes a user id: the caller is always auth.uid(), so none can be asked
-- about somebody else.
SELECT alloc_test.eq('no helper accepts a user id',
  (SELECT count(*) FROM helpers h
     JOIN pg_proc p ON p.proname = h.fn
     JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname='public'
    WHERE pg_get_function_arguments(p.oid) ILIKE '%user%'), 0::bigint);

SELECT alloc_test.eq('anon cannot execute any helper',
  (SELECT count(*) FROM helpers h
     JOIN pg_proc p ON p.proname = h.fn
     JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname='public'
    WHERE has_function_privilege('anon', p.oid, 'EXECUTE')), 0::bigint);

SELECT alloc_test.eq('authenticated can execute every helper',
  (SELECT count(*) FROM helpers h
     JOIN pg_proc p ON p.proname = h.fn
     JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname='public'
    WHERE has_function_privilege('authenticated', p.oid, 'EXECUTE')), 5::bigint);

ROLLBACK;
