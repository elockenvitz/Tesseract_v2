-- =============================================================================
-- C1/11 — least privilege on the C1 tables
--
-- Two separate problems, deliberately not conflated.
--
-- 1. `anon` holds DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE on
--    every C1 table. Those grants are currently INERT, because every policy on
--    these tables is `TO authenticated` and anon therefore matches no policy —
--    the confirmed exposure was authenticated cross-tenant reads, not anonymous
--    leakage. A grant that is inert only because a policy happens not to name
--    the role is one policy edit away from live, so it goes.
--
-- 2. `authenticated` holds TRUNCATE (and REFERENCES/TRIGGER) on these tables.
--    **RLS does not apply to TRUNCATE**, so nothing in C1's policy work
--    constrains it. Stated with its limits: PostgREST does not emit TRUNCATE,
--    and the anon/authenticated roles are not reachable over a direct Postgres
--    connection without the database password, so this is a least-privilege
--    defect with NO demonstrated exploit path — not a live destructive
--    capability. It is fixed here for the tables C1 is already touching.
--
-- SCOPE. The same over-granting exists on 271 tables for anon and 293 for
-- authenticated. That schema-wide cleanup is a separate hardening item
-- (docs/security/least-privilege-truncate.md) and is deliberately NOT done
-- here: widening a tenant-boundary release into hundreds of unrelated tables
-- would make it unreviewable.
--
-- `assets` is handled by 09, which replaced its table grants with a column
-- list; only its anon grants are revoked here.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  t text;
  c1_tables text[] := ARRAY[
    'tdf_holdings', 'tdf_holdings_snapshots', 'theme_assets', 'object_links',
    'scenarios', 'asset_revisions', 'asset_revision_events',
    'asset_contributions', 'contribution_visibility_targets',
    'asset_contribution_history', 'asset_field_history',
    'asset_workflow_progress', 'asset_workflow_priorities'
  ];
BEGIN
  FOREACH t IN ARRAY c1_tables LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM authenticated', t);
  END LOOP;

  -- assets keeps its column-level grants from 09; only anon is stripped.
  EXECUTE 'REVOKE ALL ON public.assets FROM anon';
  EXECUTE 'REVOKE TRUNCATE, TRIGGER ON public.assets FROM authenticated';
END $$;

DO $$
DECLARE
  anon_left int;
  trunc_left int;
  c1_tables text[] := ARRAY[
    'tdf_holdings', 'tdf_holdings_snapshots', 'theme_assets', 'object_links',
    'scenarios', 'asset_revisions', 'asset_revision_events',
    'asset_contributions', 'contribution_visibility_targets',
    'asset_contribution_history', 'asset_field_history',
    'asset_workflow_progress', 'asset_workflow_priorities', 'assets'
  ];
BEGIN
  SELECT count(*) INTO anon_left FROM information_schema.role_table_grants
   WHERE table_schema='public' AND grantee='anon' AND table_name = ANY(c1_tables);
  IF anon_left > 0 THEN
    RAISE EXCEPTION 'C1/11: % anon grant(s) remain on C1 tables', anon_left;
  END IF;

  SELECT count(*) INTO trunc_left FROM information_schema.role_table_grants
   WHERE table_schema='public' AND grantee='authenticated'
     AND privilege_type='TRUNCATE' AND table_name = ANY(c1_tables);
  IF trunc_left > 0 THEN
    RAISE EXCEPTION 'C1/11: % TRUNCATE grant(s) remain for authenticated on C1 tables', trunc_left;
  END IF;

  RAISE NOTICE 'C1/11: anon revoked and TRUNCATE removed across % C1 tables', array_length(c1_tables,1);
END $$;

COMMIT;
