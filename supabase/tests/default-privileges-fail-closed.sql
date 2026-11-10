-- =============================================================================
-- Default privileges must fail closed  (P3-3)
--
-- Guards the fix in
-- supabase/migrations/20261109210001_sec_default_privileges_fail_closed.sql.
--
-- THE DEFECT
--
--   Supabase's bootstrap runs, for BOTH postgres and supabase_admin:
--
--     ALTER DEFAULT PRIVILEGES IN SCHEMA public
--       GRANT ALL ON TABLES TO anon, authenticated, service_role;
--
--   So every table ever created in `public` arrived granting all eight
--   privileges to `anon`, TRUNCATE included. That is the generator of the P3-2
--   finding: sweeping the 185 existing tables without correcting this would
--   have left the next table to arrive with the hole again.
--
-- ── Why this test CREATES A TABLE instead of reading pg_default_acl ───────
--
-- Reading the catalog proves what the entry says. Creating a table proves what
-- a table gets, which is the thing that actually matters, and it folds in
-- every other source of privilege at once -- a second default-privilege entry,
-- a schema-level grant, role membership. The user asked for validation by
-- actual object creation, and it is also simply the stronger check.
--
-- Everything happens inside the suite's transaction and the probe tables are
-- dropped before it ends. They are named __dp_probe_* so that if a run is ever
-- interrupted they are obvious and inert.
--
-- ── Expected results ──────────────────────────────────────────────────────
--
--   BEFORE the migration:
--       3 PASS, 3 FAIL - assertions 1, 2 and 3 MUST fail.
--       Measured, a table created before the fix granted anon:
--         DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--       and anon's effective reach on it was SELECT=t TRUNCATE=t INSERT=t.
--
--   AFTER the migration:
--       6 PASS, 0 FAIL.
--
-- Assertions 4, 5 and 6 pass in BOTH states, each for its own reason, and the
-- distinction matters when reading a run:
--
--   4  PRE-EMPTIVE. There is no PUBLIC default-privilege entry in `public`
--      today, so this passes before the fix as well. It is here because the
--      forward migration revokes from PUBLIC anyway: a revoke from anon does
--      not remove a PUBLIC grant, and PUBLIC is the quietest way this hole
--      could return. An expected-results line claiming this one fails first
--      would be wrong, and was corrected after the first measured run.
--   5,6 PRESERVE. A new table must still be usable by the application and by
--      the trusted roles without a hand-written grant. A "fix" that revoked
--      the authenticated default entirely would pass 1-4 and mean every future
--      migration silently creates a table the app cannot read.
--
-- ── KNOWN GAP, asserted rather than hidden ───────────────────────────────
--
-- Assertion 7 is INFORMATIONAL and never fails the suite. The
-- supabase_admin half of the default privileges cannot be corrected from this
-- connection -- ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin returns 42501,
-- because postgres is not a member of supabase_admin and is not a superuser.
-- All 295 tables in `public` are owned by postgres, so that entry has produced
-- nothing to date; it would apply only to an object the platform creates here.
-- The assertion records the live state of that gap on every run so it cannot be
-- forgotten, and the CI privilege guard is the compensating control.
--
-- Self-cleaning. 6 scored assertions + 1 informational.
-- =============================================================================

DROP TABLE IF EXISTS _dp_results;
CREATE TEMP TABLE _dp_results(n int, result text, detail text);

DO $$
DECLARE
  v_privs  text;
  v_count  int;
  v_pass   int := 0;
  v_fail   int := 0;
BEGIN
  RAISE NOTICE '=== default privileges fail closed ===';

  -- Create the subject. Everything below reads this table's actual ACL.
  CREATE TABLE public.__dp_probe (id uuid PRIMARY KEY DEFAULT gen_random_uuid());

  -- ===========================================================================
  -- 1. THE FINDING. A brand-new table must grant anon nothing at all.
  -- ===========================================================================
  SELECT string_agg(a.privilege_type, ',' ORDER BY a.privilege_type) INTO v_privs
    FROM pg_class c, aclexplode(c.relacl) a
   WHERE c.relnamespace = 'public'::regnamespace AND c.relname = '__dp_probe'
     AND a.grantee::regrole::text = 'anon';
  IF v_privs IS NULL THEN
    v_pass := v_pass + 1; INSERT INTO _dp_results VALUES (1,'PASS','a new table grants anon nothing');
  ELSE
    v_fail := v_fail + 1; INSERT INTO _dp_results VALUES (1,'FAIL',format('a new table grants anon: %s', v_privs));
  END IF;

  -- ===========================================================================
  -- 2. THE FINDING, effective. The ACL being empty and anon actually being
  --    refused are different claims; membership and PUBLIC can supply reach
  --    with no ACL entry of their own.
  -- ===========================================================================
  IF NOT has_table_privilege('anon','public.__dp_probe','SELECT')
     AND NOT has_table_privilege('anon','public.__dp_probe','TRUNCATE')
     AND NOT has_table_privilege('anon','public.__dp_probe','INSERT') THEN
    v_pass := v_pass + 1; INSERT INTO _dp_results VALUES (2,'PASS','anon has no effective reach on a new table');
  ELSE
    v_fail := v_fail + 1; INSERT INTO _dp_results VALUES (2,'FAIL',
      format('anon effective on a new table: SELECT=%s TRUNCATE=%s INSERT=%s',
        has_table_privilege('anon','public.__dp_probe','SELECT'),
        has_table_privilege('anon','public.__dp_probe','TRUNCATE'),
        has_table_privilege('anon','public.__dp_probe','INSERT')));
  END IF;

  -- ===========================================================================
  -- 3. THE FINDING. authenticated must not inherit the four RLS-exempt
  --    privileges on a new table.
  -- ===========================================================================
  SELECT count(*) INTO v_count
    FROM pg_class c, aclexplode(c.relacl) a
   WHERE c.relnamespace = 'public'::regnamespace AND c.relname = '__dp_probe'
     AND a.grantee::regrole::text = 'authenticated'
     AND a.privilege_type IN ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN');
  IF v_count = 0 THEN
    v_pass := v_pass + 1; INSERT INTO _dp_results VALUES (3,'PASS','a new table grants authenticated none of the four RLS-exempt privileges');
  ELSE
    v_fail := v_fail + 1; INSERT INTO _dp_results VALUES (3,'FAIL',format('a new table grants authenticated %s of the four', v_count));
  END IF;

  -- ===========================================================================
  -- 4. THE FINDING. PUBLIC must inherit nothing.
  -- ===========================================================================
  SELECT string_agg(a.privilege_type, ',' ORDER BY a.privilege_type) INTO v_privs
    FROM pg_class c, aclexplode(c.relacl) a
   WHERE c.relnamespace = 'public'::regnamespace AND c.relname = '__dp_probe'
     AND a.grantee::regrole::text = '-';
  IF v_privs IS NULL THEN
    v_pass := v_pass + 1; INSERT INTO _dp_results VALUES (4,'PASS','a new table grants PUBLIC nothing');
  ELSE
    v_fail := v_fail + 1; INSERT INTO _dp_results VALUES (4,'FAIL',format('a new table grants PUBLIC: %s', v_privs));
  END IF;

  -- ===========================================================================
  -- 5. PRESERVE. authenticated must still get the four verbs RLS governs, or
  --    every future migration creates a table the application cannot read and
  --    the omission surfaces as an unexplained 42501 in the browser.
  -- ===========================================================================
  IF has_table_privilege('authenticated','public.__dp_probe','SELECT')
     AND has_table_privilege('authenticated','public.__dp_probe','INSERT')
     AND has_table_privilege('authenticated','public.__dp_probe','UPDATE')
     AND has_table_privilege('authenticated','public.__dp_probe','DELETE') THEN
    v_pass := v_pass + 1; INSERT INTO _dp_results VALUES (5,'PASS','a new table still grants authenticated SELECT/INSERT/UPDATE/DELETE');
  ELSE
    v_fail := v_fail + 1; INSERT INTO _dp_results VALUES (5,'FAIL','OVER-REVOKED: a new table is unreadable by the application');
  END IF;

  -- ===========================================================================
  -- 6. PRESERVE. The trusted roles must still get everything, so an ingestion
  --    or maintenance job needs no hand-written grant.
  -- ===========================================================================
  IF has_table_privilege('service_role','public.__dp_probe','SELECT')
     AND has_table_privilege('service_role','public.__dp_probe','TRUNCATE')
     AND has_table_privilege('postgres','public.__dp_probe','TRUNCATE') THEN
    v_pass := v_pass + 1; INSERT INTO _dp_results VALUES (6,'PASS','a new table still grants service_role and postgres the full set');
  ELSE
    v_fail := v_fail + 1; INSERT INTO _dp_results VALUES (6,'FAIL','OVER-REVOKED: a trusted role lost a privilege on a new table');
  END IF;

  -- ===========================================================================
  -- 7. INFORMATIONAL, never fails. The supabase_admin default-privilege entry
  --    cannot be corrected from this connection (42501). Recorded on every run
  --    so the gap stays visible.
  -- ===========================================================================
  SELECT count(*) INTO v_count
    FROM pg_default_acl d
   WHERE d.defaclnamespace = 'public'::regnamespace
     AND d.defaclrole = 'supabase_admin'::regrole
     AND d.defaclacl::text LIKE '%anon=%';
  INSERT INTO _dp_results VALUES (7,'INFO',
    format('supabase_admin default-privilege entries still granting anon: %s (expected 3; not fixable as postgres, see the migration header). Tables in public owned by supabase_admin: %s',
      v_count,
      (SELECT count(*) FROM pg_class c WHERE c.relnamespace='public'::regnamespace
         AND c.relkind IN ('r','p') AND pg_get_userbyid(c.relowner) = 'supabase_admin')));

  DROP TABLE public.__dp_probe;

  RAISE NOTICE '';
  RAISE NOTICE '=== RESULTS: % passed, % failed out of 6 scored assertions ===', v_pass, v_fail;
  RAISE NOTICE 'Before the migration, 1, 2, 3 and 4 MUST be among the failures.';
END;
$$;

SELECT n, result, detail FROM _dp_results ORDER BY n, result;
