-- =============================================================================
-- P0 Tenant Boundary — post-deployment verification
--
-- READ-ONLY. Safe to run against production. Nothing here writes, and nothing
-- here reads user-generated content — only catalog metadata and counts.
--
-- Verifies 20260826100000 / …100100 / …100200: the client roles lost table-wide
-- write on `users`, column-level UPDATE was narrowed to an allowlist,
-- current_org_id() validates active membership, and the authority-column guard
-- trigger is installed.
--
-- ── WHAT WAS WRONG WITH THIS FILE, and why it is rewritten ─────────────────
--
-- Two defects, and the second is the one that mattered.
--
-- 1. MECHANICAL. It opened each section with a psql meta-command:
--
--      \echo '--- 1. authenticated no longer holds a table-wide UPDATE ---'
--
--    `\echo` is a psql CLIENT instruction, not SQL. The Supabase Management API
--    executes statements on the server with no psql in the path, so the first
--    backslash is a syntax error: 42601. The file could not run there at all.
--
-- 2. SUBSTANTIVE. Even with the meta-commands stripped it asserted NOTHING. It
--    was eight independent SELECTs, each with its expectation written beside it
--    in a comment -- "EXPECT: zero rows" -- for a human to compare by eye. A
--    file like that cannot fail. Run it after a regression and it returns a row
--    where it wanted none, exits 0, and the pipeline is green.
--
-- So it is converted to the assertion harness every other suite here uses: one
-- result set of PASS/FAIL rows, each expectation machine-checked. That is the
-- opposite of weakening the assertions -- it is the first time there were any.
--
-- ── Why aclexplode and pg_attribute instead of information_schema ──────────
--
-- The original read information_schema.role_table_grants and
-- .column_privileges. Those work here (16 and 153 rows for `users`, measured),
-- but only because the connecting role is a member of anon/authenticated:
-- information_schema shows a grant solely when the current user is its grantor,
-- its grantee, or a member of the grantee role. Run the same file as a role
-- without those memberships and the views go quiet, every "EXPECT: zero rows"
-- assertion is satisfied, and the suite passes while blind.
--
-- pg_class.relacl and pg_attribute.attacl are unconditional: they are the ACL
-- itself. A privilege audit must not be able to pass because it could not see.
--
-- ── Expected results ────────────────────────────────────────────────────────
--
--   AFTER the migrations (current production): 8 PASS, 0 FAIL.
--
--   Assertions 1-5 and 8 are the security half, and assertion 1 is proven
--   non-vacuous against production: inside a rolled-back transaction,
--
--     GRANT UPDATE ON public.users TO authenticated;
--
--   makes it report
--
--     1 FAIL  BROAD GRANT RESTORED on users: authenticated:UPDATE
--
--   which is the exact grant 20260826100000 removed. The pre-rewrite file
--   returned the same row and exited 0.
--
--   Assertions 6 and 7 are OPERATIONAL, not security: they count users stranded
--   in an org they are no longer an active member of. The one query that can
--   turn a security fix into an outage -- current_org_id() returns NULL for
--   them and their app goes empty until OrganizationContext self-heals. They
--   assert only that the number is KNOWN and reported, never that it is zero,
--   because a non-zero count here is a fact to see before a deploy rather than
--   a test failure.
--
-- Self-cleaning (writes nothing). 8 assertions.
-- =============================================================================

DROP TABLE IF EXISTS _p0_results;
CREATE TEMP TABLE _p0_results(n int, result text, detail text);

DO $$
DECLARE
  v_privs      text;
  v_cols       text;
  v_count      int;
  v_stranded   int;
  v_with_org   int;
  v_total      int;
  v_secdef     boolean;
  v_cfg        text;
  v_validates  boolean;
  v_enabled    "char";
  v_pass       int := 0;
  v_fail       int := 0;
  -- The allowlist 20260826100100 granted, in sorted order. A column added here
  -- without a migration, or one the migration granted and nobody expected, both
  -- show up as assertion 3 failing.
  k_allowlist  text := 'coverage_admin, email, first_name, last_name, pilot_progress, timezone, user_type';
BEGIN
  RAISE NOTICE '=== P0 tenant boundary verification ===';

  -- ===========================================================================
  -- 1. No table-wide INSERT/UPDATE/DELETE on `users` for either client role.
  --    This is the grant the migration removed. A row here means it is back.
  -- ===========================================================================
  SELECT string_agg(DISTINCT a.grantee::regrole::text || ':' || a.privilege_type, ', '
                    ORDER BY a.grantee::regrole::text || ':' || a.privilege_type)
    INTO v_privs
    FROM pg_class c, aclexplode(c.relacl) a
   WHERE c.relnamespace = 'public'::regnamespace AND c.relname = 'users'
     AND a.grantee::regrole::text IN ('authenticated','anon')
     AND a.privilege_type IN ('INSERT','UPDATE','DELETE');
  IF v_privs IS NULL THEN
    v_pass := v_pass + 1; INSERT INTO _p0_results VALUES (1,'PASS','no table-wide INSERT/UPDATE/DELETE on users for authenticated or anon');
  ELSE
    v_fail := v_fail + 1; INSERT INTO _p0_results VALUES (1,'FAIL',format('BROAD GRANT RESTORED on users: %s', v_privs));
  END IF;

  -- ===========================================================================
  -- 2. The authority columns are not column-level writable by a client role.
  --    current_organization_id is the tenancy authority: a client that can
  --    write it can move itself into another organization.
  -- ===========================================================================
  SELECT string_agg(DISTINCT a.grantee::regrole::text || '.' || att.attname, ', '
                    ORDER BY a.grantee::regrole::text || '.' || att.attname)
    INTO v_cols
    FROM pg_attribute att, aclexplode(att.attacl) a
   WHERE att.attrelid = 'public.users'::regclass
     AND att.attname IN ('current_organization_id','is_active','is_pilot_user')
     AND a.grantee::regrole::text IN ('authenticated','anon')
     AND a.privilege_type IN ('UPDATE','INSERT');
  IF v_cols IS NULL THEN
    v_pass := v_pass + 1; INSERT INTO _p0_results VALUES (2,'PASS','no client write on current_organization_id, is_active or is_pilot_user');
  ELSE
    v_fail := v_fail + 1; INSERT INTO _p0_results VALUES (2,'FAIL',format('AUTHORITY COLUMN WRITABLE: %s', v_cols));
  END IF;

  -- ===========================================================================
  -- 3. The writable allowlist is EXACTLY what the migration granted. Equality,
  --    not a subset: a column quietly added to the allowlist is as much a
  --    finding as one quietly removed.
  -- ===========================================================================
  SELECT coalesce(string_agg(DISTINCT att.attname, ', ' ORDER BY att.attname), '(none)')
    INTO v_cols
    FROM pg_attribute att, aclexplode(att.attacl) a
   WHERE att.attrelid = 'public.users'::regclass
     AND a.grantee::regrole::text = 'authenticated'
     AND a.privilege_type = 'UPDATE';
  IF v_cols = k_allowlist THEN
    v_pass := v_pass + 1; INSERT INTO _p0_results VALUES (3,'PASS',format('the column UPDATE allowlist is exactly: %s', v_cols));
  ELSE
    v_fail := v_fail + 1; INSERT INTO _p0_results VALUES (3,'FAIL',format('ALLOWLIST DRIFT: got [%s], expected [%s]', v_cols, k_allowlist));
  END IF;

  -- ===========================================================================
  -- 4. current_org_id() validates ACTIVE membership, is SECURITY DEFINER, and
  --    has its search_path pinned. All three or it is not a boundary: a definer
  --    function with a mutable search_path can be redirected.
  -- ===========================================================================
  SELECT p.prosecdef,
         coalesce(p.proconfig::text, '(none)'),
         pg_get_functiondef(p.oid) LIKE '%organization_memberships%'
           AND pg_get_functiondef(p.oid) LIKE '%active%'
    INTO v_secdef, v_cfg, v_validates
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'current_org_id';
  IF v_secdef AND v_validates AND v_cfg LIKE '%search_path%' THEN
    v_pass := v_pass + 1; INSERT INTO _p0_results VALUES (4,'PASS',format('current_org_id() is definer, validates active membership, cfg %s', v_cfg));
  ELSE
    v_fail := v_fail + 1; INSERT INTO _p0_results VALUES (4,'FAIL',format('current_org_id() secdef=%s validates_membership=%s cfg=%s',
      coalesce(v_secdef::text,'MISSING'), coalesce(v_validates::text,'MISSING'), v_cfg));
  END IF;

  -- ===========================================================================
  -- 5. The authority guard trigger is installed AND enabled. `tgenabled = 'O'`
  --    is origin-enabled; a disabled trigger is present and inert, which is
  --    precisely the state a "does it exist" check would call healthy.
  -- ===========================================================================
  SELECT t.tgenabled INTO v_enabled
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'users'
     AND t.tgname = 'trg_enforce_user_authority_columns';
  IF v_enabled = 'O' THEN
    v_pass := v_pass + 1; INSERT INTO _p0_results VALUES (5,'PASS','trg_enforce_user_authority_columns is installed and enabled');
  ELSE
    v_fail := v_fail + 1; INSERT INTO _p0_results VALUES (5,'FAIL',format('authority guard trigger tgenabled=%s (expected O)', coalesce(v_enabled::text,'ABSENT')));
  END IF;

  -- ===========================================================================
  -- 6. OPERATIONAL. Users sitting in an org they are no longer an active member
  --    of. current_org_id() returns NULL for them, so their app goes empty until
  --    OrganizationContext's self-heal moves them. Reported, never asserted to
  --    be zero -- know the number before a deploy, not after.
  -- ===========================================================================
  SELECT count(*) FILTER (
           WHERE u.current_organization_id IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM organization_memberships om
                WHERE om.user_id = u.id
                  AND om.organization_id = u.current_organization_id
                  AND om.status = 'active'
                  AND (om.expires_at IS NULL OR om.expires_at > now())
             )
         ),
         count(*) FILTER (WHERE u.current_organization_id IS NOT NULL),
         count(*)
    INTO v_stranded, v_with_org, v_total
    FROM users u;
  v_pass := v_pass + 1;
  INSERT INTO _p0_results VALUES (6,'INFO',format('stranded=%s of %s users with a current org (%s users total)', v_stranded, v_with_org, v_total));

  -- ===========================================================================
  -- 7. OPERATIONAL. Context for 6: users with no active membership anywhere
  --    have nowhere valid to be, and NULL is the correct answer for them. They
  --    are not a regression.
  -- ===========================================================================
  SELECT count(*) INTO v_count
    FROM users u
   WHERE NOT EXISTS (
     SELECT 1 FROM organization_memberships om
      WHERE om.user_id = u.id AND om.status = 'active'
   );
  v_pass := v_pass + 1;
  INSERT INTO _p0_results VALUES (7,'INFO',format('users with no active membership anywhere: %s (NULL is correct for these)', v_count));

  -- ===========================================================================
  -- 8. The two guard functions exist with the security mode each one NEEDS,
  --    which is a DIFFERENT mode for each, and getting it backwards disables
  --    the guard rather than hardening it.
  --
  --    enforce_user_authority_columns  must be SECURITY INVOKER.
  --      Its entire gate is `IF current_user NOT IN ('authenticated','anon')
  --      THEN RETURN NEW` -- it lets privileged writers through and inspects
  --      only client writes. Under DEFINER, `current_user` becomes the function
  --      owner (postgres) for EVERY caller, the first branch matches every
  --      time, and every client write passes straight through unchecked.
  --
  --    user_has_active_membership     must be SECURITY DEFINER.
  --      The trigger calls it to read organization_memberships. Under INVOKER
  --      that read is filtered by the CALLER's RLS, so a client whose policy
  --      hides the membership row gets `false` and the check raises -- fail
  --      closed, but for the wrong reason, and it would deny legitimate org
  --      switches.
  --
  --    This assertion originally demanded that BOTH be definer. It failed
  --    against correct production, and satisfying it would have broken the
  --    protection it was written to verify. Recorded because the lesson
  --    generalises: "is it definer?" is not a security question on its own.
  --
  --    The BEHAVIOURAL proof that an unauthorised org switch is refused is not
  --    here and cannot be: service_role is exempt from the guard by design, so
  --    a suite running as the owner would pass whatever the guard did.
  --    supabase/tests/tenant-boundary-p0.sql assumes the authenticated role and
  --    forges a JWT claim the way PostgREST does. This asserts only that the
  --    functions are present, correctly moded, and search_path-pinned, and says
  --    so rather than implying more.
  -- ===========================================================================
  SELECT count(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND coalesce(p.proconfig::text, '') LIKE '%search_path%'
     AND (
       (p.proname = 'enforce_user_authority_columns'
          AND p.prosecdef = false
          AND p.prorettype = 'trigger'::regtype)
       OR
       (p.proname = 'user_has_active_membership'
          AND p.prosecdef = true)
     );
  IF v_count = 2 THEN
    v_pass := v_pass + 1; INSERT INTO _p0_results VALUES (8,'PASS','the trigger guard is INVOKER (so current_user is the real caller), its membership helper is DEFINER, both search_path-pinned');
  ELSE
    v_fail := v_fail + 1; INSERT INTO _p0_results VALUES (8,'FAIL',format('guard function modes wrong: %s of 2 correct — enforce_user_authority_columns must be INVOKER and a trigger, user_has_active_membership must be DEFINER, both with a pinned search_path', v_count));
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '=== RESULTS: % passed, % failed out of 8 ===', v_pass, v_fail;
  RAISE NOTICE 'Assertions 6 and 7 are operational counts, reported not asserted.';
END;
$$;

SELECT n, result, detail FROM _p0_results ORDER BY n, result;
