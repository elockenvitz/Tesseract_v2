-- =============================================================================
-- P0 Tenant Boundary — post-deployment verification
--
-- READ-ONLY. Safe to run against production. Nothing here writes, and nothing
-- here reads user-generated content — only catalog metadata and counts.
--
-- Run after applying 20260826100000 / …100100 / …100200. Every query states
-- its own expected result; anything else means the migration did not take.
-- =============================================================================

\echo '--- 1. authenticated no longer holds a table-wide UPDATE on users ---'
-- EXPECT: zero rows. A row here means the broad grant is still in place.
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'users'
  AND grantee IN ('authenticated', 'anon')
  AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE');

\echo '--- 2. current_organization_id is not directly writable by a client ---'
-- EXPECT: zero rows. Column-level UPDATE on the authority columns must be
-- absent for both client roles.
SELECT grantee, column_name, privilege_type
FROM information_schema.column_privileges
WHERE table_schema = 'public'
  AND table_name = 'users'
  AND grantee IN ('authenticated', 'anon')
  AND privilege_type IN ('UPDATE', 'INSERT')
  AND column_name IN ('current_organization_id', 'is_active', 'is_pilot_user');

\echo '--- 3. the writable allowlist is exactly what the migration granted ---'
-- EXPECT: coverage_admin, email, first_name, last_name, pilot_progress,
--         timezone, user_type
SELECT string_agg(DISTINCT column_name, ', ' ORDER BY column_name) AS updatable
FROM information_schema.column_privileges
WHERE table_schema = 'public' AND table_name = 'users'
  AND grantee = 'authenticated' AND privilege_type = 'UPDATE';

\echo '--- 4. current_org_id() validates active membership ---'
-- EXPECT: validates_membership = true, secdef = true, cfg = {search_path=public}
SELECT p.prosecdef AS secdef,
       p.proconfig::text AS cfg,
       pg_get_functiondef(p.oid) LIKE '%organization_memberships%'
         AND pg_get_functiondef(p.oid) LIKE '%active%' AS validates_membership
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'current_org_id';

\echo '--- 5. the authority guard is installed and enabled ---'
-- EXPECT: one row, tgenabled = O (enabled, origin)
SELECT t.tgname, t.tgenabled, pg_get_triggerdef(t.oid) AS def
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'users'
  AND t.tgname = 'trg_enforce_user_authority_columns';

\echo '--- 6. no live current-org selection was invalidated by the change ---'
-- The one query that can turn a security fix into an outage: if a user is
-- sitting in an org they are no longer an active member of, current_org_id()
-- now returns NULL and their app goes empty until the client self-heals.
--
-- EXPECT: stranded = 0. If it is not zero, those users will be moved to their
-- first active org by OrganizationContext's self-heal on next load — but know
-- the number before you deploy, not after.
SELECT count(*) FILTER (
         WHERE u.current_organization_id IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM organization_memberships om
             WHERE om.user_id = u.id
               AND om.organization_id = u.current_organization_id
               AND om.status = 'active'
               AND (om.expires_at IS NULL OR om.expires_at > now())
           )
       ) AS stranded,
       count(*) FILTER (WHERE u.current_organization_id IS NOT NULL) AS with_current_org,
       count(*) AS total_users
FROM users u;

\echo '--- 7. users with no active membership at all (expected to be org-less) ---'
-- Context for (6): these users have nowhere valid to be, and NULL is the
-- correct answer for them. They are not a regression.
SELECT count(*) AS users_without_any_active_membership
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM organization_memberships om
  WHERE om.user_id = u.id AND om.status = 'active'
);

\echo '--- 8. unauthorized org switching fails (behavioural, run as a client) ---'
-- Not runnable as service role — service_role is exempt from the guard by
-- design. Run supabase/tests/tenant-boundary-p0.sql for the behavioural proof;
-- it assumes the authenticated role and forges a JWT claim the way PostgREST
-- does. This query only confirms the guard function exists to be triggered.
-- EXPECT: two rows — enforce_user_authority_columns, user_has_active_membership
SELECT p.proname, p.prosecdef AS secdef
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('enforce_user_authority_columns', 'user_has_active_membership')
ORDER BY 1;
