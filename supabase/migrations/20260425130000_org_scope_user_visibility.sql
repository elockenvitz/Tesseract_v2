-- ============================================================================
-- Org-scope user visibility.
--
-- Problem
-- -------
-- The `users` table had a `SELECT USING (true)` policy named "Users can
-- read other users for collaboration" — effectively making every user
-- record world-readable for any authenticated client. The prompt
-- "Assigned to" dropdown (and any other user-picker that didn't
-- explicitly filter by org) was leaking identities of users in other
-- orgs.
--
-- Fix
-- ---
-- Replace the global SELECT policy with one that requires the target
-- to be an active member of the caller's CURRENT org (i.e.
-- `current_org_id()`). A "shared org" version was also tried but it
-- still leaked when the caller was a member of multiple orgs. The
-- existing "Users can read their own profile" and platform-admin
-- policies remain so users can still load their own profile and
-- platform admins can still inspect across orgs.
-- ============================================================================

DROP POLICY IF EXISTS "Users can read other users for collaboration" ON public.users;
DROP POLICY IF EXISTS "Users can read users in shared orgs" ON public.users;
DROP POLICY IF EXISTS "Users can read users in current org" ON public.users;

CREATE POLICY "Users can read users in current org" ON public.users
FOR SELECT USING (
  auth.uid() = id
  OR EXISTS (
    SELECT 1
    FROM organization_memberships om
    WHERE om.user_id = users.id
      AND om.organization_id = current_org_id()
      AND om.status = 'active'
  )
);
